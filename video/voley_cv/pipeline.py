"""Pasos completos, iguales en Colab y en el Mac: detectar → analizar → informe → vídeo anotado."""

from __future__ import annotations

import json
from pathlib import Path

from .analyze import analyze
from .court import Court
from .detect import Detector, run_detection
from .labels import load_rallies
from .rallies import compare, comparison_text, infer_rallies
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


def rallies_vs_labels(video, court_path, out_dir, labels_path, stride=2, model="small", weights=None, tiles=(3, 2),
                      start=0.0, end=None):
    """Vídeo entero (o un tramo): puntos sacados solo del vídeo y comparación con los marcados a mano.
    Si ya hay detecciones de ese tramo con el mismo modelo y paso, se reutilizan (la detección es lo lento)."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    name = f"{model}-{'propio' if weights else 'coco'}"
    tag = f"{int(start)}-{int(end)}s" if end is not None else f"{int(start)}s-fin"
    det_path = out / f"detecciones_puntos_{tag}_{name}_cada{stride}.jsonl"
    if det_path.exists():
        header, frames = load_detections(det_path)
        print("Reutilizo las detecciones de", det_path.name)
    else:
        header, frames = detect_segment(video, det_path, start, end, stride, model, weights, tiles)
    court = Court.load(court_path)
    analysis = analyze(header, frames, court)
    pred = infer_rallies(analysis, court)
    labels = load_rallies(labels_path)
    t0, t1 = analysis["frames"][0]["t"], analysis["frames"][-1]["t"]
    labels = [r for r in labels if r["end"] >= t0 and r["start"] <= t1]
    cmp = compare(pred, labels)
    text = summary_text(analysis) + "\n\n" + comparison_text(cmp)
    (out / f"puntos_{tag}_{name}.txt").write_text(text)
    with open(out / f"puntos_{tag}_{name}.json", "w") as f:
        json.dump({"video": pred, "comparacion": cmp}, f, ensure_ascii=False, indent=1)
    return pred, cmp, text
