"""Puntos sacados solo del vídeo (sin la app) y comparación con los puntos marcados a mano.

Del análisis (trayectoria del balón, toques, pasos de red, jugadores) se deduce:
  1. Dónde empieza y acaba cada punto: el balón se mueve rápido y el primer paso de red sale de un
     jugador detrás de la línea de fondo (el saque).
  2. Quién saca: el lado de ese jugador.
  3. Quién gana: el que saca el punto siguiente (regla del voleibol). En el último punto de un set,
     o si no se sabe quién saca después, por dónde acaba el balón.
  4. Cómo: con el número de pasos de red, los toques después del último paso y el tiempo entre pasos
     (un bloqueo devuelve el balón enseguida).

Todo son reglas: sirve para medir qué parte del registro de la app puede sustituir el vídeo.
"""

from __future__ import annotations

import math

import numpy as np

from .court import LENGTH, WIDTH, Court

MOVE_SPEED = 2.0  # m/s (en la imagen): por debajo, el balón está en la mano, botando o rodando
SPEED_WINDOW = 0.2  # s sobre los que se mide la velocidad (quita el temblor de la detección)
MERGE_GAP = 2.0  # s sin balón en movimiento que se toleran dentro de un punto (balón tapado, muy alto…)
MIN_DURATION = 0.8  # s desde el saque: un ace rápido dura poco más de 1 s
SERVE_LINE = 1.0  # m: el sacador está a menos de esto de la línea de fondo (o detrás)
SERVE_BEFORE_CROSS = 2.5  # s como máximo entre el golpe de saque y el paso de red
SERVE_NEAR = 1.0  # distancia balón-jugador (en alturas de su caja) para decir que el balón está en sus manos
BLOCK_WINDOW = 0.8  # s: un balón que vuelve tan rápido tras un ataque es un bloqueo
SET_BREAK = 60.0  # s: una pausa así entre puntos es un cambio de set (y de campo)
IN_MARGIN = 0.3  # m de margen para decir que el balón cayó dentro

OTHER = {"A": "B", "B": "A"}
REASONS = {
    "ace": ("Ace", True), "ataque": ("Ataque", True), "bloqueo": ("Bloqueo", True),
    "error_saque": ("Error de saque", False), "error_ataque": ("Error de ataque", False),
    "error_recepcion": ("Error de recepción/defensa", False), "extra": ("+1 (otro error)", None),
}


# ---------- Del análisis a los puntos ----------

def infer_rallies(analysis: dict, court: Court) -> list:
    frames = analysis["frames"]
    if len(frames) < 2:
        return []
    t = np.array([fr["t"] for fr in frames])
    dt = float(np.median(np.diff(t)))
    ppm = court.px_per_meter()
    speed = _ball_speed(frames, t, dt, ppm)
    touches, crossings = analysis["touches"], analysis["crossings"]

    # Tramos con el balón moviéndose deprisa, uniendo huecos cortos.
    segs = []
    for run in _runs(speed >= MOVE_SPEED):
        i0, i1 = run[0], run[-1]
        if segs and t[i0] - t[segs[-1][1]] <= MERGE_GAP:
            segs[-1][1] = i1
        else:
            segs.append([i0, i1])

    rallies = []
    for i0, i1 in segs:
        cross = [c | {"t": float(t[c["i"]])} for c in crossings if i0 <= c["i"] <= i1]
        serve = _find_serve(frames, t, i0, cross)
        if serve is None:
            # Sin saque: balón que se pasan entre puntos, o un trozo del punto anterior (balón perdido un rato).
            if rallies and t[i0] - rallies[-1]["end"] <= 2 * MERGE_GAP:
                prev = rallies[-1]
                prev["i1"], prev["end"] = i1, round(float(t[i1]), 2)
                continue
            if len(cross) < 2 or t[i1] - t[i0] < 4.0:
                continue
            serve = {"i": i0, "side": None, "cross_k": 0}
        start_i = serve["i"]
        if t[i1] - t[start_i] < MIN_DURATION:
            continue
        rallies.append({"i0": start_i, "i1": i1, "start": round(float(t[start_i]), 2), "end": round(float(t[i1]), 2),
                        "server": serve["side"], "cross": cross[serve["cross_k"]:]})

    for k, r in enumerate(rallies):
        r["touches"] = [x for x in touches if r["i0"] <= x["i"] <= r["i1"]]
        r.update(_ending(frames, r, court))
        nxt = rallies[k + 1] if k + 1 < len(rallies) else None
        new_set = nxt is None or nxt["start"] - r["end"] > SET_BREAK
        r["winner_next_serve"] = None if new_set else nxt["server"]
        r["winner"] = r["winner_next_serve"] or r["winner_ball"]
        r["winner_from"] = "saque siguiente" if r["winner_next_serve"] else "final del balón" if r["winner_ball"] else None
        r["how"] = _cause(r)
    out = []
    for r in rallies:
        out.append({k: v for k, v in r.items() if k not in ("cross", "touches", "i0", "i1")}
                   | {"crossings": len(r["cross"]), "touches": len(r["touches"])})
    return out


def _ball_speed(frames, t, dt, ppm):
    """Velocidad del balón (m/s en la imagen) medida sobre SPEED_WINDOW segundos."""
    k = max(1, round(SPEED_WINDOW / dt))
    pos = [(fr["ball"]["u"], fr["ball"]["v"]) if fr["ball"] else None for fr in frames]
    speed = np.zeros(len(frames))
    for i in range(k, len(frames)):
        a, b = pos[i - k], pos[i]
        if a and b:
            speed[i] = math.hypot(b[0] - a[0], b[1] - a[1]) / ppm / (t[i] - t[i - k])
    return speed


def _runs(mask):
    runs, cur = [], []
    for i, m in enumerate(mask):
        if m:
            cur.append(i)
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return runs


def _server_near(fr):
    """Lado del jugador que tiene el balón si está detrás (o cerca) de su línea de fondo."""
    b = fr["ball"]
    if not b:
        return None
    best, best_d = None, None
    for p in fr["players"]:
        x1, y1, x2, y2 = p["box"]
        h = max(1.0, y2 - y1)
        d = math.hypot(max(x1 - b["u"], 0, b["u"] - x2), max(y1 - b["v"], 0, b["v"] - y2)) / h
        if best_d is None or d < best_d:
            best, best_d = p, d
    if best is None or best_d > SERVE_NEAR or not -1.0 <= best["y"] <= WIDTH + 1.0:
        return None
    if best["x"] <= SERVE_LINE:
        return "A"
    if best["x"] >= LENGTH - SERVE_LINE:
        return "B"
    return None


def _find_serve(frames, t, i0, cross):
    """Primer paso de red precedido (poco antes) por el balón en manos de un jugador en su línea de fondo."""
    for k, c in enumerate(cross):
        j = c["i"] - 1
        while j >= 0 and t[c["i"]] - t[j] <= SERVE_BEFORE_CROSS:
            side = _server_near(frames[j])
            if side == c["from"]:
                return {"i": j, "side": side, "cross_k": k}
            j -= 1
    return None


def _ending(frames, r, court: Court):
    """Por dónde acaba el balón: último lado visto y si cayó dentro del campo."""
    last = None
    for i in range(r["i1"], r["i0"] - 1, -1):
        if frames[i]["ball"] and frames[i]["ball_side"]:
            last = i
            break
    if last is None:
        return {"end_side": None, "landed_in": None, "winner_ball": None}
    side = frames[last]["ball_side"]
    b = frames[last]["ball"]
    # Al final del punto el balón está cerca del suelo: la calibración del suelo da una idea de dónde cayó.
    x, y = court.to_court([(b["u"], b["v"])])[0]
    landed_in = bool(-IN_MARGIN <= x <= LENGTH + IN_MARGIN and -IN_MARGIN <= y <= WIDTH + IN_MARGIN)
    # Cae dentro en un campo → gana el otro. Cae fuera → falló el último que la mandó (el otro campo).
    winner = side if not landed_in else OTHER[side]
    return {"end_side": side, "landed_in": landed_in, "winner_ball": winner}


def _cause(r):
    w, srv = r["winner"], r["server"]
    if not w:
        return None
    cross = r["cross"]
    end = r["end_side"] or (cross[-1]["to"] if cross else None)
    after = [x for x in r["touches"] if (not cross or x["i"] > cross[-1]["i"]) and x["side"] == end]
    n_after = len(after)
    if not cross:
        return "error_saque" if srv and w != srv else "error_ataque"
    if len(cross) == 1 and srv:
        if w != srv:
            return "error_saque"
        return "ace" if n_after <= 1 else "error_recepcion" if n_after == 2 else "error_ataque"
    if end == w:  # el balón acabó en el campo del que gana: el rival la mandó fuera
        return "error_ataque"
    # El balón murió en el campo del que pierde.
    if len(cross) >= 3 or (len(cross) == 2 and not srv):  # el saque no se puede bloquear
        a, b = cross[-2], cross[-1]
        if a["from"] == end and b["t"] - a["t"] <= BLOCK_WINDOW:
            return "bloqueo"
    if n_after <= 1:
        return "ataque"
    return "error_recepcion" if n_after == 2 else "error_ataque"


# ---------- Comparación con los puntos marcados a mano ----------

def compare(pred: list, labels: list) -> dict:
    """Empareja cada punto marcado con el punto del vídeo que más se solapa y mide aciertos."""
    used = set()
    rows = []
    for n, lab in enumerate(labels, 1):
        best, best_ov = None, 0.0
        for j, p in enumerate(pred):
            if j in used:
                continue
            ov = min(lab["end"] + 1.0, p["end"]) - max(lab["start"] - 2.0, p["start"])
            if ov > best_ov:
                best, best_ov = j, ov
        p = pred[best] if best is not None else None
        if best is not None:
            used.add(best)
        rows.append({
            "punto": n, "set": lab["set"], "inicio": round(lab["start"], 1), "fin": round(lab["end"], 1),
            "saca": lab.get("server"), "gana": lab["winner"], "como": lab.get("how"),
            "video_inicio": p["start"] if p else None, "video_fin": p["end"] if p else None,
            "video_saca": p["server"] if p else None, "video_gana": p["winner"] if p else None,
            "video_gana_por": p["winner_from"] if p else None, "video_como": p["how"] if p else None,
            "pasos_red": p["crossings"] if p else None, "toques": p["touches"] if p else None,
        })
    found = [r for r in rows if r["video_inicio"] is not None]

    def pct(ok, total):
        return round(100 * ok / total, 1) if total else None

    known_srv = [r for r in found if r["saca"]]
    with_how = [r for r in found if r["como"] and r["como"] != "extra"]
    group = lambda h: REASONS.get(h, (None, None))[1]  # noqa: E731
    return {
        "rows": rows,
        "labels": len(labels), "video": len(pred), "found": len(found), "extra_video": len(pred) - len(used),
        "found_pct": pct(len(found), len(labels)),
        "start_err_median": _median([abs(r["video_inicio"] - r["inicio"]) for r in found]),
        "end_err_median": _median([abs(r["video_fin"] - r["fin"]) for r in found]),
        "server_pct": pct(sum(r["video_saca"] == r["saca"] for r in known_srv), len(known_srv)),
        "winner_pct": pct(sum(r["video_gana"] == r["gana"] for r in found), len(found)),
        "winner_pct_all": pct(sum(r["video_gana"] == r["gana"] for r in found), len(labels)),
        "how_pct": pct(sum(r["video_como"] == r["como"] for r in with_how), len(with_how)),
        "how_group_pct": pct(sum(group(r["video_como"]) == group(r["como"]) for r in with_how), len(with_how)),
        "how_both_pct": pct(sum(r["video_como"] == r["como"] and r["video_gana"] == r["gana"] for r in with_how),
                            len(with_how)),
        "confusion": _confusion(with_how),
    }


def _median(v):
    return round(float(np.median(v)), 1) if v else None


def _confusion(rows):
    out = {}
    for r in rows:
        out.setdefault(r["como"], {}).setdefault(r["video_como"] or "?", 0)
        out[r["como"]][r["video_como"] or "?"] += 1
    return out


def comparison_text(c: dict) -> str:
    def f(v, unit="%"):
        return "—" if v is None else f"{v}{unit}"

    name = lambda h: REASONS.get(h, (h or "?",))[0]  # noqa: E731
    lines = [
        "PUNTOS: SOLO VÍDEO FRENTE A TUS ETIQUETAS",
        f"  Puntos marcados: {c['labels']} · encontrados por el vídeo: {c['found']} ({f(c['found_pct'])})"
        f" · puntos de más (el vídeo ve un punto donde no lo hay): {c['extra_video']}",
        f"  Error típico del inicio: {f(c['start_err_median'], ' s')} · del final: {f(c['end_err_median'], ' s')}"
        "  (tus marcas tienen 1-5 s de margen)",
        f"  Quién saca: {f(c['server_pct'])} de acierto",
        f"  Quién gana: {f(c['winner_pct'])} de los encontrados ({f(c['winner_pct_all'])} de todos)",
        f"  Motivo exacto: {f(c['how_pct'])} · al menos el tipo (punto propio o error del rival): {f(c['how_group_pct'])}",
        f"  Ganador y motivo a la vez (lo que da el modo sencillo de la app): {f(c['how_both_pct'])}",
        "",
        "  Motivo marcado → lo que dice el vídeo",
    ]
    for how, got in sorted(c["confusion"].items()):
        lines.append(f"    {name(how):<28} " + ", ".join(f"{name(g)} ×{n}" for g, n in sorted(got.items(), key=lambda x: -x[1])))
    lines += ["", "punto set  inicio vídeo    fin  vídeo  saca v.  gana v. (por)            motivo → vídeo"]
    for r in c["rows"]:
        vi = "—" if r["video_inicio"] is None else f"{r['video_inicio']:.1f}"
        vf = "—" if r["video_fin"] is None else f"{r['video_fin']:.1f}"
        ok = "✓" if r["video_gana"] == r["gana"] else "✗"
        lines.append(
            f"{r['punto']:>5} {r['set']:>3} {r['inicio']:>7.1f} {vi:>6} {r['fin']:>6.1f} {vf:>6}"
            f"  {r['saca'] or '?':>2} {r['video_saca'] or '?':>2}"
            f"  {r['gana'] or '?':>2} {r['video_gana'] or '?':>2} {ok} ({r['video_gana_por'] or '—'})"
            f"  {name(r['como'])} → {name(r['video_como']) if r['video_como'] else '—'}")
    return "\n".join(lines)
