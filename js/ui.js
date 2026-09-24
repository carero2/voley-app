// Pequeñas utilidades de interfaz.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Plantilla HTML: escapa los valores interpolados salvo los marcados con raw().
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    const str = Array.isArray(v)
      ? v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('')
      : v instanceof Raw ? v.s : v === false || v == null ? '' : esc(v);
    out += str + strings[i + 1];
  });
  return raw(out);
}

let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

export function vibrate(ms = 15) {
  try { navigator.vibrate?.(ms); } catch { /* no soportado */ }
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export const today = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

export function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Hoja inferior (bottom sheet) reutilizable.
export function openSheet(content, { onClose } = {}) {
  const root = document.getElementById('sheet-root');
  root.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet" role="dialog" aria-modal="true">${content}</div>`;
  root.hidden = false;
  const close = () => {
    root.hidden = true;
    root.innerHTML = '';
    onClose?.();
  };
  root.querySelector('.sheet-backdrop').addEventListener('click', close);
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  return { root: root.querySelector('.sheet'), close };
}
