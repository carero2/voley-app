"""Marcar las esquinas del campo con el ratón: en Colab (widget en el navegador) o en el Mac (ventana OpenCV)."""

from __future__ import annotations

import base64
import json

import cv2

from .court import POINTS

_JS = r"""
async function voleyPickPoints(dataUrl, W, H, labels, schema) {
  const scale = Math.min(1, 1000 / W);
  const n = labels.length;
  const pts = new Array(n).fill(null);
  let cur = 0;
  const box = document.createElement('div');
  box.style.cssText = 'font:14px sans-serif;color:#eee;background:#222;padding:10px;border-radius:8px;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start';
  const left = document.createElement('div');
  const info = document.createElement('div'); info.style.cssText = 'font-size:16px;font-weight:bold;margin-bottom:6px;min-height:40px;max-width:1000px';
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
  canvas.style.cursor = 'crosshair';
  const bar = document.createElement('div');
  const mk = (t) => { const b = document.createElement('button'); b.textContent = t; b.style.cssText = 'margin:6px 6px 0 0;padding:8px 14px;font-size:14px'; bar.appendChild(b); return b; };
  const skip = mk('No se ve: siguiente punto'), clear = mk('Borrar este punto'), done = mk('Listo');
  left.append(info, canvas, bar);
  // Esquema del campo con los números de los puntos (vista desde la cámara).
  const right = document.createElement('div');
  const sch = document.createElement('canvas'); sch.width = 300; sch.height = 170;
  const list = document.createElement('div'); list.style.cssText = 'margin-top:8px;display:flex;flex-direction:column;gap:3px';
  right.append(sch, list);
  box.append(left, right);
  document.body.appendChild(box);
  const img = new Image(); img.src = dataUrl; await img.decode();
  const ctx = canvas.getContext('2d');
  const sctx = sch.getContext('2d');
  const drawSchema = () => {
    sctx.fillStyle = '#333'; sctx.fillRect(0, 0, 300, 170);
    const X = (u) => 20 + u * 260, Y = (v) => 15 + v * 140;
    sctx.strokeStyle = '#f59e0b'; sctx.lineWidth = 2;
    sctx.strokeRect(X(0), Y(0), 260, 140);
    const lines = schema.lines;
    lines.forEach(([a, b]) => { sctx.beginPath(); sctx.moveTo(X(a[0]), Y(a[1])); sctx.lineTo(X(b[0]), Y(b[1])); sctx.stroke(); });
    schema.points.forEach(([u, v], i) => {
      sctx.fillStyle = i === cur ? '#facc15' : pts[i] ? '#34c759' : '#9ca3af';
      sctx.beginPath(); sctx.arc(X(u), Y(v), i === cur ? 8 : 6, 0, 7); sctx.fill();
      sctx.fillStyle = '#000'; sctx.font = 'bold 10px sans-serif'; sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
      sctx.fillText(String(i + 1), X(u), Y(v));
    });
    sctx.fillStyle = '#ccc'; sctx.font = '11px sans-serif'; sctx.textAlign = 'center'; sctx.fillText('cámara aquí ↓', 150, 165);
  };
  const draw = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    pts.forEach((p, i) => { if (!p) return;
      ctx.fillStyle = i === cur ? '#facc15' : '#34c759'; ctx.beginPath(); ctx.arc(p[0] * scale, p[1] * scale, 6, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.fillText(String(i + 1), p[0] * scale + 8, p[1] * scale - 8); });
    const marked = pts.filter(Boolean).length;
    info.textContent = cur < n
      ? `Haz clic en el punto ${cur + 1}: ${labels[cur]}. Si no se ve, «No se ve: siguiente punto». (${marked} marcados${marked >= 4 ? ' · ya puedes pulsar «Listo»' : ', mínimo 4'})`
      : `${marked} puntos marcados. Pulsa «Listo» (o elige un punto de la lista para cambiarlo).`;
    list.innerHTML = '';
    labels.forEach((l, i) => {
      const it = document.createElement('div');
      it.textContent = `${i + 1}. ${l} — ${pts[i] ? 'marcado' : 'sin marcar'}`;
      it.style.cssText = `cursor:pointer;padding:2px 6px;border-radius:4px;${i === cur ? 'background:#854d0e' : ''};color:${pts[i] ? '#86efac' : '#ddd'}`;
      it.onclick = () => { cur = i; draw(); };
      list.appendChild(it);
    });
    drawSchema();
    if (window.google?.colab?.output?.setIframeHeight) google.colab.output.setIframeHeight(document.documentElement.scrollHeight, true);
  };
  const next = () => { let k = cur + 1; while (k < n && pts[k]) k++; cur = k; };
  draw();
  canvas.onclick = (e) => {
    if (cur >= n) return;
    const r = canvas.getBoundingClientRect();
    pts[cur] = [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
    next(); draw();
  };
  skip.onclick = () => { if (cur < n) { cur += 1; draw(); } };
  clear.onclick = () => { if (cur < n) { pts[cur] = null; draw(); } };
  return new Promise(resolve => { done.onclick = () => {
    if (pts.filter(Boolean).length < 4) { info.textContent = 'Faltan puntos: marca al menos 4 (esquinas o extremos de líneas).'; return; }
    box.remove(); resolve(JSON.stringify(pts)); }; });
}
"""


def labels_for(view):
    return [label for _, label, _ in POINTS[view]]


def _to_schema(view, x, y):
    """Coordenadas del campo → esquema visto desde la cámara (0-1, la cámara abajo)."""
    if view == "lateral":
        return [x / 18.0, 1 - y / 9.0]
    return [(9.0 - y) / 9.0, 1 - x / 18.0]


def schema_for(view):
    lines = [((9, 0), (9, 9)), ((6, 0), (6, 9)), ((12, 0), (12, 9))]
    return {
        "points": [_to_schema(view, *xy) for _, _, xy in POINTS[view]],
        "lines": [[_to_schema(view, *a), _to_schema(view, *b)] for a, b in lines],
    }


def pick_points_colab(frame, view):
    """Muestra el fotograma en Colab y devuelve los puntos marcados con clics (orden de POINTS[view])."""
    from google.colab import output  # type: ignore
    from IPython.display import Javascript, display

    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    data_url = "data:image/jpeg;base64," + base64.b64encode(buf).decode()
    H, W = frame.shape[:2]
    labels = labels_for(view)
    display(Javascript(_JS))
    call = f"voleyPickPoints({json.dumps(data_url)}, {W}, {H}, {json.dumps(labels)}, {json.dumps(schema_for(view))})"
    pts = json.loads(output.eval_js(call))
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
        elif key == ord("s") and len(pts) < len(labels):
            pts.append(None)
        elif key in (13, 10) and len([p for p in pts if p]) >= 4:
            break
    cv2.destroyWindow(win)
    return _split(pts, view)


def _split(pts, view):
    """Devuelve la lista de puntos en el orden de POINTS[view] (None = saltado)."""
    n = len(POINTS[view])
    return list(pts[:n]) + [None] * (n - len(pts))
