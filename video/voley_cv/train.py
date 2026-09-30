"""Reentrenar RF-DETR con vuestros fotogramas etiquetados (exportados de Roboflow en formato COCO)."""

from __future__ import annotations

import json
import shutil
import urllib.request
import zipfile
from pathlib import Path

from .detect import VARIANTS
from .device import pick_device

SPLITS = ("train", "valid", "test")


def fetch_dataset(source, dest="/content/dataset") -> Path:
    """Prepara el conjunto de datos a partir de una carpeta, un .zip o el enlace de descarga de Roboflow
    («Export → Show download code → Terminal»: https://app.roboflow.com/ds/…?key=…).
    Devuelve la carpeta que contiene train/, valid/ y test/ con _annotations.coco.json."""
    src = str(source).strip().strip('"')
    dest = Path(dest)
    if src.startswith("curl "):  # se ha pegado la orden entera de «Terminal»
        src = next(p.strip('"\'') for p in src.split() if p.strip('"\'').startswith("http"))
    if src.startswith("http"):
        dest.mkdir(parents=True, exist_ok=True)
        zip_path = dest.with_suffix(".zip")
        req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=120) as r, open(zip_path, "wb") as f:
            shutil.copyfileobj(r, f)
        src = str(zip_path)
    path = Path(src)
    if path.suffix == ".zip":
        dest.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(path) as z:
            z.extractall(dest)
        path = dest
    if not path.exists():
        raise FileNotFoundError(f"No encuentro el conjunto de datos: {source}")
    # La exportación puede venir dentro de una subcarpeta.
    roots = [p.parent.parent for p in path.rglob("_annotations.coco.json") if p.parent.name == "train"]
    if not roots:
        raise ValueError("No hay train/_annotations.coco.json: exporta desde Roboflow en formato «COCO».")
    root = roots[0]
    for split in ("valid", "test"):
        if not (root / split / "_annotations.coco.json").exists():
            other = root / ("test" if split == "valid" else "valid")
            if not (other / "_annotations.coco.json").exists():
                raise ValueError("Faltan las carpetas valid/ y test/: al generar la versión en Roboflow, reparte las "
                                 "imágenes en Train / Valid / Test (p. ej. 70/20/10).")
            shutil.copytree(other, root / split)  # RF-DETR necesita las tres; se reutiliza la otra
    return root


def describe_dataset(root) -> str:
    lines = []
    for split in SPLITS:
        data = json.loads((Path(root) / split / "_annotations.coco.json").read_text())
        cats = {c["id"]: c["name"] for c in data["categories"]}
        counts = {}
        for a in data["annotations"]:
            counts[cats.get(a["category_id"], "?")] = counts.get(cats.get(a["category_id"], "?"), 0) + 1
        lines.append(f"{split}: {len(data['images'])} imágenes · " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    return "\n".join(lines)


def train(dataset_dir, out_dir, model="small", epochs=40, batch_size=4, grad_accum=4, lr=1e-4, resolution=None):
    """Reentrena y devuelve la ruta del mejor modelo (checkpoint_best_total.pth)."""
    import rfdetr

    cls = getattr(rfdetr, VARIANTS[model])
    m = cls(device=pick_device())
    kwargs = dict(dataset_dir=str(dataset_dir), epochs=epochs, batch_size=batch_size,
                  grad_accum_steps=grad_accum, lr=lr, output_dir=str(out_dir))
    if resolution:
        kwargs["resolution"] = resolution
    m.train(**kwargs)
    best = Path(out_dir) / "checkpoint_best_total.pth"
    if not best.exists():
        found = sorted(Path(out_dir).glob("checkpoint_best*.pth")) or sorted(Path(out_dir).glob("*.pth"))
        best = found[0] if found else best
    return best
