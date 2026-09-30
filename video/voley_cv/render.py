"""Vídeo anotado: jugadores por campo, balón con estela, toques y minimapa del punto (arriba a la derecha)."""

from __future__ import annotations

import shutil
import subprocess

import cv2
import numpy as np

from .court import LENGTH, WIDTH, Court
from .video_io import iter_frames, video_writer

COLORS = {"A": (235, 140, 40), "B": (40, 140, 245), None: (150, 150, 150)}  # BGR: A azul, B naranja
BALL = (0, 255, 255)
TOUCH = (60, 60, 255)


def render(video_path, analysis: dict, court: Court, out_path, minimap=True, trail=20, max_width=1280):
    """Dibuja el análisis sobre el vídeo. `max_width` reduce el tamaño para verlo cómodo en el navegador."""
    header = analysis["header"]
    frames = analysis["frames"]
    by_f = {fr["f"]: fr for fr in frames}
    touches_by_f = {}
    for n, t in enumerate(analysis["touches"]):
        touches_by_f.setdefault(t["f"], []).append(n)
    first, last = frames[0]["f"], frames[-1]["f"] + 1
    stride = header.get("stride", 1)
    fps = header["fps"] / stride
    scale = min(1.0, max_width / header["width"]) if max_width else 1.0
    size = (int(header["width"] * scale) // 2 * 2, int(header["height"] * scale) // 2 * 2)
    history = []  # últimas posiciones del balón
    recent_touches = []  # toques del punto en curso (para el minimapa)
    flash = {}  # toques recién ocurridos: se resaltan unos fotogramas
    with video_writer(out_path, fps, size) as writer:
        for f, frame in iter_frames(video_path, first, last, stride):
            fr = by_f.get(f)
            if fr is None:
                continue
            _draw_players(frame, fr)
            for u, v in analysis.get("static_spots", []):  # falsos balones ignorados
                cv2.drawMarker(frame, (int(u), int(v)), (140, 140, 140), cv2.MARKER_TILTED_CROSS, 14, 1, cv2.LINE_AA)
            b = fr["ball"]
            history.append((int(b["u"]), int(b["v"])) if b else None)
            history = history[-trail:]
            _draw_ball(frame, history, b)
            for n in touches_by_f.get(f, []):
                flash[n] = 8
                recent_touches.append(analysis["touches"][n])
            # Un hueco largo sin balón = fin del punto: se limpia el minimapa.
            if not any(history):
                recent_touches = []
            for n in list(flash):
                t = analysis["touches"][n]
                cv2.circle(frame, (int(t["u"]), int(t["v"])), 22, TOUCH, 3, cv2.LINE_AA)
                label = f"{t['side'] or '?'}{' Z' + str(t['zone']) if t['zone'] else ''}"
                cv2.putText(frame, label, (int(t["u"]) + 24, int(t["v"])), cv2.FONT_HERSHEY_SIMPLEX, 0.8, TOUCH, 2, cv2.LINE_AA)
                flash[n] -= 1
                if flash[n] <= 0:
                    del flash[n]
            if minimap:
                _draw_minimap(frame, fr, recent_touches[-8:])
            cv2.putText(frame, f"{fr['t']:.2f}s  f{f}", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2, cv2.LINE_AA)
            writer.write(cv2.resize(frame, size) if scale < 1 else frame)
    return to_h264(out_path)


def _draw_players(frame, fr):
    for p in fr["players"]:
        x1, y1, x2, y2 = map(int, p["box"])
        color = COLORS[p["side"]] if p["in_play"] else COLORS[None]
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        if p["in_play"]:
            tag = f"{p['id'] if p['id'] is not None else ''} Z{p['zone']}" if p["zone"] else f"{p['id'] if p['id'] is not None else ''}"
            cv2.putText(frame, tag.strip(), (x1, y1 - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2, cv2.LINE_AA)


def _draw_ball(frame, history, b):
    pts = [p for p in history if p]
    for a, c in zip(pts, pts[1:]):
        cv2.line(frame, a, c, BALL, 2, cv2.LINE_AA)
    if b:
        cv2.circle(frame, (int(b["u"]), int(b["v"])), 10, BALL if b["src"] == "det" else (0, 180, 180), 2, cv2.LINE_AA)


def _draw_minimap(frame, fr, touches, scale=22, margin=20):
    w, h = int(LENGTH * scale), int(WIDTH * scale)
    H, W = frame.shape[:2]
    x0, y0 = W - w - margin, margin
    overlay = frame.copy()
    cv2.rectangle(overlay, (x0 - 8, y0 - 8), (x0 + w + 8, y0 + h + 8), (30, 30, 30), -1)
    cv2.addWeighted(overlay, 0.6, frame, 0.4, 0, frame)

    def pt(x, y):  # y del campo hacia arriba en el minimapa (vista cenital con la cámara abajo)
        return int(x0 + x * scale), int(y0 + h - y * scale)

    cv2.rectangle(frame, pt(0, WIDTH), pt(LENGTH, 0), (220, 220, 220), 1)
    cv2.line(frame, pt(9, 0), pt(9, WIDTH), (255, 255, 255), 2)
    for x in (6, 12):
        cv2.line(frame, pt(x, 0), pt(x, WIDTH), (160, 160, 160), 1)
    for p in fr["players"]:
        if p["in_play"]:
            cv2.circle(frame, pt(p["x"], p["y"]), 5, COLORS[p["side"]], -1, cv2.LINE_AA)
    path = [pt(t["x"], t["y"]) for t in touches if t["x"] is not None]
    for a, c in zip(path, path[1:]):
        cv2.line(frame, a, c, BALL, 1, cv2.LINE_AA)
    for p in path:
        cv2.circle(frame, p, 4, TOUCH, -1, cv2.LINE_AA)


def to_h264(path):
    """Convierte a H.264 (se ve en el navegador y en Colab) si hay ffmpeg; si no, deja el mp4 tal cual."""
    if not shutil.which("ffmpeg"):
        return str(path)
    out = str(path).replace(".mp4", "_h264.mp4")
    r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-c:v", "libx264", "-preset", "veryfast",
                        "-crf", "23", "-pix_fmt", "yuv420p", out])
    return out if r.returncode == 0 else str(path)


def contact_sheet(video_path, analysis, court: Court, out_path, n=6):
    """Imagen con varios fotogramas anotados (para compartir un vistazo rápido sin el vídeo)."""
    frames = analysis["frames"]
    picks = [frames[int(i)] for i in np.linspace(0, len(frames) - 1, n)]
    tiles = []
    for fr in picks:
        img = next(iter_frames(video_path, fr["f"], fr["f"] + 1))[1]
        _draw_players(img, fr)
        if fr["ball"]:
            _draw_ball(img, [(int(fr["ball"]["u"]), int(fr["ball"]["v"]))], fr["ball"])
        img = court.draw_overlay(img, thickness=1)
        tiles.append(cv2.resize(img, (960, int(960 * img.shape[0] / img.shape[1]))))
    rows = [np.hstack(tiles[i:i + 2]) for i in range(0, len(tiles) - 1, 2)]
    cv2.imwrite(str(out_path), np.vstack(rows))
    return str(out_path)
