"""Detección de personas y balón con RF-DETR.

Con el modelo preentrenado (COCO) se usan las clases «person» y «sports ball». El balón ocupa pocos
píxeles en un campo entero, así que además de la imagen completa se analiza por mosaicos (trozos
solapados) para verlo más grande. Con un modelo propio (reentrenado con vuestras imágenes) se usan
sus clases «balon» y «jugador».
"""

from __future__ import annotations

import time

import cv2
import numpy as np

from .device import pick_device

VARIANTS = {"nano": "RFDETRNano", "small": "RFDETRSmall", "medium": "RFDETRMedium", "large": "RFDETRLarge"}
PERSON_NAMES = {"person", "jugador", "player"}
BALL_NAMES = {"sports ball", "balon", "ball"}


class Detector:
    def __init__(self, model="small", weights=None, device=None, person_conf=0.35, ball_conf=0.15,
                 ball_tiles=(3, 2), overlap=0.15, half=True):
        import rfdetr

        self.device = device or pick_device()
        cls = getattr(rfdetr, VARIANTS[model])
        kwargs = {"device": self.device}
        if weights:
            kwargs["pretrain_weights"] = str(weights)
        try:
            self.model = cls(**kwargs)
        except TypeError:  # versiones sin el parámetro `device`
            kwargs.pop("device")
            self.model = cls(**kwargs)
        self.custom = bool(weights)
        self.names = self._names()
        self.person_conf, self.ball_conf = person_conf, ball_conf
        self.ball_tiles = tuple(ball_tiles)
        self.overlap = overlap
        self.name = f"rfdetr-{model}" + ("-propio" if weights else "-coco")
        if half and self.device == "cuda":
            try:
                import torch
                self.model.inference(dtype=torch.float16, compile=False)
            except Exception:
                pass

    def _names(self):
        if self.custom:
            return dict(enumerate(self.model.class_names))
        # El modelo COCO devuelve los identificadores oficiales de COCO (1 = person, 37 = sports ball).
        from rfdetr.assets.coco_classes import COCO_CLASSES
        return dict(COCO_CLASSES)

    def _tiles(self, W, H):
        cols, rows = self.ball_tiles
        if cols * rows <= 1:
            return []
        tw, th = W / (cols - (cols - 1) * self.overlap), H / (rows - (rows - 1) * self.overlap)
        out = []
        for r in range(rows):
            for c in range(cols):
                x0 = int(round(c * tw * (1 - self.overlap)))
                y0 = int(round(r * th * (1 - self.overlap)))
                out.append((x0, y0, min(W, int(round(x0 + tw))), min(H, int(round(y0 + th)))))
        return out

    def detect_batch(self, frames_bgr):
        """Lista de fotogramas BGR → lista de {persons, balls} con cajas [x1, y1, x2, y2, conf] en píxeles."""
        if not frames_bgr:
            return []
        H, W = frames_bgr[0].shape[:2]
        tiles = self._tiles(W, H)
        images, owners = [], []
        for k, fr in enumerate(frames_bgr):
            rgb = cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)
            images.append(rgb)
            owners.append((k, (0, 0)))
            for (x0, y0, x1, y1) in tiles:
                images.append(np.ascontiguousarray(rgb[y0:y1, x0:x1]))
                owners.append((k, (x0, y0)))
        thr = min(self.person_conf, self.ball_conf)
        preds = self.model.predict(images, threshold=thr, include_source_image=False)
        if not isinstance(preds, list):
            preds = [preds]
        persons = [[] for _ in frames_bgr]
        balls = [[] for _ in frames_bgr]
        for (k, (ox, oy)), det in zip(owners, preds):
            for box, conf, cid in zip(det.xyxy, det.confidence, det.class_id):
                name = self.names.get(int(cid), "")
                b = [float(box[0] + ox), float(box[1] + oy), float(box[2] + ox), float(box[3] + oy), float(conf)]
                if name in PERSON_NAMES and conf >= self.person_conf:
                    persons[k].append(b)
                elif name in BALL_NAMES and conf >= self.ball_conf:
                    balls[k].append(b)
        return [{"persons": _suppress(p, 0.6), "balls": _suppress(b, 0.3)} for p, b in zip(persons, balls)]


def _suppress(boxes, thr):
    """Quita duplicados (la misma cosa vista en la imagen completa y en varios mosaicos):
    se queda con la más segura si otra la cubre en más de `thr` de su área."""
    boxes = sorted(boxes, key=lambda b: -b[4])
    keep = []
    for b in boxes:
        area = max(1e-6, (b[2] - b[0]) * (b[3] - b[1]))
        dup = False
        for k in keep:
            iw = max(0.0, min(b[2], k[2]) - max(b[0], k[0]))
            ih = max(0.0, min(b[3], k[3]) - max(b[1], k[1]))
            inter = iw * ih
            if inter / min(area, max(1e-6, (k[2] - k[0]) * (k[3] - k[1]))) > thr:
                dup = True
                break
        if not dup:
            keep.append([round(v, 1) if i < 4 else round(v, 3) for i, v in enumerate(b)])
    return keep


def run_detection(video_path, detector: Detector, start_frame, end_frame, stride=1, batch=4, progress=True):
    """Detecta en un tramo del vídeo. Devuelve (lista de fotogramas, segundos de proceso)."""
    from .video_io import iter_frames

    try:
        from tqdm.auto import tqdm
    except ImportError:  # pragma: no cover
        tqdm = None
    total = (end_frame - start_frame + stride - 1) // stride
    bar = tqdm(total=total, desc="Detectando", unit="fot") if progress and tqdm else None
    out, buf = [], []
    t0 = time.time()

    def flush():
        res = detector.detect_batch([fr for _, fr in buf])
        for (f, _), r in zip(buf, res):
            out.append({"f": f, **r})
        if bar:
            bar.update(len(buf))
        buf.clear()

    for f, frame in iter_frames(video_path, start_frame, end_frame, stride):
        buf.append((f, frame))
        if len(buf) >= batch:
            flush()
    if buf:
        flush()
    if bar:
        bar.close()
    return out, time.time() - t0
