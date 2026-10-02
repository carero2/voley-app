"""Métricas de juego PROVISIONALES: alturas de recepción, colocación y remate, calidad de la recepción,
velocidad del saque y posición del colocador.

Son estimaciones muy aproximadas con una sola cámara y un modelo todavía poco entrenado. Cómo se miden:
- El modelo pierde el balón cuando está bajo, entre los jugadores, pero lo sigue bien en el aire. Cada pase se
  ve como un **arco** (sube y baja) en el campo del que recibe: el 1.º es la recepción y el 2.º la colocación.
- **Escala con la gravedad**: el balón en el aire cae a 9,8 m/s². Ajustando una parábola al arco se sabe cuántos
  píxeles mide un metro a la distancia del balón. El suelo son los pies de los jugadores de ese campo.
- Si el arco no se ve limpio (sale del encuadre, el modelo lo pierde o lo confunde), no se mide.
Sirven para enseñar qué se podrá medir, no para sacar conclusiones todavía.
"""

from __future__ import annotations

import math
from statistics import median

import numpy as np

from .court import LENGTH
from .rallies import OTHER, norm_how

G = 9.81
NET_X = LENGTH / 2
NEAR_NET = 3.5  # m: colocación «en su sitio» (recepción buena) si el colocador está a esta distancia de la red
FIRST_ARC = 3.0  # s: tiempo máximo del paso de red del saque al arco de la recepción
NEXT_ARC = 1.5  # s: hueco máximo entre la recepción y la colocación
MAX_GAP = 4  # fotogramas sin balón que se toleran dentro de un arco
MIN_ARC = 10  # fotogramas mínimos de un arco
RISE = 30  # px: lo que tiene que subir y bajar el balón para contar como arco
MAX_RESIDUAL = 6.0  # px: error máximo del ajuste a la parábola (arco limpio)
PXPM = (40, 250)  # px por metro razonables en este encuadre
ATTACK_WINDOW = 0.5  # s antes del paso de red: el balón que se ve ahí es el del remate
MAX_REACH = 3.6  # m: más alto no es un remate de esta liga (será un balón fácil o un error de medida)


def find_arcs(analysis: dict, i0: int, i1: int) -> list:
    """Arcos del balón (tramos seguidos que suben y bajan) entre los fotogramas i0 e i1."""
    frames = analysis["frames"]
    segs, cur, last = [], [], None
    for i in range(max(0, i0), min(i1, len(frames))):
        if not frames[i]["ball"]:
            continue
        if last is not None and i - last > MAX_GAP:
            segs.append(cur)
            cur = []
        cur.append(i)
        last = i
    if cur:
        segs.append(cur)
    arcs = []
    for s in segs:
        if len(s) < MIN_ARC:
            continue
        t = np.array([frames[i]["t"] for i in s])
        v = np.array([frames[i]["ball"]["v"] for i in s])
        k = int(np.argmin(v))
        if k < 3 or k > len(s) - 4 or v[0] - v[k] < RISE or v[-1] - v[k] < RISE:
            continue
        coef = np.polyfit(t - t[k], v, 2)
        residual = float(np.std(v - np.polyval(coef, t - t[k])))
        pxpm = 2 * coef[0] / G
        sides = {frames[i]["ball_side"] for i in s} - {None}
        arcs.append({"i0": s[0], "i1": s[-1], "apex_i": s[k], "t0": float(t[0]), "t1": float(t[-1]),
                     "apex_v": float(v[k]), "pxpm": float(pxpm),
                     "clean": residual <= MAX_RESIDUAL and PXPM[0] <= pxpm <= PXPM[1],
                     "side": next(iter(sides)) if len(sides) == 1 else None})
    return arcs


def rally_details(analysis: dict, rows: list) -> list:
    """Para cada punto (filas de metrics.points_with_app) mide lo que pueda de la jugada del que recibe."""
    frames = analysis["frames"]
    t = np.array([f["t"] for f in frames])
    touches = [x | {"t": float(t[x["i"]])} for x in analysis["touches"]]
    crossings = [c | {"t": float(t[c["i"]])} for c in analysis["crossings"]]
    out = []
    for r in rows:
        d = {"punto": r["punto"], "inicio": r["inicio_video"], "saca": r["saca"], "gana": r["gana"],
             "como": norm_how(r["como"]),
             "recepcion": None, "altura_recepcion": None, "altura_colocacion": None, "altura_remate": None,
             "colocador_red": None, "velocidad_saque": None}
        out.append(d)
        start, end, server = r["inicio_video"], r["fin_app"], r["saca"]
        if start is None or not server:
            continue
        receiver = OTHER[server]
        if d["como"] == "ace":
            d["recepcion"] = "mala"
        if d["como"] == "error_saque":
            continue
        serve_x = next((c for c in crossings if start - 0.3 <= c["t"] <= end and c["from"] == server), None)
        if serve_x is None:
            continue
        d["velocidad_saque"] = _serve_speed(touches, serve_x, server, receiver)
        if d["como"] == "ace":
            continue
        nxt = next((c["t"] for c in crossings if c["t"] > serve_x["t"] + 0.2), None)
        until = min(end, nxt) if nxt else end
        arcs = [a for a in find_arcs(analysis, serve_x["i"] + 1, int(np.searchsorted(t, until)) + 1)
                if a["side"] == receiver]
        rec = arcs[0] if arcs and arcs[0]["t0"] - serve_x["t"] <= FIRST_ARC else None
        st = arcs[1] if rec and len(arcs) > 1 and arcs[1]["t0"] - rec["t1"] <= NEXT_ARC else None
        if rec:
            d["altura_recepcion"] = _apex_height(frames, rec, receiver)
        if st:
            d["altura_colocacion"] = _apex_height(frames, st, receiver)
            setter = _nearest_player(frames, st["i0"], receiver)
            if setter is not None:
                d["colocador_red"] = round(abs(setter["x"] - NET_X), 1)
            d["recepcion"] = "mala" if d["colocador_red"] is not None and d["colocador_red"] > NEAR_NET else "buena"
            if nxt and nxt <= end:
                d["altura_remate"] = _attack_height(frames, t, st, nxt, receiver)
        elif rec and nxt and nxt <= end and nxt - rec["t1"] < 1.0:
            d["recepcion"] = "mala"  # la recepción (o el 2.º toque) pasó directa al otro campo
        elif rec and r["gana"] == server and end - rec["t1"] < 2.0:
            d["recepcion"] = "mala"  # el punto acabó justo después de recibir
    return out


def summary(details: list) -> dict:
    """Medianas por equipo que recibe (A, B) y cuántos puntos se han podido medir."""
    res = {}
    for team in ("A", "B"):
        mine = [d for d in details if d["saca"] == OTHER[team]]
        graded = [d for d in mine if d["recepcion"]]
        good = [d for d in graded if d["recepcion"] == "buena"]
        bad = [d for d in graded if d["recepcion"] == "mala"]
        serves = [d for d in details if d["saca"] == team and d["velocidad_saque"]]
        res[team] = {
            "recibe": len(mine), "recepciones_valoradas": len(graded),
            "recepcion_buena_pct": _pct(len(good), len(graded)),
            "buenas": len(good), "malas": len(bad),
            "side_out_tras_buena_pct": _pct(sum(1 for d in good if d["gana"] == team), len(good)),
            "side_out_tras_mala_pct": _pct(sum(1 for d in bad if d["gana"] == team), len(bad)),
            "altura_recepcion": _med(mine, "altura_recepcion"),
            "altura_colocacion": _med(mine, "altura_colocacion"),
            "altura_remate": _med(mine, "altura_remate"),
            "colocador_red": _med(mine, "colocador_red"),
            "velocidad_saque": _med(serves, "velocidad_saque", 0),
            "medidas": {k: sum(1 for d in mine if d[k] is not None)
                        for k in ("altura_recepcion", "altura_colocacion", "altura_remate", "colocador_red")}
            | {"velocidad_saque": len(serves)},
        }
    return res


def _pct(a, b):
    return round(100 * a / b) if b else None


def _med(rows, key, nd=1):
    vals = [d[key] for d in rows if d[key] is not None]
    if not vals:
        return None
    m = median(vals)
    return int(round(m)) if nd == 0 else round(m, nd)


def _ground_v(frames, i, side):
    """Suelo en la imagen: pies (mediana) de los jugadores de ese campo."""
    feet = [p["box"][3] for p in frames[i]["players"] if p["in_play"] and p["side"] == side]
    return median(feet) if feet else None


def _apex_height(frames, arc, side):
    """Altura máxima (m) del arco, con la escala que da la gravedad."""
    if not arc["clean"]:
        return None
    ground = _ground_v(frames, arc["apex_i"], side)
    if ground is None:
        return None
    h = (ground - arc["apex_v"]) / arc["pxpm"]
    return round(h, 1) if 1.0 <= h <= 15 else None


def _attack_height(frames, t, set_arc, cross_t, side):
    """Altura (m) del balón en el remate: el primer punto que se ve justo antes del paso de red, con la escala
    de la colocación. El golpe en sí casi nunca se ve (el balón va muy rápido), así que es aproximada."""
    if not set_arc["clean"]:
        return None
    i = set_arc["apex_i"] + 1
    while i < len(frames) and t[i] < cross_t:
        b = frames[i]["ball"]
        if b and t[i] >= cross_t - ATTACK_WINDOW and frames[i]["ball_side"] == side:
            ground = _ground_v(frames, i, side)
            if ground is None:
                return None
            h = (ground - b["v"]) / set_arc["pxpm"]
            return round(h, 1) if 1.5 <= h <= MAX_REACH else None
        i += 1
    return None


def _nearest_player(frames, i, side, reach=2.0):
    """Jugador de ese campo más cercano al balón (en alturas de su caja) en el fotograma i."""
    b = frames[i]["ball"]
    best, best_d = None, None
    for p in frames[i]["players"]:
        if not p["in_play"] or p["side"] != side or p["x"] is None:
            continue
        x1, y1, x2, y2 = p["box"]
        d = math.hypot(max(x1 - b["u"], 0, b["u"] - x2), max(y1 - b["v"], 0, b["v"] - y2)) / max(1.0, y2 - y1)
        if best_d is None or d < best_d:
            best, best_d = p, d
    return best if best_d is not None and best_d <= reach else None


def _serve_speed(touches, serve_x, server, receiver):
    """Velocidad media (km/h) del saque sobre el suelo: del toque del sacador al del receptor."""
    srv = [x for x in touches if x["side"] == server and serve_x["t"] - 1.5 <= x["t"] <= serve_x["t"]]
    rec = [x for x in touches if x["side"] == receiver and serve_x["t"] < x["t"] <= serve_x["t"] + FIRST_ARC]
    if not srv or not rec or srv[-1]["x"] is None or rec[0]["x"] is None:
        return None
    dist = math.hypot(rec[0]["x"] - srv[-1]["x"], rec[0]["y"] - srv[-1]["y"])
    dt = rec[0]["t"] - srv[-1]["t"]
    kmh = dist / dt * 3.6 if dt > 0 else 0
    return round(kmh) if 6 <= dist <= 20 and 25 <= kmh <= 120 else None
