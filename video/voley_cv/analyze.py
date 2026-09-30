"""De las detecciones fotograma a fotograma a lo que pasa en el juego:
jugadores sobre el campo, trayectoria del balón, toques, pasos de red y posesiones (1-2-3).

Todo son reglas y geometría (como en la app): la red neuronal solo dice dónde hay personas y balón.
"""

from __future__ import annotations

import math

import numpy as np

from .court import Court, zone_of

# ---------- Parámetros (en unidades físicas: se adaptan a la cámara y a los fps) ----------
BALL_MAX_SPEED = 35.0  # m/s: nada va más rápido que un saque o remate fuerte
BALL_START_CONF = 0.3  # confianza mínima para empezar una trayectoria nueva
BALL_LOST_AFTER = 0.3  # s sin ver el balón → trayectoria perdida
INTERP_MAX_GAP = 0.15  # s de hueco que se rellenan interpolando
TOUCH_MIN_DV = 3.0  # m/s de cambio brusco de velocidad para considerar un toque
TOUCH_MIN_ANGLE = 25.0  # grados de cambio de dirección
TOUCH_MIN_GAP = 0.25  # s entre dos toques
TOUCH_MAX_DIST = 0.5  # distancia balón-jugador (en alturas de la caja del jugador) para asignar el toque
SIDE_CONFIRM = 3  # fotogramas seguidos al otro lado de la red para contar un paso de red
STATIC_CELL = 24  # px: tamaño de la cuadrícula para buscar «balones» quietos
STATIC_SECONDS = 8.0  # un «balón» que aparece tanto tiempo en el mismo sitio no es el balón en juego


def analyze(header: dict, frames: list, court: Court, use_tracker: bool = True) -> dict:
    fps = header["fps"] / header.get("stride", 1)  # fotogramas analizados por segundo
    dt = 1.0 / fps
    ppm = court.px_per_meter()

    players = _players(frames, court, fps, use_tracker)
    static = _static_cells(frames, dt)
    ball = _track_ball(frames, dt, ppm, static)
    sides = _ball_sides(ball, court)
    crossings = _crossings(frames, sides)
    touches = _touches(frames, ball, players, court, dt, ppm, sides)
    possessions = _possessions(touches, crossings)

    out_frames = []
    for i, rec in enumerate(frames):
        out_frames.append({"f": rec["f"], "t": rec["f"] / header["fps"], "players": players[i],
                           "ball": ball[i], "ball_side": sides[i]})
    result = {"header": header, "court": court.to_json(), "frames": out_frames, "touches": touches,
              "crossings": crossings, "possessions": possessions,
              "static_spots": [[(cx + 0.5) * STATIC_CELL, (cy + 0.5) * STATIC_CELL] for cx, cy in sorted(static)]}
    result["metrics"] = metrics(result)
    return result


# ---------- Jugadores ----------

def _players(frames, court: Court, fps, use_tracker):
    tracker = None
    if use_tracker:
        try:
            import supervision as sv
            tracker = sv.ByteTrack(frame_rate=max(1, round(fps)))
        except Exception:  # sin supervision se sigue sin identificadores
            tracker = None
    out = []
    for rec in frames:
        boxes = np.asarray([p[:4] for p in rec["persons"]], dtype=np.float32).reshape(-1, 4)
        confs = np.asarray([p[4] for p in rec["persons"]], dtype=np.float32)
        ids = [None] * len(boxes)
        if tracker is not None:
            import supervision as sv
            det = sv.Detections(xyxy=boxes, confidence=confs, class_id=np.zeros(len(boxes), dtype=int))
            tracked = tracker.update_with_detections(det)
            # Se recupera el identificador de cada caja original por coincidencia de coordenadas.
            for tb, tid in zip(tracked.xyxy, tracked.tracker_id):
                if len(boxes):
                    j = int(np.argmin(np.abs(boxes - tb).sum(axis=1)))
                    ids[j] = int(tid)
        items = []
        for box, conf, tid in zip(boxes.tolist(), confs.tolist(), ids):
            x, y = court.feet_position(box)
            side, zone = zone_of(x, y)
            items.append({"box": [round(v, 1) for v in box], "conf": round(conf, 3), "id": tid,
                          "x": round(x, 2), "y": round(y, 2), "side": side, "zone": zone,
                          "in_play": court.in_play_area(x, y)})
        out.append(items)
    return out


# ---------- Balón ----------

def _cell(b):
    return int((b[0] + b[2]) / 2 // STATIC_CELL), int((b[1] + b[3]) / 2 // STATIC_CELL)


def _static_cells(frames, dt):
    """Sitios de la imagen donde el modelo ve un «balón» durante mucho rato (luces, conos, un balón en el suelo,
    marcas del suelo…). El balón en juego nunca se queda tanto en el mismo sitio, así que se ignoran."""
    from collections import Counter

    counts = Counter()
    for rec in frames:
        counts.update({_cell(b) for b in rec["balls"]})
    need = STATIC_SECONDS / dt
    static = set()
    for (cx, cy) in counts:
        near = sum(counts.get((cx + dx, cy + dy), 0) for dx in (-1, 0, 1) for dy in (-1, 0, 1))
        if near >= need:
            static.add((cx, cy))
    # También las casillas vecinas: la detección tiembla unos píxeles alrededor del objeto.
    return static | {(cx + dx, cy + dy) for cx, cy in static for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                     if counts.get((cx + dx, cy + dy), 0)}


def _track_ball(frames, dt, ppm, static=frozenset()):
    """Una sola trayectoria de balón: en cada fotograma se elige la detección más cercana a la posición
    prevista (velocidad constante); si se pierde, se empieza de nuevo con la más segura.
    Se ignoran las detecciones en sitios «quietos» (`static`)."""
    max_step = BALL_MAX_SPEED * ppm * dt  # píxeles que puede recorrer entre fotogramas analizados
    lost_after = max(1, round(BALL_LOST_AFTER / dt))
    track = [None] * len(frames)
    last_i, last_p, vel = None, None, np.zeros(2)
    for i, rec in enumerate(frames):
        cands = [b for b in rec["balls"] if _cell(b) not in static]
        if not cands:
            continue
        centers = np.asarray([((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) for b in cands])
        confs = np.asarray([b[4] for b in cands])
        chosen = None
        if last_i is not None and i - last_i <= lost_after:
            gap = i - last_i
            pred = last_p + vel * gap
            d = np.linalg.norm(centers - pred, axis=1)
            j = int(np.argmin(d))
            if d[j] <= max_step * gap + 0.02 * ppm * 9:
                chosen = j
        if chosen is None:
            # Balón perdido: solo se empieza a seguir algo nuevo si se mueve como un balón en los
            # fotogramas siguientes (una cabeza o una rodillera que aparece un instante no vale).
            for j in np.argsort(-confs):
                if confs[j] >= BALL_START_CONF and _moves_like_ball(frames, i, centers[j], static, max_step, ppm):
                    chosen = int(j)
                    vel = np.zeros(2)
                    last_i = None
                    break
        if chosen is None:
            continue
        p = centers[chosen]
        if last_i is not None:
            vel = 0.5 * vel + 0.5 * (p - last_p) / (i - last_i)
        last_i, last_p = i, p
        track[i] = {"u": round(float(p[0]), 1), "v": round(float(p[1]), 1),
                    "conf": round(float(confs[chosen]), 3), "src": "det"}
    # Huecos cortos: interpolación lineal.
    max_gap = max(1, round(INTERP_MAX_GAP / dt))
    known = [i for i, b in enumerate(track) if b]
    for a, b in zip(known, known[1:]):
        gap = b - a
        if 1 < gap <= max_gap + 1:
            pa = np.array([track[a]["u"], track[a]["v"]])
            pb = np.array([track[b]["u"], track[b]["v"]])
            if np.linalg.norm(pb - pa) <= max_step * gap:
                for k in range(a + 1, b):
                    p = pa + (pb - pa) * (k - a) / gap
                    track[k] = {"u": round(float(p[0]), 1), "v": round(float(p[1]), 1), "conf": 0.0, "src": "interp"}
    return track


def _moves_like_ball(frames, i, p, static, max_step, ppm, window_s=0.1, min_move_m=0.3):
    """¿La detección `p` del fotograma `i` continúa en los siguientes como un balón en vuelo?
    Hace falta verla en al menos 2 de los próximos fotogramas (≈0,1 s) y que se haya movido ≥ 30 cm."""
    window = max(3, int(round(window_s / (max_step / (BALL_MAX_SPEED * ppm)))))
    pos, last_k, hits = np.asarray(p, dtype=float), 0, 0
    for k in range(1, window + 1):
        if i + k >= len(frames):
            break
        cands = [b for b in frames[i + k]["balls"] if _cell(b) not in static]
        if not cands:
            continue
        c = np.asarray([((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) for b in cands])
        d = np.linalg.norm(c - pos, axis=1)
        j = int(np.argmin(d))
        if d[j] <= max_step * (k - last_k) + 0.02 * ppm * 9:
            pos, last_k, hits = c[j], k, hits + 1
    return hits >= 2 and float(np.linalg.norm(pos - np.asarray(p))) >= min_move_m * ppm


def _ball_sides(ball, court: Court):
    return [court.image_side(b["u"], b["v"]) if b else None for b in ball]


def _crossings(frames, sides):
    """Pasos de red: el balón aparece al otro lado durante SIDE_CONFIRM fotogramas seguidos."""
    out = []
    current, streak, cand = None, 0, None
    for i, s in enumerate(sides):
        if s is None:
            continue
        if current is None:
            current = s
            continue
        if s != current:
            if s == cand:
                streak += 1
            else:
                cand, streak = s, 1
            if streak >= SIDE_CONFIRM:
                first = i - streak + 1
                out.append({"f": frames[first]["f"], "i": first, "from": current, "to": s})
                current, cand, streak = s, None, 0
        else:
            cand, streak = None, 0
    return out


# ---------- Toques ----------

def _touches(frames, ball, players, court: Court, dt, ppm, sides):
    """Toques = cambios bruscos de velocidad del balón (golpes), no la curva suave de la gravedad."""
    k = max(2, round(0.05 / dt))  # ventana a cada lado (≈ 50 ms)
    min_gap = max(1, round(TOUCH_MIN_GAP / dt))
    cands = []
    for run in _runs(ball):
        if len(run) < 2 * k + 1:
            continue
        pts = np.array([[ball[i]["u"], ball[i]["v"]] for i in run])
        pts = _smooth(pts)
        vel = np.gradient(pts, axis=0) / dt / ppm  # m/s aproximados (en el plano de la imagen)
        for j in range(k, len(run) - k):
            vb = vel[j - k:j].mean(axis=0)
            va = vel[j + 1:j + k + 1].mean(axis=0)
            dv = float(np.linalg.norm(va - vb))
            sb, sa = np.linalg.norm(vb), np.linalg.norm(va)
            angle = _angle(vb, va) if sb > 0.5 and sa > 0.5 else 0.0
            ratio = (sa + 1e-6) / (sb + 1e-6)
            if dv >= max(TOUCH_MIN_DV, 0.4 * max(sa, sb)) and (angle >= TOUCH_MIN_ANGLE or ratio > 1.6 or ratio < 0.6):
                cands.append((run[j], dv))
    # Supresión de no máximos: un toque por ventana de TOUCH_MIN_GAP.
    cands.sort(key=lambda c: -c[1])
    chosen = []
    for i, score in cands:
        if all(abs(i - c) >= min_gap for c, _ in chosen):
            chosen.append((i, score))
    chosen.sort()
    touches = []
    for i, score in chosen:
        b = ball[i]
        best, best_d = None, None
        for p in players[i]:
            if not p["in_play"]:
                continue
            x1, y1, x2, y2 = p["box"]
            h = max(1.0, y2 - y1)
            dx = max(x1 - b["u"], 0, b["u"] - x2)
            dy = max(y1 - b["v"], 0, b["v"] - y2)
            d = math.hypot(dx, dy) / h
            if best_d is None or d < best_d:
                best, best_d = p, d
        player = best if best_d is not None and best_d <= TOUCH_MAX_DIST else None
        touches.append({
            "f": frames[i]["f"], "i": i, "u": b["u"], "v": b["v"], "strength": round(score, 1),
            "side": player["side"] if player else sides[i],
            "player_id": player["id"] if player else None,
            "x": player["x"] if player else None, "y": player["y"] if player else None,
            "zone": player["zone"] if player else None,
            "height": round(float((player["box"][1] - b["v"]) / max(1.0, player["box"][3] - player["box"][1])), 2) if player else None,
        })
    return touches


def _possessions(touches, crossings):
    """Agrupa los toques por campo entre pasos de red: cada posesión debería tener 1-3 toques."""
    cross_idx = [c["i"] for c in crossings]
    out = []
    for n, t in enumerate(touches):
        last = out[-1] if out else None
        crossed = last is not None and any(last["end_i"] < c <= t["i"] for c in cross_idx)
        if last is None or crossed or t["side"] != last["side"]:
            out.append({"side": t["side"], "start_f": t["f"], "end_f": t["f"], "end_i": t["i"], "touches": [n]})
        else:
            last["touches"].append(n)
            last["end_f"], last["end_i"] = t["f"], t["i"]
    return out


# ---------- Utilidades ----------

def _runs(ball):
    """Tramos seguidos de fotogramas con balón."""
    runs, cur = [], []
    for i, b in enumerate(ball):
        if b:
            cur.append(i)
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return runs


def _smooth(pts, w=3):
    if len(pts) < w:
        return pts
    kernel = np.ones(w) / w
    pad = w // 2
    padded = np.pad(pts, ((pad, pad), (0, 0)), mode="edge")
    return np.stack([np.convolve(padded[:, c], kernel, mode="valid") for c in range(2)], axis=1)


def _angle(a, b):
    cos = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))
    return math.degrees(math.acos(max(-1.0, min(1.0, cos))))


# ---------- Métricas ----------

def metrics(result: dict) -> dict:
    frames = result["frames"]
    n = len(frames)
    if not n:
        return {}
    per_side = {"A": [], "B": []}
    for fr in frames:
        for s in ("A", "B"):
            per_side[s].append(sum(1 for p in fr["players"] if p["in_play"] and p["side"] == s))
    raw_ball = sum(1 for fr in frames if fr["ball"] and fr["ball"]["src"] == "det")
    any_ball = sum(1 for fr in frames if fr["ball"])
    by_side = {s: sum(1 for fr in frames if fr["ball_side"] == s) for s in ("A", "B")}
    poss_sizes = [len(p["touches"]) for p in result["possessions"]]
    return {
        "frames": n,
        "seconds": round((frames[-1]["t"] - frames[0]["t"]) if n > 1 else 0, 1),
        "players_mean": {s: round(float(np.mean(v)), 2) for s, v in per_side.items()},
        "players_5to7_pct": {s: round(100 * float(np.mean([(5 <= c <= 7) for c in v])), 1) for s, v in per_side.items()},
        "ball_detected_pct": round(100 * raw_ball / n, 1),
        "ball_tracked_pct": round(100 * any_ball / n, 1),
        "ball_frames_by_side": by_side,
        "ball_static_spots": len(result.get("static_spots", [])),
        "touches": len(result["touches"]),
        "touches_with_player_pct": round(100 * np.mean([t["player_id"] is not None or t["x"] is not None for t in result["touches"]]), 1) if result["touches"] else 0.0,
        "net_crossings": len(result["crossings"]),
        "possessions": len(poss_sizes),
        "touches_per_possession": {str(k): poss_sizes.count(k) for k in sorted(set(poss_sizes))},
    }
