"""Marcar las esquinas del campo con el ratón: en Colab (widget en el navegador) o en el Mac (ventana OpenCV)."""

from __future__ import annotations

import base64
import json

import cv2

from .court import CORNER_LABELS, EXTRA

_JS = r"""
async function voleyPickPoints(dataUrl, W, H, labels) {
  const scale = Math.min(1, 1100 / W);
  const box = document.createElement('div');
  box.style.cssText = 'font:14px sans-serif;color:#eee;background:#222;padding:8px;border-radius:8px;display:inline-block';
  const info = document.createElement('div');
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
  canvas.style.cursor = 'crosshair';
  const bar = document.createElement('div');
  const undo = document.createElement('button'); undo.textContent = 'Deshacer';
  const skip = document.createElement('button'); skip.textContent = 'Saltar este punto';
  const done = document.createElement('button'); done.textContent = 'Listo';
  [undo, skip, done].forEach(b => { b.style.margin = '6px 6px 0 0'; b.style.padding = '6px 12px'; bar.appendChild(b); });
  box.append(info, canvas, bar);
  document.body.appendChild(box);
  const img = new Image(); img.src = dataUrl; await img.decode();
  if (window.google?.colab?.output?.setIframeHeight) google.colab.output.setIframeHeight(document.documentElement.scrollHeight, true);
  const ctx = canvas.getContext('2d');
  const pts = [];
  const draw = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    pts.forEach((p, i) => { if (!p) return;
      ctx.fillStyle = i < 4 ? '#ff3b30' : '#34c759'; ctx.beginPath(); ctx.arc(p[0] * scale, p[1] * scale, 5, 0, 7); ctx.fill();
      ctx.font = 'bold 16px sans-serif'; ctx.fillText(String(i + 1), p[0] * scale + 7, p[1] * scale - 7); });
    info.textContent = pts.length < labels.length
      ? `Marca el punto ${pts.length + 1}: ${labels[pts.length]}` + (pts.length >= 4 ? ' (opcional)' : '')
      : 'Todos los puntos marcados. Pulsa «Listo».';
  };
  draw();
  canvas.onclick = (e) => {
    if (pts.length >= labels.length) return;
    const r = canvas.getBoundingClientRect();
    pts.push([(e.clientX - r.left) / scale, (e.clientY - r.top) / scale]); draw();
  };
  undo.onclick = () => { pts.pop(); draw(); };
  skip.onclick = () => { if (pts.length >= 4 && pts.length < labels.length) { pts.push(null); draw(); } };
  return new Promise(resolve => { done.onclick = () => {
    if (pts.filter(Boolean).length < 4) { info.textContent = 'Faltan esquinas: marca al menos las 4.'; return; }
    box.remove(); resolve(JSON.stringify(pts)); }; });
}
"""


def labels_for(view):
    return CORNER_LABELS + [f"{name.replace('_', ' ')} (extremo de la línea central, bajo la red)" for name in EXTRA[view]]


def pick_points_colab(frame, view):
    """Muestra el fotograma en Colab y devuelve (esquinas, extras) marcados con clics."""
    from google.colab import output  # type: ignore
    from IPython.display import Javascript, display

    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    data_url = "data:image/jpeg;base64," + base64.b64encode(buf).decode()
    H, W = frame.shape[:2]
    labels = labels_for(view)
    display(Javascript(_JS))
    pts = json.loads(output.eval_js(f"voleyPickPoints({json.dumps(data_url)}, {W}, {H}, {json.dumps(labels)})"))
    return _split(pts, view)


def pick_points_opencv(frame, view):
    """Ventana de OpenCV (Mac/PC): clic para marcar, «z» deshacer, «s» saltar punto opcional, Intro terminar."""
    labels = labels_for(view)
    pts = []
    win = "Calibrar campo"

    def on_mouse(event, x, y, *_):
        if event == cv2.EVENT_LBUTTONDOWN and len(pts) < len(labels):
            pts.append([float(x), float(y)])

    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(win, on_mouse)
    while True:
        img = frame.copy()
        for i, p in enumerate(pts):
            if p:
                cv2.circle(img, (int(p[0]), int(p[1])), 6, (0, 0, 255) if i < 4 else (0, 200, 0), -1)
                cv2.putText(img, str(i + 1), (int(p[0]) + 8, int(p[1]) - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        msg = f"Punto {len(pts) + 1}: {labels[len(pts)]}" if len(pts) < len(labels) else "Listo: pulsa Intro"
        cv2.putText(img, msg, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 3)
        cv2.imshow(win, img)
        key = cv2.waitKey(30) & 0xFF
        if key == ord("z") and pts:
            pts.pop()
        elif key == ord("s") and 4 <= len(pts) < len(labels):
            pts.append(None)
        elif key in (13, 10) and len([p for p in pts if p]) >= 4:
            break
    cv2.destroyWindow(win)
    return _split(pts, view)


def _split(pts, view):
    corners = pts[:4]
    extra = {name: (pts[4 + i] if len(pts) > 4 + i else None) for i, name in enumerate(EXTRA[view])}
    return corners, extra
