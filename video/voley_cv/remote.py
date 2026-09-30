"""Descargar el vídeo desde un enlace compartido de OneDrive (para Colab, que solo monta Google Drive)."""

from __future__ import annotations

import base64
import http.cookiejar
import re
import shutil
import urllib.request
from pathlib import Path

LOGIN_HOSTS = ("login.microsoftonline.com", "login.live.com")


def onedrive_candidates(link: str) -> list[str]:
    """Direcciones de descarga directa posibles para un enlace compartido de OneDrive.
    - OneDrive de empresa/universidad (…-my.sharepoint.com/:v:/g/personal/usuario/CODIGO):
      …/personal/usuario/_layouts/15/download.aspx?share=CODIGO, y el enlace con download=1.
    - OneDrive personal (1drv.ms / onedrive.live.com): API de «shares» y el enlace con download=1."""
    link = link.strip()
    direct = link + ("&" if "?" in link else "?") + "download=1"
    m = re.match(r"https://([^/]+\.sharepoint\.com)/:\w:/[gr]/personal/([^/]+)/([^/?#]+)", link)
    if m:
        host, user, code = m.groups()
        return [f"https://{host}/personal/{user}/_layouts/15/download.aspx?share={code}", direct]
    token = base64.b64encode(link.encode()).decode().rstrip("=").replace("/", "_").replace("+", "-")
    return [f"https://api.onedrive.com/v1.0/shares/u!{token}/root/content", direct]


def download(link: str, dest, chunk=8 << 20, progress=True) -> Path:
    """Descarga un enlace de OneDrive (compartido como «cualquier persona con el vínculo») a `dest`."""
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size > 0:
        print(f"Ya descargado: {dest} ({dest.stat().st_size / 1e9:.2f} GB)")
        return dest
    errors = []
    login_required = False
    # SharePoint da acceso a los enlaces «cualquier persona» con una cookie que pone al abrir el enlace
    # (así funciona en una ventana de incógnito): se abre primero el enlace y se conservan las cookies.
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}
    try:
        with opener.open(urllib.request.Request(link.strip(), headers=headers), timeout=60) as r:
            r.read(1 << 16)
    except Exception as e:
        errors.append(f"abrir el enlace: {e}")
    for url in onedrive_candidates(link):
        try:
            req = urllib.request.Request(url, headers=headers)
            with opener.open(req, timeout=60) as r:
                ctype = r.headers.get("Content-Type", "")
                if "text/html" in ctype:
                    page = r.read(200_000).decode("utf-8", "ignore")
                    if any(h in r.geturl() or h in page for h in LOGIN_HOSTS):
                        login_required = True
                        errors.append(f"{url[:60]}…: pide iniciar sesión")
                    else:
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
    if login_required:
        raise RuntimeError(
            "El enlace pide iniciar sesión: está compartido solo con personas de tu organización (o tu cuenta "
            "no permite enlaces para «cualquier persona»). En OneDrive → Compartir → Configuración del vínculo, "
            "elige «Cualquier persona»; si no aparece, tu universidad no lo permite y hay que usar otra vía.\n"
            + "\n".join(errors))
    raise RuntimeError(
        "No se pudo descargar el vídeo de OneDrive. Comprueba que el enlace está compartido como "
        "«Cualquier persona con el vínculo puede ver».\n" + "\n".join(errors))
