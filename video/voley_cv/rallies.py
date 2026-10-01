"""Puntos sacados solo del vídeo (sin la app) y comparación con los puntos marcados a mano.

Reglas, comprobadas con un partido real (vídeo lateral desde la grada):
  1. Saque: antes de sacar, los jugadores están quietos unos segundos y en cuanto sale el saque se mueven.
     Se busca ese «quietos → en movimiento», y un paso de red justo después con los jugadores quietos antes.
  2. Quién saca: el campo del que sale ese paso de red; si no se vio el balón, el campo con un jugador
     detrás de su línea de fondo.
  3. Quién gana: el que saca el punto siguiente (regla del voleibol). En el último punto de un set, el que
     mandó el último balón al otro campo.
  4. Cómo: con el último paso de red de verdad (sin contar el balón que se pasan después por debajo de la
     red), quién lo mandó, si fue el saque y cuántas veces lo tocó el otro equipo.

Todo son reglas: sirve para medir qué parte del registro de la app puede sustituir el vídeo.
"""

from __future__ import annotations

import math

import numpy as np

from .court import LENGTH, Court

STILL = 0.6  # m/s: velocidad típica de los jugadores (mediana) por debajo de la cual «esperan el saque»
STILL_STRICT = 0.5  # m/s: lo mismo, para detectar el saque sin ver el balón
MOVING = 0.85  # m/s: tras el saque, los jugadores se mueven al menos así
SERVE_TO_CROSS = 0.7  # s típicos entre el golpe de saque y el paso de red
SERVE_GROUP = 6.0  # s: candidatos a saque más cercanos que esto son el mismo saque
MIN_RALLY = 2.5  # s: dos saques no pueden estar más cerca
BEHIND_LINE = 0.3  # m detrás de la línea de fondo para contar a un jugador como sacador
NET_BOUNCE = 0.6  # s: ida y vuelta por la red tan rápida es el balón que toca la red y vuelve
BLOCK_WINDOW = 0.8  # s: un balón que vuelve tan rápido tras un ataque es un bloqueo
DEAD_AFTER = 2.0  # s tras el último paso de red de verdad para dar el punto por acabado
SET_BREAK = 60.0  # s: una pausa así entre puntos es un cambio de set (y de campo)

OTHER = {"A": "B", "B": "A"}
REASONS = {
    "ace": ("Ace", True), "ataque": ("Ataque", True), "bloqueo": ("Bloqueo", True),
    "error_saque": ("Error de saque", False), "error": ("Error", False), "extra": ("+1 (no sé)", None),
}
# Etiquetas antiguas: errores de ataque y de recepción/defensa ahora son un solo «error».
LEGACY_HOW = {"error_ataque": "error", "error_recepcion": "error", "error_otro": "error"}


def norm_how(how):
    return LEGACY_HOW.get(how, how)


# ---------- Del análisis a los puntos ----------

def infer_rallies(analysis: dict, court: Court) -> list:
    frames = analysis["frames"]
    if len(frames) < 2:
        return []
    t = np.array([fr["t"] for fr in frames])
    ppm = court.px_per_meter()
    move = players_speed(frames)
    crossings = [c | {"t": float(t[c["i"]])} | _cross_features(frames, t, c["i"], ppm) for c in analysis["crossings"]]
    touches = analysis["touches"]

    serves = _serves(t, move, crossings)
    # Línea de la red en el suelo, en la imagen: de su extremo lejano (arriba) al cercano (abajo).
    net_v = tuple(float(v) for _, v in court.to_image([(LENGTH / 2, 9.0), (LENGTH / 2, 0.0)]))
    rallies = []
    for k, sv in enumerate(serves):
        nxt = serves[k + 1]["t"] if k + 1 < len(serves) else t[-1] + 0.1
        side = sv["side"] or _side_behind_line(frames, t, sv["t"])
        cross = [c for c in crossings if sv["t"] - 0.3 <= c["t"] < nxt - 1.0]
        cross = _rally_crossings(cross, sv, net_v)
        last_t = cross[-1]["t"] if cross else sv["t"] + 1.0
        end = min(last_t + DEAD_AFTER, nxt - 1.0)
        rallies.append({"start": round(sv["t"], 2), "end": round(end, 2), "server": side,
                        "server_from": sv["src"] if sv["side"] else ("jugador tras la línea" if side else None),
                        "cross": cross, "next": nxt,
                        "touches": [x for x in touches if sv["t"] <= t[x["i"]] <= end]})
    for k, r in enumerate(rallies):
        nx = rallies[k + 1] if k + 1 < len(rallies) else None
        new_set = nx is None or nx["start"] - r["end"] > SET_BREAK
        r["winner_next_serve"] = None if new_set else nx["server"]
        last = r["cross"][-1] if r["cross"] else None
        # Sin saque siguiente: lo más frecuente es que gane quien mandó el último balón al otro campo.
        r["winner_ball"] = last["from"] if last else None
        r["winner"] = r["winner_next_serve"] or r["winner_ball"]
        r["winner_from"] = "saque siguiente" if r["winner_next_serve"] else "último paso de red" if r["winner_ball"] else None
        r["how"] = _cause(r, t)
        r["end_by"] = "último paso de red" if r["cross"] else "sin balón"
    return [{k: v for k, v in r.items() if k not in ("cross", "touches", "next")}
            | {"crossings": len(r["cross"]), "touches": len(r["touches"])} for r in rallies]


def players_speed(frames) -> np.ndarray:
    """Velocidad típica (mediana, m/s) de los jugadores sobre el campo en cada fotograma. Cada jugador se
    empareja con el más cercano del fotograma anterior (no hace falta seguimiento con identificadores)."""
    out = np.full(len(frames), np.nan)
    prev, prev_t = None, None
    for i, fr in enumerate(frames):
        pts = np.array([(p["x"], p["y"]) for p in fr["players"]
                        if -1.0 <= p["x"] <= LENGTH + 1.0 and -1.0 <= p["y"] <= 10.0]).reshape(-1, 2)
        if prev is not None and len(pts) and len(prev) and fr["t"] > prev_t:
            d = np.linalg.norm(pts[:, None, :] - prev[None, :, :], axis=2).min(axis=1)
            d = d[d < 1.0]  # más de 1 m entre fotogramas no es el mismo jugador
            if len(d):
                out[i] = float(np.median(d)) / (fr["t"] - prev_t)
        prev, prev_t = pts, fr["t"]
    return out


def _mean(t, v, a, b):
    m = (t >= a) & (t < b) & ~np.isnan(v)
    return float(v[m].mean()) if m.any() else float("nan")


def _serves(t, move, crossings):
    """Saques: pasos de red con los jugadores quietos justo antes, y momentos «quietos → en movimiento»
    (por si el balón del saque no se vio)."""
    cands = []
    for c in crossings:
        if _mean(t, move, c["t"] - 4.0, c["t"] - 1.0) < STILL:
            cands.append({"t": c["t"] - SERVE_TO_CROSS, "side": c["from"], "src": "paso de red", "cross_t": c["t"]})
    best = None
    for g in np.arange(t[0] + 3.0, t[-1] - 2.0, 0.1):
        before, after = _mean(t, move, g - 3.0, g - 0.3), _mean(t, move, g + 0.3, g + 2.3)
        if before < STILL_STRICT and after > MOVING:
            score = after - before
            if best is not None and g - best["t"] < 5.0:
                if score > best["score"]:
                    best.update(t=float(g), score=score)
            else:
                if best is not None:
                    cands.append(best)
                best = {"t": float(g), "side": None, "src": "jugadores", "score": score}
    if best is not None:
        cands.append(best)
    cands.sort(key=lambda c: c["t"])
    serves = []
    for c in cands:
        if serves and c["t"] - serves[-1]["t"] < SERVE_GROUP:
            if serves[-1]["side"] is None and c["side"] is not None:  # mejor el que vio el balón
                serves[-1] = c
            continue
        serves.append(c)
    out = []
    for s in serves:
        if out and s["t"] - out[-1]["t"] < MIN_RALLY:
            continue
        out.append(s)
    return out


def _side_behind_line(frames, t, ts):
    """El campo con algún jugador detrás de su línea de fondo justo antes del saque (el sacador)."""
    i0, i1 = np.searchsorted(t, [ts - 2.0, ts + 1.0])
    a = b = 0
    for k in range(i0, i1):
        for p in frames[k]["players"]:
            if -1.5 <= p["y"] <= 10.5:
                a += -6.0 < p["x"] < -BEHIND_LINE
                b += LENGTH + BEHIND_LINE < p["x"] < LENGTH + 6.0
    if max(a, b) < 10 or min(a, b) * 2 > max(a, b):
        return None
    return "A" if a > b else "B"


def _cross_features(frames, t, i, ppm):
    """Altura en la imagen (v mínima: más pequeña = más alto) y velocidad del balón al pasar la red."""
    pts = [(t[k], frames[k]["ball"]["u"], frames[k]["ball"]["v"]) for k in range(max(0, i - 8), min(len(frames), i + 8))
           if frames[k]["ball"]]
    vmin = min(p[2] for p in pts) if pts else None
    speed = 0.0
    for a, b in zip(pts, pts[1:]):
        if b[0] > a[0]:
            speed = max(speed, math.hypot(b[1] - a[1], b[2] - a[2]) / ppm / (b[0] - a[0]))
    return {"vmin": vmin, "speed": speed}


def _is_dead_ball(c, net_v):
    """Pase por debajo de la red o balón rodando (ya acabado el punto): bajo en la imagen y lento.
    «Bajo» se mide entre el pie de la red en el lado lejano (0) y en el cercano (1)."""
    if c["vmin"] is None:
        return False
    far, near = net_v
    low = (c["vmin"] - far) / max(1.0, near - far)
    return low > 0.53 or (low > 0.42 and c["speed"] < 20) or (low > 0.0 and c["speed"] < 7.5)


def _rally_crossings(cross, serve, net_v):
    out = []
    for c in cross:
        is_serve = serve.get("cross_t") is not None and abs(c["t"] - serve["cross_t"]) < 0.05
        if not is_serve and _is_dead_ball(c, net_v):
            break  # a partir de aquí ya no es el punto
        out.append(c)
    # Saque que toca la red y vuelve (ida y vuelta casi instantánea): no pasó. Más adelante en el punto, una
    # vuelta así de rápida es un bloqueo y sí cuenta.
    if len(out) >= 2 and serve.get("cross_t") is not None and abs(out[0]["t"] - serve["cross_t"]) < 0.05 \
            and out[1]["to"] == out[0]["from"] and out[1]["t"] - out[0]["t"] < NET_BOUNCE:
        out = out[:1] + out[2:]
        out[0] = out[0] | {"net": True}
    return out


def _cause(r, t):
    w, srv, cross = r["winner"], r["server"], r["cross"]
    if not w:
        return None
    if not cross:  # no se vio pasar el balón: saque directo (ace) o fallado
        if srv:
            return "ace" if w == srv else "error_saque"
        return None
    last = cross[-1]
    x, y = last["from"], last["to"]
    if cross[0].get("net"):  # el saque dio en la red
        return "error_saque" if w != srv else "ace"
    if len(cross) == 1 and srv == x:  # el último balón que pasó fue el saque
        return "ace" if w == x else "error_saque"
    if w == y:  # lo mandó el otro y gana este: el balón se fue fuera
        return "error_saque" if len(cross) == 1 else "error"
    # Gana quien mandó el último balón: el otro no pudo devolverlo.
    if len(cross) >= 2:
        prev = cross[-2]
        if prev["from"] == y and last["t"] - prev["t"] <= BLOCK_WINDOW:
            return "bloqueo"
    # Toques del que no pudo devolverlo (con un jugador cerca: los botes en el suelo no cuentan).
    after = [x_ for x_ in r["touches"] if t[x_["i"]] > last["t"] and x_["side"] == y and x_["x"] is not None]
    return "ataque" if len(after) <= 1 else "error"


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
            "saca": lab.get("server"), "gana": lab["winner"], "como": norm_how(lab.get("how")),
            "video_inicio": p["start"] if p else None, "video_fin": p["end"] if p else None,
            "video_saca": p["server"] if p else None, "video_saca_por": p.get("server_from") if p else None,
            "video_fin_por": p.get("end_by") if p else None, "video_gana": p["winner"] if p else None,
            "video_gana_por": p["winner_from"] if p else None, "video_como": p["how"] if p else None,
            "pasos_red": p["crossings"] if p else None, "toques": p["touches"] if p else None,
        })
    found = [r for r in rows if r["video_inicio"] is not None]
    extras = [{k: p.get(k) for k in ("start", "end", "server", "server_from", "serve_speed", "crossings", "touches",
                                     "end_by", "winner", "how")} for j, p in enumerate(pred) if j not in used]

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
        "extras": extras,
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
    lines += ["", "punto set  inicio vídeo    fin  vídeo  saca v.  gana v. (por)            motivo → vídeo"
              "   [saque visto por · fin por]"]
    for r in c["rows"]:
        vi = "—" if r["video_inicio"] is None else f"{r['video_inicio']:.1f}"
        vf = "—" if r["video_fin"] is None else f"{r['video_fin']:.1f}"
        ok = "✓" if r["video_gana"] == r["gana"] else "✗"
        lines.append(
            f"{r['punto']:>5} {r['set']:>3} {r['inicio']:>7.1f} {vi:>6} {r['fin']:>6.1f} {vf:>6}"
            f"  {r['saca'] or '?':>2} {r['video_saca'] or '?':>2}"
            f"  {r['gana'] or '?':>2} {r['video_gana'] or '?':>2} {ok} ({r['video_gana_por'] or '—'})"
            f"  {name(r['como'])} → {name(r['video_como']) if r['video_como'] else '—'}"
            + (f"   [{r['video_saca_por'] or '—'} · {r['video_fin_por'] or '—'}]" if r["video_inicio"] is not None else ""))
    if c.get("extras"):
        lines += ["", "PUNTOS DE MÁS (el vídeo ve un punto donde no marcaste ninguno)",
                  "  inicio    fin  saca  (visto por)            vel. saque  pasos red  toques  fin por"]
        for e in c["extras"]:
            lines.append(f"  {e['start']:>6.1f} {e['end']:>6.1f}  {e['server'] or '?':>4}  ({e['server_from'] or '—'})"
                         f"{'':<{max(0, 20 - len(e['server_from'] or '—'))}} {e['serve_speed'] or 0:>6} m/s"
                         f"  {e['crossings']:>9}  {e['touches']:>6}  {e['end_by'] or '—'}")
    return "\n".join(lines)


# ---------- Con los datos de la app (hora, ganador y motivo de cada punto) ----------

def align_app(app_ends: list, video_rallies: list, search=(-600.0, 600.0), step=0.5, tol=4.0) -> float:
    """Desfase (s) entre el reloj de la app y el del vídeo: el que hace coincidir más puntos de la app con el
    final de un punto del vídeo. Así no hace falta sincronizar nada a mano."""
    ends = np.array([r["end"] for r in video_rallies])
    if not len(ends) or not app_ends:
        return 0.0
    best, best_score = 0.0, -1.0
    for off in np.arange(search[0], search[1] + step, step):
        d = np.abs(ends[None, :] - (np.array(app_ends)[:, None] + off)).min(axis=1)
        score = float(np.sum(np.clip(1 - d / tol, 0, None)))
        if score > best_score:
            best, best_score = float(off), score
    return best


def with_app(analysis: dict, video_rallies: list, app_points: list) -> dict:
    """Cruza cada punto de la app (end = hora del toque en la app, ya en tiempo del vídeo; winner; how) con el
    vídeo: inicio del punto, duración, pasos de red, zona de la recepción y zona del ataque que dio el punto."""
    frames = analysis["frames"]
    t = np.array([f["t"] for f in frames])
    touches = [x | {"t": float(t[x["i"]])} for x in analysis["touches"]]
    crossings = [c | {"t": float(t[c["i"]])} for c in analysis["crossings"]]
    starts = sorted(r["start"] for r in video_rallies)
    rows = []
    for n, p in enumerate(app_points, 1):
        prev_end = app_points[n - 2]["end"] if n > 1 else -1e9
        cand = [s for s in starts if prev_end < s < p["end"]]
        start = cand[-1] if cand else None
        row = {"punto": n, "fin_app": p["end"], "gana": p["winner"], "como": norm_how(p.get("how")), "saca": p.get("server"),
               "inicio_video": start, "duracion": round(p["end"] - start, 1) if start is not None else None,
               "pasos_red": None, "zona_recepcion": None, "zona_ataque": None}
        if start is not None:
            cr = [c for c in crossings if start - 0.3 <= c["t"] <= p["end"]]
            row["pasos_red"] = len(cr)
            rec_side = OTHER.get(p.get("server")) if p.get("server") else (cr[0]["to"] if cr else None)
            rec = [x for x in touches if x["side"] == rec_side and x["zone"] and start < x["t"] < start + 3.5]
            row["zona_recepcion"] = rec[0]["zone"] if rec else None
            if p.get("how") in ("ataque", "bloqueo"):
                w = p["winner"]
                fin = [c for c in cr if c["from"] == w]
                if fin:
                    row["zona_ataque"] = _attacker_zone(frames, t, fin[-1], w)
        rows.append(row)
    n = len(rows)
    att = [r for r in rows if r["como"] in ("ataque", "bloqueo")]
    srv = [r for r in rows if r["saca"]]

    def pct(k, base):
        return round(100 * sum(1 for r in base if r[k] is not None) / len(base), 1) if base else None
    return {"rows": rows, "n": n, "start_pct": pct("inicio_video", rows), "reception_pct": pct("zona_recepcion", srv),
            "attack_zone_pct": pct("zona_ataque", att), "attacks": len(att)}


def _attacker_zone(frames, t, cross, side, window=1.0, reach=1.5):
    """Zona del jugador que golpeó el balón que pasó la red: el más cercano a la última vez que se vio el
    balón en su campo antes de pasar (el remate se pierde a menudo por lo rápido que va, el jugador no)."""
    i = int(np.searchsorted(t, cross["t"])) - 1
    while i >= 0 and t[i] >= cross["t"] - window:
        b = frames[i]["ball"]
        if b and frames[i]["ball_side"] == side:
            best, best_d = None, None
            for p in frames[i]["players"]:
                if p["side"] != side or not p["zone"]:
                    continue
                x1, y1, x2, y2 = p["box"]
                h = max(1.0, y2 - y1)
                d = math.hypot(max(x1 - b["u"], 0, b["u"] - x2), max(y1 - b["v"], 0, b["v"] - y2)) / h
                if best_d is None or d < best_d:
                    best, best_d = p, d
            if best is not None and best_d <= reach:
                return best["zone"]
            return None
        i -= 1
    return None


def with_app_text(w: dict) -> str:
    name = lambda h: REASONS.get(h, (h or "?",))[0]  # noqa: E731
    lines = [
        "CON LOS DATOS DE LA APP (hora, ganador y motivo de cada punto) + VÍDEO",
        f"  Ganador y motivo: 100% (los da la app). El vídeo añade, para cada punto:",
        f"  - Inicio del punto (saque) y duración: {w['start_pct']}% de los puntos",
        f"  - Zona donde se recibió el saque: {w['reception_pct']}% de los puntos",
        f"  - Zona desde la que se atacó, en los puntos de ataque/bloqueo: {w['attack_zone_pct']}% de {w['attacks']}",
        "",
        "  punto  gana  motivo                       saque→fin  pasos red  zona recep.  zona ataque",
    ]
    for r in w["rows"]:
        dur = "—" if r["duracion"] is None else f"{r['duracion']:.1f} s"
        lines.append(f"  {r['punto']:>5}  {r['gana'] or '?':>4}  {name(r['como']):<28} {dur:>9}  {r['pasos_red'] if r['pasos_red'] is not None else '—':>9}"
                     f"  {r['zona_recepcion'] or '—':>11}  {r['zona_ataque'] or '—':>11}")
    return "\n".join(lines)
