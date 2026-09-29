"""Descargar el vídeo desde un enlace compartido de OneDrive (para Colab, que solo monta Google Drive)."""

from __future__ import annotations

import base64
import shutil
import urllib.request
from pathlib import Path


def onedrive_candidates(link: str) -> list[str]:
    """Direcciones de descarga directa posibles para un enlace compartido de OneDrive.
    1) API de «shares» (OneDrive personal, enlaces 1drv.ms / onedrive.live.com).
    2) El propio enlace con download=1 (OneDrive de empresa/SharePoint y algunos personales)."""
    link = link.strip()
    token = base64.b64encode(link.encode()).decode().rstrip("=").replace("/", "_").replace("+", "-")
    api = f"https://api.onedrive.com/v1.0/shares/u!{token}/root/content"
    direct = link + ("&" if "?" in link else "?") + "download=1"
    return [api, direct]


def download(link: str, dest, chunk=8 << 20, progress=True) -> Path:
    """Descarga un enlace de OneDrive (compartido como «cualquier persona con el vínculo») a `dest`."""
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size > 0:
        print(f"Ya descargado: {dest} ({dest.stat().st_size / 1e9:.2f} GB)")
        return dest
    errors = []
    for url in onedrive_candidates(link):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                ctype = r.headers.get("Content-Type", "")
                if "text/html" in ctype:
                    errors.append(f"{url[:60]}…: devuelve una página web, no el archivo")
                    continue
                total = int(r.headers.get("Content-Length") or 0)
                tmp = dest.with_suffix(dest.suffix + ".part")
                bar = None
                if progress:
                    try:
                        from tqdm.auto import tqdm
                        bar = tqdm(total=total or None, unit="B", unit_scale=True, desc="Descargando")
                    except ImportError:
                        bar = None
                with open(tmp, "wb") as f:
                    while True:
                        buf = r.read(chunk)
                        if not buf:
                            break
                        f.write(buf)
                        if bar:
                            bar.update(len(buf))
                if bar:
                    bar.close()
                shutil.move(tmp, dest)
                return dest
        except Exception as e:  # se prueba la siguiente forma
            errors.append(f"{url[:60]}…: {e}")
    raise RuntimeError(
        "No se pudo descargar el vídeo de OneDrive. Comprueba que el enlace está compartido como "
        "«Cualquier persona con el vínculo puede ver».\n" + "\n".join(errors))
