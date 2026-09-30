"""Etiquetas: fotogramas para entrenar (con etiquetas previas del modelo) y puntos marcados a mano."""

from __future__ import annotations

import json
import random
import shutil
from pathlib import Path

import cv2

from .court import Court
from .video_io import iter_frames

CLASSES = ["balon", "jugador"]


def export_training_frames(video_path, header, frames, court: Court | None, out_dir, n=300, seed=0):
    """Guarda `n` fotogramas en formato YOLO (imagen + .txt con las cajas que ya detecta el modelo),
    listos para subir a Roboflow y corregir a mano. Mitad repartidos por el vídeo y mitad donde el
    modelo no vio el balón (los casos difíciles son los que más enseñan)."""
    rng = random.Random(seed)
    out = Path(out_dir)
    (out / "images").mkdir(parents=True, exist_ok=True)
    (out / "labels").mkdir(parents=True, exist_ok=True)
    idx_all = list(range(len(frames)))
    no_ball = [i for i in idx_all if not frames[i]["balls"]]
    half = n // 2
    step = max(1, len(idx_all) // max(1, n - min(half, len(no_ball))))
    picks = set(idx_all[::step][: n - min(half, len(no_ball))])
    picks |= set(rng.sample(no_ball, min(half, len(no_ball))))
    picks = sorted(picks)[:n]
    W, H = header["width"], header["height"]
    wanted = {frames[i]["f"]: frames[i] for i in picks}
    stem = Path(header.get("video", "video")).stem
    written = 0
    for f, img in iter_frames(video_path, min(wanted), max(wanted) + 1):
        rec = wanted.get(f)
        if rec is None:
            continue
        name = f"{stem}_f{f:06d}"
        cv2.imwrite(str(out / "images" / f"{name}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        lines = []
        for b in rec["balls"]:
            if b[4] >= 0.3:
                lines.append(_yolo(0, b, W, H))
        # Todas las personas (también banquillo, árbitros y público cercano): al detector se le enseña a
        # ver personas; quién está jugando lo decide después la calibración del campo. Dejar personas sin
        # caja le enseñaría que «eso no es una persona» y empeoraría la detección de los jugadores.
        for p in rec["persons"]:
            lines.append(_yolo(1, p, W, H))
        (out / "labels" / f"{name}.txt").write_text("\n".join(lines))
        written += 1
    (out / "data.yaml").write_text("names:\n" + "".join(f"  {i}: {c}\n" for i, c in enumerate(CLASSES)) + "nc: 2\n")
    zip_path = shutil.make_archive(str(out), "zip", out)
    return written, zip_path


def _yolo(cls, box, W, H):
    x1, y1, x2, y2 = box[:4]
    cx, cy = (x1 + x2) / 2 / W, (y1 + y2) / 2 / H
    w, h = (x2 - x1) / W, (y2 - y1) / H
    return f"{cls} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}"


# ---------- Puntos marcados a mano (herramienta video/etiquetar) ----------

def load_rallies(path):
    """Lee las etiquetas de puntos y devuelve la lista de puntos:
    [{start, end, winner ('A'/'B'), set}] con tiempos en segundos del vídeo."""
    with open(path) as f:
        data = json.load(f)
    events = sorted(data.get("events", []), key=lambda e: e["t"])
    rallies, start, set_n = [], None, 1
    for e in events:
        if e["type"] == "set":
            set_n += 1
            start = None
        elif e["type"] == "start":
            start = e["t"]
        elif e["type"] == "point":
            # Sin «inicio» marcado, el punto empieza unos segundos después del anterior.
            s = start if start is not None else (rallies[-1]["end"] + 3.0 if rallies else max(0.0, e["t"] - 12.0))
            rallies.append({"start": s, "end": e["t"], "winner": e.get("side"), "set": set_n})
            start = None
    return rallies
