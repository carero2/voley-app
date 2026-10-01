"""Línea de comandos: python -m voley_cv <orden> ... (igual en Colab, Mac o PC)."""

from __future__ import annotations

import argparse
import json
import sys

import cv2


def _pt(s):
    u, v = s.split(",")
    return [float(u), float(v)]


def _pt_or_none(s):
    return None if s.strip() == "-" else _pt(s)


def _tiles(s):
    c, r = s.lower().split("x")
    return int(c), int(r)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="voley_cv", description="Análisis de vídeo de voleibol")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("info", help="datos del vídeo")
    p.add_argument("video")

    p = sub.add_parser("frame", help="guardar un fotograma")
    p.add_argument("video")
    p.add_argument("--t", type=float, default=10.0, help="segundo")
    p.add_argument("--out", default="fotograma.jpg")

    p = sub.add_parser("calibrate", help="calibrar el campo (esquinas en píxeles o marcadas con el ratón)")
    p.add_argument("video")
    p.add_argument("--t", type=float, default=10.0)
    p.add_argument("--view", choices=["lateral", "fondo"], default="lateral")
    p.add_argument("--corners", nargs=4, type=_pt_or_none, metavar="U,V", help="4 esquinas en orden; «-» si una queda fuera (sin esto se abre una ventana)")
    p.add_argument("--centro", nargs=2, type=_pt, metavar="U,V", help="extremos de la línea central (opcional)")
    p.add_argument("--out", default="campo.json")
    p.add_argument("--preview", default="campo_comprobacion.jpg")

    p = sub.add_parser("detect", help="detectar personas y balón en un tramo")
    p.add_argument("video")
    p.add_argument("--start", type=float, default=0.0)
    p.add_argument("--end", type=float)
    p.add_argument("--stride", type=int, default=1)
    p.add_argument("--model", default="small", choices=["nano", "small", "medium", "large"])
    p.add_argument("--weights", help="modelo propio (.pth) reentrenado")
    p.add_argument("--tiles", type=_tiles, default=(3, 2), help="mosaicos para el balón, p. ej. 3x2 (1x1 = sin mosaicos)")
    p.add_argument("--batch", type=int, default=4)
    p.add_argument("--out", default="detecciones.jsonl")

    p = sub.add_parser("analyze", help="toques, posesiones y métricas a partir de las detecciones")
    p.add_argument("detections")
    p.add_argument("--court", required=True)
    p.add_argument("--rallies", help="etiquetas de puntos (JSON de video/etiquetar)")
    p.add_argument("--out", default="analisis.json")

    p = sub.add_parser("render", help="vídeo anotado")
    p.add_argument("video")
    p.add_argument("analysis")
    p.add_argument("--court", required=True)
    p.add_argument("--out", default="anotado.mp4")

    p = sub.add_parser("export-frames", help="fotogramas con etiquetas previas para corregir en Roboflow")
    p.add_argument("video")
    p.add_argument("detections")
    p.add_argument("--court")
    p.add_argument("--n", type=int, default=300)
    p.add_argument("--out", default="dataset")

    p = sub.add_parser("run", help="todo seguido: detectar, analizar, resumen y vídeo anotado")
    p.add_argument("video")
    p.add_argument("--court", required=True)
    p.add_argument("--start", type=float, default=0.0)
    p.add_argument("--end", type=float)
    p.add_argument("--stride", type=int, default=1)
    p.add_argument("--model", default="small", choices=["nano", "small", "medium", "large"])
    p.add_argument("--weights")
    p.add_argument("--tiles", type=_tiles, default=(3, 2))
    p.add_argument("--rallies")
    p.add_argument("--no-video", action="store_true")
    p.add_argument("--out-dir", default="resultados")

    p = sub.add_parser("puntos", help="puntos sacados solo del vídeo, comparados con los marcados a mano")
    p.add_argument("video")
    p.add_argument("--court", required=True)
    p.add_argument("--labels", required=True, help=".json de la herramienta de etiquetar puntos")
    p.add_argument("--start", type=float, default=0.0)
    p.add_argument("--end", type=float)
    p.add_argument("--stride", type=int, default=2)
    p.add_argument("--model", default="small", choices=["nano", "small", "medium", "large"])
    p.add_argument("--weights")
    p.add_argument("--tiles", type=_tiles, default=(3, 2))
    p.add_argument("--out-dir", default="resultados")

    p = sub.add_parser("evaluar", help="reanalizar una carpeta de datos/ (sin vídeo ni GPU) y compararla con sus etiquetas")
    p.add_argument("folder")

    p = sub.add_parser("train", help="reentrenar con un dataset COCO exportado de Roboflow")
    p.add_argument("dataset")
    p.add_argument("--out", default="modelo")
    p.add_argument("--model", default="small", choices=["nano", "small", "medium", "large"])
    p.add_argument("--epochs", type=int, default=40)
    p.add_argument("--batch", type=int, default=4)

    a = ap.parse_args(argv)

    if a.cmd == "info":
        from .video_io import video_info
        print(json.dumps(video_info(a.video), indent=2))
    elif a.cmd == "frame":
        from .video_io import read_frame
        cv2.imwrite(a.out, read_frame(a.video, a.t))
        print(a.out)
    elif a.cmd == "calibrate":
        from .court import Court, EXTRA
        from .video_io import read_frame
        frame = read_frame(a.video, a.t)
        if a.corners:
            corners = a.corners
            extra = dict(zip(EXTRA[a.view], a.centro)) if a.centro else {}
        else:
            from .calibrate_ui import pick_points_opencv
            clicked = pick_points_opencv(frame, a.view)
            corners, extra = clicked[:4], dict(zip(EXTRA[a.view], clicked[4:]))
        court = Court.from_clicks(a.view, corners, (frame.shape[1], frame.shape[0]), extra)
        court.save(a.out)
        cv2.imwrite(a.preview, court.draw_overlay(frame))
        print(f"Guardado {a.out}. Error de reproyección: {court.reprojection_error():.1f} px. Revisa {a.preview}.")
    elif a.cmd == "detect":
        from .pipeline import detect_segment
        header, frames = detect_segment(a.video, a.out, a.start, a.end, a.stride, a.model, a.weights, a.tiles, a.batch)
        print(f"{len(frames)} fotogramas en {header['processing_seconds']} s → {a.out}")
    elif a.cmd == "analyze":
        from .pipeline import analyze_file
        _, text = analyze_file(a.detections, a.court, a.out, a.rallies)
        print(text)
    elif a.cmd == "render":
        from .court import Court
        from .render import render
        with open(a.analysis) as f:
            analysis = json.load(f)
        print(render(a.video, analysis, Court.load(a.court), a.out))
    elif a.cmd == "export-frames":
        from .court import Court
        from .labels import export_training_frames
        from .video_io import load_detections
        header, frames = load_detections(a.detections)
        n, zip_path = export_training_frames(a.video, header, frames, Court.load(a.court) if a.court else None, a.out, a.n)
        print(f"{n} fotogramas → {zip_path}")
    elif a.cmd == "run":
        from .pipeline import run_all
        _, text, files = run_all(a.video, a.court, a.out_dir, a.start, a.end, a.stride, a.model, a.weights,
                                 a.tiles, a.rallies, not a.no_video)
        print(text)
        print(json.dumps(files, indent=2, ensure_ascii=False))
    elif a.cmd == "puntos":
        from .pipeline import rallies_vs_labels
        _, _, text = rallies_vs_labels(a.video, a.court, a.out_dir, a.labels, a.stride, a.model, a.weights,
                                       a.tiles, a.start, a.end)
        print(text)
    elif a.cmd == "evaluar":
        from .pipeline import evaluate_folder
        print(evaluate_folder(a.folder)[3])
    elif a.cmd == "train":
        from .train import train
        print(train(a.dataset, a.out, a.model, a.epochs, a.batch))
    return 0


if __name__ == "__main__":
    sys.exit(main())
