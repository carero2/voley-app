"""Puntos sacados solo del vídeo, con un partido sintético: python video/tests/test_rallies.py"""

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from voley_cv.analyze import analyze  # noqa: E402
from voley_cv.labels import load_rallies  # noqa: E402
from voley_cv.rallies import compare, comparison_text, infer_rallies  # noqa: E402
from test_analyze import make_court, player_box  # noqa: E402

FPS = 30


def hand(box):
    return np.array([(box[0] + box[2]) / 2, box[1] + 10])


def floor(court, x, y):
    return np.array(court.to_image([(x, y)])[0])


def flight(a, b, secs, arc=250):
    n = int(secs * FPS)
    return [a + (b - a) * (i / n) + np.array([0, -arc * 4 * (i / n) * (1 - i / n)]) for i in range(n + 1)]


def synthetic_match(court):
    srv_a = player_box(court, -0.5, 4.5)
    srv_b = player_box(court, 18.5, 4.5)
    pa = player_box(court, 5, 4.5)
    pb = player_box(court, 13, 4.5)
    net_a = player_box(court, 8.4, 3)
    persons = [srv_a, srv_b, pa, pb, net_a]
    track = []  # posición del balón por fotograma (None = no se ve)

    def pause(secs):
        track.extend([None] * int(secs * FPS))

    def hold(box, secs=0.5):
        track.extend([hand(box)] * int(secs * FPS))

    # Punto 1: saca A (desde detrás de su fondo) y el balón cae dentro del campo B: ace de A.
    pause(1)
    hold(srv_a)
    track.extend(flight(hand(srv_a), floor(court, 14, 5), 1.0))
    pause(10)
    # Punto 2: vuelve a sacar A; B recibe y ataca, el balón cae en A: punto de ataque de B.
    hold(srv_a)
    track.extend(flight(hand(srv_a), hand(pb), 1.0))
    track.extend(flight(hand(pb), floor(court, 4, 4), 0.5, arc=80)[1:])
    pause(10)
    # Punto 3: saca B y la manda fuera por detrás del fondo de A: error de saque de B.
    hold(srv_b)
    track.extend(flight(hand(srv_b), floor(court, -2.5, 4), 1.2))
    pause(10)
    # Punto 4: saca A; B recibe, se la pone y ataca; el bloqueo de A la devuelve al campo B: bloqueo de A.
    hold(srv_a)
    track.extend(flight(hand(srv_a), hand(pb), 1.0))
    track.extend(flight(hand(pb), hand(pb) + np.array([0, -5]), 0.8, arc=200)[1:])
    track.extend(flight(hand(pb), hand(net_a), 0.3, arc=20)[1:])
    track.extend(flight(hand(net_a), floor(court, 11, 4), 0.4, arc=30)[1:])
    pause(3)
    frames = []
    for i, p in enumerate(track):
        balls = [[p[0] - 6, p[1] - 6, p[0] + 6, p[1] + 6, 0.8]] if p is not None else []
        frames.append({"f": i, "persons": persons, "balls": balls})
    return {"fps": FPS, "stride": 1, "width": 1920, "height": 1080}, frames


def labels_file(tmp):
    data = {"version": 1, "view": "lateral", "firstServe": {"1": "A"}, "events": [
        {"t": 1.0, "type": "start"}, {"t": 3.5, "type": "point", "side": "A", "how": "ace"},
        {"t": 13.0, "type": "start"}, {"t": 15.5, "type": "point", "side": "B", "how": "ataque"},
        {"t": 25.0, "type": "start"}, {"t": 27.5, "type": "point", "side": "A", "how": "error_saque"},
        {"t": 37.5, "type": "start"}, {"t": 41.0, "type": "point", "side": "A", "how": "bloqueo"},
    ]}
    path = os.path.join(tmp, "etiquetas.json")
    with open(path, "w") as f:
        json.dump(data, f)
    return path


def test_labels_server():
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        labs = load_rallies(labels_file(tmp))
    assert [r["server"] for r in labs] == ["A", "A", "B", "A"]
    assert all(r["start_marked"] for r in labs)


def test_rallies_from_video():
    import tempfile

    court = make_court()
    header, frames = synthetic_match(court)
    res = analyze(header, frames, court, use_tracker=False)
    pred = infer_rallies(res, court)
    assert len(pred) == 4, pred
    assert [r["server"] for r in pred] == ["A", "A", "B", "A"], pred
    assert [r["winner"] for r in pred] == ["A", "B", "A", "A"], pred
    assert [r["winner_from"] for r in pred] == ["saque siguiente"] * 3 + ["final del balón"]
    assert [r["how"] for r in pred] == ["ace", "ataque", "error_saque", "bloqueo"], pred
    with tempfile.TemporaryDirectory() as tmp:
        c = compare(pred, load_rallies(labels_file(tmp)))
    assert c["found"] == 4 and c["extra_video"] == 0
    assert c["winner_pct"] == 100.0 and c["how_pct"] == 100.0 and c["server_pct"] == 100.0
    assert "Quién gana" in comparison_text(c)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("✓", name)
