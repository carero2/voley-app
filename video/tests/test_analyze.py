"""Pruebas del análisis con datos sintéticos (sin red neuronal): python -m pytest video/tests  o  python video/tests/test_analyze.py"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from voley_cv.analyze import analyze  # noqa: E402
from voley_cv.court import Court, zone_of  # noqa: E402

# Vista lateral en perspectiva, parecida a la grabación real (1920x1080).
CORNERS = [(300, 780), (1630, 780), (1330, 545), (600, 545)]


def make_court():
    return Court.from_clicks("lateral", CORNERS, (1920, 1080))


def test_zones():
    # Campo A (x < 9) mira hacia +x: su izquierda es el fondo (y = 9).
    assert zone_of(8, 8) == ("A", 4)
    assert zone_of(8, 1) == ("A", 2)
    assert zone_of(1, 4.5) == ("A", 6)
    assert zone_of(1, 1) == ("A", 1)
    # Campo B (x > 9) mira hacia -x: su izquierda es el lado cercano (y = 0).
    assert zone_of(10, 1) == ("B", 4)
    assert zone_of(10, 8) == ("B", 2)
    assert zone_of(17, 8) == ("B", 1)
    assert zone_of(20, 4) == ("B", None)


def test_calibration_roundtrip():
    court = make_court()
    assert court.reprojection_error() < 1e-6
    x, y = court.to_court([CORNERS[2]])[0]
    assert abs(x - 18) < 1e-6 and abs(y - 9) < 1e-6
    # Centro del campo en la imagen → red.
    u, v = court.to_image([(9, 4.5)])[0]
    assert court.image_side(u - 50, v) == "A" and court.image_side(u + 50, v) == "B"


def player_box(court, x, y, h=160):
    u, v = court.to_image([(x, y)])[0]
    return [u - 25, v - h, u + 25, v, 0.9]


def test_touches_and_crossing():
    """El balón sale de un jugador de A, cruza la red, un jugador de B lo toca y vuelve."""
    court = make_court()
    fps = 60
    ppm = court.px_per_meter()
    pa = player_box(court, 6, 4.5)
    pb = player_box(court, 13, 4.5)
    start = np.array([(pa[0] + pa[2]) / 2, pa[1] + 10])
    hit_b = np.array([(pb[0] + pb[2]) / 2, pb[1] + 10])
    frames = []
    n1, n2 = 60, 60
    for i in range(n1 + n2 + 30):
        if i < n1:  # de A hacia B con parábola
            s = i / n1
            p = start + (hit_b - start) * s + np.array([0, -300 * 4 * s * (1 - s)])
        elif i < n1 + n2:  # golpe en B: vuelve hacia A, más rápido y por arriba
            s = (i - n1) / n2
            p = hit_b + (start - hit_b) * s + np.array([0, -200 * 4 * s * (1 - s)])
        else:
            p = None
        balls = [[p[0] - 6, p[1] - 6, p[0] + 6, p[1] + 6, 0.8]] if p is not None else []
        frames.append({"f": i, "persons": [pa, pb], "balls": balls})
    header = {"fps": fps, "stride": 1, "width": 1920, "height": 1080}
    res = analyze(header, frames, court, use_tracker=False)
    m = res["metrics"]
    assert m["ball_detected_pct"] > 75
    assert m["players_mean"] == {"A": 1.0, "B": 1.0}
    assert m["net_crossings"] == 2, res["crossings"]
    touch_frames = [t["f"] for t in res["touches"]]
    # El golpe de B (fotograma 60) tiene que aparecer y asignarse a B.
    near = [t for t in res["touches"] if abs(t["f"] - n1) <= 3]
    assert near, touch_frames
    assert near[0]["side"] == "B" and near[0]["zone"] in (3, 4, 2, 6)
    assert ppm > 10


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("✓", name)
