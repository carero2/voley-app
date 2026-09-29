"""Reentrenar RF-DETR con vuestros fotogramas etiquetados (exportados de Roboflow en formato COCO)."""

from __future__ import annotations

from .detect import VARIANTS
from .device import pick_device


def train(dataset_dir, out_dir, model="small", epochs=40, batch_size=4, grad_accum=4, lr=1e-4, resolution=None):
    import rfdetr

    cls = getattr(rfdetr, VARIANTS[model])
    m = cls(device=pick_device())
    kwargs = dict(dataset_dir=str(dataset_dir), epochs=epochs, batch_size=batch_size,
                  grad_accum_steps=grad_accum, lr=lr, output_dir=str(out_dir))
    if resolution:
        kwargs["resolution"] = resolution
    m.train(**kwargs)
    return out_dir
