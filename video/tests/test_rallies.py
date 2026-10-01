"""Puntos sacados solo del vídeo, con un partido sintético: python video/tests/test_rallies.py"""

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from voley_cv.analyze import analyze  # noqa: E402
from voley_cv.labels import load_rallies  # noqa: E402
from voley_cv.rallies import align_app, compare, comparison_text, infer_rallies, with_app  # noqa: E402
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
    persons = [srv_a, pa, pb, net_a]  # el sacador de B no se detecta (lejos, tapado…)
    track = []  # posición del balón por fotograma (None = no se ve)
    moving = []  # ¿los jugadores se mueven? (quietos esperando el saque; en movimiento durante el punto)

    def pause(secs, moving_first=3.0):
        n = int(secs * FPS)
        track.extend([None] * n)
        moving.extend([k < moving_first * FPS for k in range(n)])

    def hold(box, secs=2.5):  # el sacador bota el balón y se prepara: todos quietos
        n = int(secs * FPS)
        track.extend([hand(box)] * n)
        moving.extend([False] * n)

    def fly(a, b, secs, arc=250, skip_first=False):
        pts = flight(a, b, secs, arc)[1 if skip_first else 0:]
        track.extend(pts)
        moving.extend([True] * len(pts))

    # Punto 1: saca A (desde detrás de su fondo) y el balón cae dentro del campo B: ace de A.
    pause(1, moving_first=0)
    hold(srv_a)
    fly(hand(srv_a), floor(court, 14, 5), 1.0)
    pause(10)
    # Punto 2: vuelve a sacar A; B recibe y ataca, el balón cae en A: punto de ataque de B.
    # Después bota y se lo pasan por debajo de la red al que va a sacar (eso ya no es el punto).
    hold(srv_a)
    fly(hand(srv_a), hand(pb), 1.0)
    up = np.array([0, -120])  # el remate se golpea por encima de la cabeza
    fly(hand(pb), hand(pb) + up, 0.6, arc=60, skip_first=True)
    fly(hand(pb) + up, floor(court, 2, 1), 0.5, arc=20, skip_first=True)
    fly(floor(court, 2, 1), floor(court, 3.5, 0.5), 0.5, arc=60, skip_first=True)
    fly(floor(court, 3.5, 0.5), floor(court, 15, 5), 3.0, arc=0, skip_first=True)  # rodando
    pause(10)
    # Punto 3: saca B y la manda fuera por detrás del fondo de A: error de saque de B.
    hold(srv_b)
    fly(hand(srv_b), floor(court, -2.5, 4), 1.2)
    pause(10)
    # Punto 4: saca A; B recibe, se la pone y ataca; el bloqueo de A la devuelve al campo B: bloqueo de A.
    hold(srv_a)
    fly(hand(srv_a), hand(pb), 1.0)
    up = np.array([0, -120])
    fly(hand(pb), hand(pb) + up, 0.8, arc=200, skip_first=True)
    fly(hand(pb) + up, hand(net_a) + up, 0.3, arc=20, skip_first=True)
    fly(hand(net_a) + up, floor(court, 11, 4), 0.4, arc=30, skip_first=True)
    pause(4)
    frames = []
    for i, (p, mv) in enumerate(zip(track, moving)):
        balls = [[p[0] - 6, p[1] - 6, p[0] + 6, p[1] + 6, 0.8]] if p is not None else []
        shift = [25 * np.sin(2 * np.pi * i / FPS + k) if mv else 0.0 for k in range(len(persons))]
        boxes = [[b[0] + d, b[1], b[2] + d, b[3], b[4]] for b, d in zip(persons, shift)]
        frames.append({"f": i, "persons": boxes, "balls": balls})
    return {"fps": FPS, "stride": 1, "width": 1920, "height": 1080}, frames


def labels_file(tmp):
    data = {"version": 1, "view": "lateral", "firstServe": {"1": "A"}, "events": [
        {"t": 1.5, "type": "start"}, {"t": 6.0, "type": "point", "side": "A", "how": "ace"},
        {"t": 15.0, "type": "start"}, {"t": 20.5, "type": "point", "side": "B", "how": "ataque"},
        {"t": 33.0, "type": "start"}, {"t": 37.5, "type": "point", "side": "A", "how": "error_saque"},
        {"t": 46.5, "type": "start"}, {"t": 51.5, "type": "point", "side": "A", "how": "bloqueo"},
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
    assert [r["winner_from"] for r in pred] == ["saque siguiente"] * 3 + ["último paso de red"]
    assert [r["how"] for r in pred] == ["ace", "ataque", "error_saque", "bloqueo"], pred
    assert pred[1]["crossings"] == 2  # no cuenta el pase por debajo de la red al acabar el punto
    assert pred[2]["server_from"] == "paso de red"  # sacador de B sin detectar: se ve por el balón
    with tempfile.TemporaryDirectory() as tmp:
        c = compare(pred, load_rallies(labels_file(tmp)))
    assert c["found"] == 4 and c["extra_video"] == 0
    assert c["winner_pct"] == 100.0 and c["how_pct"] == 100.0 and c["server_pct"] == 100.0
    assert "Quién gana" in comparison_text(c)
    # Con la app: el reloj de la app va 50 s por detrás del vídeo y se recupera solo.
    labs = load_rallies(labels_file(tempfile.mkdtemp()))
    assert abs(align_app([r["end"] - 50 for r in labs], pred) - 50) <= 1.0
    w = with_app(res, pred, labs)
    assert w["start_pct"] == 100.0 and w["rows"][1]["pasos_red"] >= 2


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("✓", name)
