"""Lectura de vídeo y del archivo de detecciones (una línea JSON por fotograma)."""

from __future__ import annotations

import json
from contextlib import contextmanager

import cv2


def video_info(path) -> dict:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise FileNotFoundError(f"No se puede abrir el vídeo: {path}")
    info = {
        "fps": cap.get(cv2.CAP_PROP_FPS) or 30.0,
        "frames": int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
        "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
    }
    info["duration"] = info["frames"] / info["fps"] if info["fps"] else 0
    cap.release()
    return info


def read_frame(path, t: float):
    """Fotograma en el segundo `t`."""
    cap = cv2.VideoCapture(str(path))
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise ValueError(f"No hay fotograma en t={t}s")
    return frame


def iter_frames(path, start_frame=0, end_frame=None, stride=1):
    """Recorre los fotogramas [start_frame, end_frame) de `stride` en `stride`: (índice, imagen BGR)."""
    cap = cv2.VideoCapture(str(path))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    end = min(end_frame or total, total) if total > 0 else end_frame
    if start_frame:
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    idx = start_frame
    try:
        while end is None or idx < end:
            if (idx - start_frame) % stride == 0:
                ok, frame = cap.read()
                if not ok:
                    break
                yield idx, frame
            elif not cap.grab():
                break
            idx += 1
    finally:
        cap.release()


# ---------- Archivo de detecciones ----------

def write_detections(path, header: dict, frames):
    """`frames`: iterable de dict {f, persons, balls}. La primera línea es la cabecera."""
    with open(path, "w") as f:
        f.write(json.dumps({"header": header}) + "\n")
        for rec in frames:
            f.write(json.dumps(rec, separators=(",", ":")) + "\n")


def load_detections(path):
    """Devuelve (cabecera, lista de fotogramas)."""
    import gzip

    header, frames = None, []
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rt") as f:
        for line in f:
            rec = json.loads(line)
            if "header" in rec:
                header = rec["header"]
            else:
                frames.append(rec)
    return header, frames


@contextmanager
def video_writer(path, fps, size):
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    try:
        yield writer
    finally:
        writer.release()
