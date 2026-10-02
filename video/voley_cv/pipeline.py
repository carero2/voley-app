"""Pasos completos, iguales en Colab y en el Mac: detectar → analizar → informe → vídeo anotado."""

from __future__ import annotations

import json
from pathlib import Path

from .analyze import analyze
from .court import Court
from .detect import Detector, run_detection
from .labels import load_rallies
from .rallies import compare, comparison_text, infer_rallies, with_app, with_app_text
from .render import contact_sheet, render
from .report import rally_report, summary_text
from .video_io import load_detections, video_info, write_detections


def detect_segment(video, out_path, start=0.0, end=None, stride=1, model="small", weights=None,
                   tiles=(3, 2), batch=4, detector=None):
    info = video_info(video)
    fps = info["fps"]
    start_f = int(start * fps)
    end_f = int((end if end is not None else info["duration"]) * fps)
    det = detector or Detector(model=model, weights=weights, ball_tiles=tiles)
    frames, secs = run_detection(video, det, start_f, end_f, stride=stride, batch=batch)
    header = {"video": Path(video).name, "fps": fps, "width": info["width"], "height": info["height"],
              "start_frame": start_f, "end_frame": end_f, "stride": stride, "model": det.name,
              "ball_tiles": "x".join(map(str, det.ball_tiles)), "device": det.device,
              "processing_seconds": round(secs, 1), "processing_fps": round(len(frames) / secs, 2) if secs else None}
    write_detections(out_path, header, frames)
    return header, frames


def analyze_file(det_path, court_path, out_path=None, rallies_path=None):
    header, frames = load_detections(det_path)
    court = Court.load(court_path)
    result = analyze(header, frames, court)
    text = summary_text(result)
    if rallies_path:
        rtext, rows = rally_report(result, load_rallies(rallies_path))
        result["rallies"] = rows
        text += "\n\nPOR PUNTOS (etiquetas a mano)\n" + rtext
    if header.get("processing_fps"):
        text += f"\n\nVelocidad de proceso: {header['processing_fps']} fotogramas/s en {header.get('device')}"
    if out_path:
        with open(out_path, "w") as f:
            json.dump(result, f, separators=(",", ":"))
    return result, text


def run_all(video, court_path, out_dir, start=0.0, end=None, stride=1, model="small", weights=None,
            tiles=(3, 2), rallies_path=None, make_video=True):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    tag = f"{int(start)}-{int(end)}s" if end is not None else f"{int(start)}s-fin"
    det_path = out / f"detecciones_{tag}.jsonl"
    detect_segment(video, det_path, start, end, stride, model, weights, tiles)
    result, text = analyze_file(det_path, court_path, out / f"analisis_{tag}.json", rallies_path)
    (out / f"resumen_{tag}.txt").write_text(text)
    court = Court.load(court_path)
    files = {"detecciones": str(det_path), "resumen": str(out / f"resumen_{tag}.txt"),
             "muestra": contact_sheet(video, result, court, out / f"muestra_{tag}.jpg")}
    if make_video:
        files["video"] = render(video, result, court, out / f"anotado_{tag}.mp4")
    return result, text, files


def frames_for_labeling(video, court_path, out_dir, n=300, every=2.0, model="small", weights=None, tiles=(3, 2)):
    """Recorre todo el vídeo (un fotograma cada `every` segundos), detecta y exporta `n` fotogramas variados
    con etiquetas previas para corregirlas en Roboflow."""
    from .labels import export_training_frames

    info = video_info(video)
    stride = max(1, int(round(every * info["fps"])))
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    det_path = out / "detecciones_muestreo.jsonl"
    header, frames = detect_segment(video, det_path, 0, None, stride, model, weights, tiles)
    court = Court.load(court_path) if court_path else None
    return export_training_frames(video, header, frames, court, out / "para_etiquetar", n)


def detect_chunked(video, folder, start=0.0, end=None, stride=2, model="small", weights=None, tiles=(3, 2),
                   chunk=60.0):
    """Detecta por trozos de `chunk` segundos y guarda cada trozo en `folder` en cuanto acaba.
    Si se corta (sesión de Colab, ordenador que se reinicia…), al repetir se salta los trozos ya hechos."""
    import math
    import os

    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    if not Path(video).exists():
        # Sin el vídeo (sesión nueva sin descargarlo) se puede reanalizar con los trozos ya detectados.
        parts = sorted(folder.glob("parte_*.jsonl"))
        if not parts:
            raise FileNotFoundError(f"Falta el vídeo ({video}): ejecuta la celda 2.")
        print(f"Sin vídeo: uso los {len(parts)} trozos ya detectados de {folder}")
        header, frames, secs = None, [], 0.0
        for part in parts:
            h, fr = load_detections(part)
            header = header or dict(h)
            frames.extend(fr)
            secs += h.get("processing_seconds") or 0.0
        header["end_frame"] = frames[-1]["f"] + 1 if frames else header["end_frame"]
        header["processing_seconds"] = round(secs, 1)
        return header, frames
    info = video_info(video)
    end = info["duration"] if end is None else min(end, info["duration"])
    n = max(1, math.ceil((end - start) / chunk))
    det, header, frames, secs = None, None, [], 0.0
    for k in range(n):
        s, e = start + k * chunk, min(end, start + (k + 1) * chunk)
        part = folder / f"parte_{int(s):05d}-{int(e):05d}.jsonl"
        if part.exists():
            h, fr = load_detections(part)
        else:
            print(f"Trozo {k + 1}/{n}: {int(s)}-{int(e)} s")
            det = det or Detector(model=model, weights=weights, ball_tiles=tiles)
            tmp = part.with_suffix(".tmp")
            h, fr = detect_segment(video, tmp, s, e, stride, model, weights, tiles, detector=det)
            os.replace(tmp, part)  # el trozo solo cuenta cuando está completo
        header = header or dict(h)
        frames.extend(fr)
        secs += h.get("processing_seconds") or 0.0
    header["end_frame"] = int(end * header["fps"])
    header["processing_seconds"] = round(secs, 1)
    header["processing_fps"] = round(len(frames) / secs, 2) if secs else None
    return header, frames


def rallies_vs_labels(video, court_path, out_dir, labels_path, stride=2, model="small", weights=None, tiles=(3, 2),
                      start=0.0, end=None):
    """Vídeo entero (o un tramo): puntos sacados solo del vídeo y comparación con los marcados a mano.
    Las detecciones (lo lento) se guardan por trozos en `out_dir` y se reutilizan al repetir."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    name = f"{model}-{'propio' if weights else 'coco'}"
    tag = f"{int(start)}-{int(end)}s" if end is not None else f"{int(start)}s-fin"
    legacy = out / f"detecciones_puntos_{tag}_{name}_cada{stride}.jsonl"  # versión anterior: un solo archivo
    if legacy.exists():
        print("Reutilizo las detecciones de", legacy.name)
        header, frames = load_detections(legacy)
    else:
        header, frames = detect_chunked(video, out / f"detecciones_{Path(video).stem}_{name}_cada{stride}",
                                        start, end, stride, model, weights, tiles)
    court = Court.load(court_path)
    analysis = analyze(header, frames, court)
    pred = infer_rallies(analysis, court)
    labels = load_rallies(labels_path)
    t0, t1 = analysis["frames"][0]["t"], analysis["frames"][-1]["t"]
    labels = [r for r in labels if r["end"] >= t0 and r["start"] <= t1]
    cmp = compare(pred, labels)
    app = with_app(analysis, pred, labels)
    text = summary_text(analysis) + "\n\n" + comparison_text(cmp) + "\n\n" + with_app_text(app)
    (out / f"puntos_{tag}_{name}.txt").write_text(text)
    with open(out / f"puntos_{tag}_{name}.json", "w") as f:
        json.dump({"video": pred, "comparacion": cmp, "con_app": app}, f, ensure_ascii=False, indent=1)
    return pred, cmp, text


def evaluate_folder(folder):
    """Reanaliza una carpeta de `datos/` (campo.json, detecciones*.jsonl[.gz], etiquetas.json) sin vídeo ni GPU."""
    folder = Path(folder)
    det = sorted(folder.glob("detecciones*.jsonl*"))[0]
    header, frames = load_detections(det)
    court = Court.load(folder / "campo.json")
    analysis = analyze(header, frames, court)
    pred = infer_rallies(analysis, court)
    labels = load_rallies(folder / "etiquetas.json")
    cmp = compare(pred, labels)
    app = with_app(analysis, pred, labels)
    return analysis, pred, cmp, (summary_text(analysis) + "\n\n" + comparison_text(cmp) + "\n\n"
                                 + with_app_text(app))


QUALITY = {"media": (1280, 28), "media-baja": (960, 30), "baja": (640, 32)}  # ancho máximo (px), crf


def annotated_video(video, detections, court_path, out_path, labels_path=None, quality="media-baja"):
    """Vídeo entero con jugadores, balón, toques y minimapa, a partir de detecciones ya hechas (no hace falta
    GPU). `detections`: archivo .jsonl[.gz] o carpeta con los trozos parte_*.jsonl. Con `labels_path`
    (etiquetas de la herramienta) añade el rótulo del punto y el marcador."""
    import os

    det = Path(detections)
    if det.is_dir():
        parts = sorted(det.glob("parte_*.jsonl"))
        if not parts:
            raise FileNotFoundError(f"No hay trozos parte_*.jsonl en {det}")
        header, frames = None, []
        for part in parts:
            h, fr = load_detections(part)
            header = header or dict(h)
            frames.extend(fr)
    else:
        header, frames = load_detections(det)
    info = video_info(video)
    if abs(info["fps"] - header["fps"]) > 1 or info["frames"] < frames[-1]["f"]:
        print(f"Ojo: el vídeo ({info['fps']:.0f} fps, {info['frames']} fotogramas) no parece el de las detecciones "
              f"({header['fps']:.0f} fps, hasta el fotograma {frames[-1]['f']}).")
    court = Court.load(court_path)
    analysis = analyze(header, frames, court)
    points = load_rallies(labels_path) if labels_path else None
    width, crf = QUALITY[quality]
    out = render(video, analysis, court, out_path, max_width=width, crf=crf, points=points,
                 progress=True, static=False)
    if out != str(out_path) and os.path.exists(out):
        os.replace(out, out_path)  # el mp4 intermedio (sin comprimir bien) no hace falta
        out = str(out_path)
    return out
