"""Métricas provisionales (arcos del balón y escala con la gravedad): python video/tests/test_provisional.py"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from voley_cv.provisional import G, _apex_height, find_arcs  # noqa: E402

FPS = 30
PXPM = 100  # px por metro de la «cámara» sintética
FEET = 800  # pies de los jugadores en la imagen


def ball_flight(t0, secs, top, n_frames_gap=0):
    """Balón que sale a 1 m y sube hasta `top` m: v en píxeles con la escala PXPM."""
    up = (2 * (top - 1) / G) ** 0.5
    out = []
    for k in range(int(secs * FPS)):
        t = k / FPS
        h = 1 + G * up * t - G * t * t / 2
        out.append({"t": t0 + t, "ball": {"u": 600 + 5 * k, "v": FEET - h * PXPM}, "ball_side": "A"} if h > 0.5 else None)
    return [f for f in out if f]


def analysis_with(frames):
    players = [{"box": [500, FEET - 175, 560, FEET], "in_play": True, "side": "A", "x": 6.0, "y": 4.0, "id": 1, "zone": 3}]
    for f in frames:
        f["players"] = players
    return {"frames": frames}


def test_arc_height_from_gravity():
    up = (2 * (5 - 1) / G) ** 0.5
    frames = ball_flight(0.0, 2 * up, top=5.0)
    a = analysis_with(frames)
    arcs = find_arcs(a, 0, len(frames))
    assert len(arcs) == 1, arcs
    arc = arcs[0]
    assert arc["clean"] and abs(arc["pxpm"] - PXPM) < 3, arc
    h = _apex_height(a["frames"], arc, "A")
    assert abs(h - 5.0) < 0.2, h


def test_two_passes_and_gap():
    up1, up2 = (2 * 3 / G) ** 0.5, (2 * 4 / G) ** 0.5
    first = ball_flight(0.0, 2 * up1, top=4.0)
    t_gap = first[-1]["t"] + 1 / FPS
    gap = [{"t": t_gap + k / FPS, "ball": None, "ball_side": None} for k in range(15)]  # 0,5 s sin balón
    second = ball_flight(gap[-1]["t"] + 1 / FPS, 2 * up2, top=5.0)
    a = analysis_with(first + gap + second)
    arcs = find_arcs(a, 0, len(a["frames"]))
    assert len(arcs) == 2, arcs
    hs = [_apex_height(a["frames"], arc, "A") for arc in arcs]
    assert abs(hs[0] - 4.0) < 0.2 and abs(hs[1] - 5.0) < 0.2, hs


if __name__ == "__main__":
    test_arc_height_from_gravity()
    test_two_passes_and_gap()
    print("OK")
