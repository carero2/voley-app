// Interfaz de la sincronización: conectar un club al servidor, estado, enlace de invitación, unirse y conflictos.
import { activeClub } from '../store.js';
import {
  syncConfig, saveSyncConfig, removeSyncConfig, syncStatus, syncClub, inviteLink, joinClub, conflictsOf,
  resolveConflict, isAdmin, changePassword, userName, setUserName, contributors,
} from '../sync.js';
import { html, openSheet, toast, formatDate } from '../ui.js';

const GUIDE = 'https://github.com/carero2/voley-app/blob/claude/volleyball-stats-github-pages-cf7xwk/docs/servidor.md';

const hhmm = (t) => (t ? new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '');

// Texto corto del estado para la barra del club.
export function syncChip(clubId) {
  const s = syncStatus(clubId);
  if (s.state === 'off') return '';
  // Corto para no tapar el nombre del club; el detalle está al pulsar.
  const label = { running: '☁ …', ok: `☁ ${hhmm(s.at)}`, pending: `☁ ${s.pending}↑`, error: '☁ ⚠' }[s.state];
  const title = { running: 'Sincronizando…', ok: 'Sincronizado', pending: `${s.pending} cambios sin subir`, error: s.error }[s.state];
  return html`<button class="sync-chip st-${s.state}" id="sync-chip" title="${title}" aria-label="Servidor de la liga: ${title}">${label}</button>`;
}

function statusText(clubId) {
  const s = syncStatus(clubId);
  if (s.state === 'running') return html`<p class="small">Sincronizando…</p>`;
  if (s.state === 'error') return html`<p class="small sync-error">⚠ ${s.error}${s.at ? ` (última vez correcta: ${hhmm(s.at)})` : ''}</p>`;
  if (s.state === 'pending') return html`<p class="small">${s.pending} ${s.pending === 1 ? 'cambio' : 'cambios'} sin subir${s.at ? ` · última sincronización ${hhmm(s.at)}` : ''}.</p>`;
  return html`<p class="small">✓ Sincronizado${s.at ? ` a las ${hhmm(s.at)}` : ''}.</p>`;
}

export function openSyncSheet(onChange) {
  const club = activeClub();
  const cfg = syncConfig(club.id);
  const conflicts = conflictsOf(club).length;
  const sheet = openSheet((cfg ? html`
    <div class="sheet-title">
      <h2 class="grow">Servidor de la liga</h2>
      <button class="btn btn-ghost" data-close aria-label="Cerrar">✕</button>
    </div>
    <p class="small muted">«${club.name}» está conectado: todos los que tengan la contraseña ven y registran sus partidos. Se sincroniza al abrir la app, al cerrar cada set y al volver la conexión.</p>
    <div id="sync-state">${statusText(club.id)}</div>
    <div class="settings-group sheet-group">
      <button class="settings-row" id="sync-name">
        <span class="grow">Tu nombre<span class="s-sub">Queda guardado en lo que registras</span></span>
        <span class="s-value ${userName(club.id) ? '' : 'bad'}">${userName(club.id) || 'Sin poner'}</span>
        <span class="s-chev" aria-hidden="true">›</span>
      </button>
      ${isAdmin(club.id) && contributors(club).length ? html`
        <div class="settings-row">
          <span class="grow">Quién ha registrado<span class="s-sub">${contributors(club).map((c) => `${c.name} (${c.points} puntos)`).join(' · ')}</span></span>
        </div>` : ''}
    </div>
    ${conflicts ? html`<p class="small sync-error">⚠ ${conflicts} ${conflicts === 1 ? 'partido tiene' : 'partidos tienen'} dos versiones: elige cuál conservar en la lista de partidos.</p>` : ''}
    <div class="stack sheet-actions">
      <button class="btn btn-primary btn-block" id="sync-now">Sincronizar ahora</button>
      ${isAdmin(club.id) ? html`
        <button class="btn btn-block" id="sync-invite">Compartir enlace de invitación</button>
        <p class="small muted">El enlace lleva la contraseña: quien lo abra entra directamente en la liga. Compártelo solo con el equipo.</p>
        <button class="btn btn-block" id="sync-mine">Abrir en otro dispositivo mío</button>
        <p class="small muted">Para usar la app también en tu tablet u ordenador con tu mismo nombre y como administración. No lo compartas con nadie más.</p>
        <button class="btn btn-block" id="sync-password">Cambiar la contraseña de la liga</button>
        <p class="small muted">Tú administras el servidor de esta liga: solo desde aquí se cambia la contraseña y se pueden borrar partidos compartidos.</p>
      ` : html`
        <p class="small muted">Te uniste con un enlace de invitación. La contraseña y las invitaciones las gestiona quien administra la liga.</p>`}
      <button class="btn btn-block btn-danger" id="sync-off">Desconectar este dispositivo</button>
    </div>
  ` : html`
    <div class="sheet-title">
      <h2 class="grow">Compartir la liga con el equipo</h2>
      <button class="btn btn-ghost" data-close aria-label="Cerrar">✕</button>
    </div>
    <p class="small muted">Conecta «${club.name}» a un servidor gratuito (Firebase) para que todo el equipo registre y vea los partidos.
      La configuración es <b>solo de esta liga</b>: las demás ligas no la usan. Se guarda en este dispositivo y no va en las copias.</p>
    <div class="stack sheet-actions">
      <button class="btn btn-primary btn-block" id="sync-paste">Tengo un enlace de invitación</button>
      <p class="small muted">Si la liga ya tiene servidor, pega aquí el enlace que te han mandado (útil si usas la app desde la pantalla de inicio del móvil).</p>
    </div>
    <h3 class="sheet-sub">O crea el servidor de la liga</h3>
    <p class="small"><a href="${GUIDE}" target="_blank" rel="noopener">Cómo crear el servidor (10 minutos, una sola vez)</a></p>
    <form id="sync-form" class="stack">
      <label class="field"><span>ID del proyecto (projectId)</span>
        <input name="projectId" required autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="voley-mi-liga" value="${cfg?.projectId ?? ''}" /></label>
      <label class="field"><span>Clave web (apiKey)</span>
        <input name="apiKey" required autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="AIza…" value="${cfg?.apiKey ?? ''}" /></label>
      <label class="field"><span>Contraseña de la liga</span>
        <input name="password" required minlength="6" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
      <label class="field"><span>Tu nombre</span>
        <input name="userName" required maxlength="40" autocomplete="name" placeholder="Ej.: Laura" /></label>
      <p class="small muted">Con una contraseña nueva se crea la liga en el servidor con los datos de este dispositivo. Con la de una liga que ya existe, se juntan.</p>
      <div class="form-actions">
        <button type="button" class="btn" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">Conectar</button>
      </div>
    </form>
  `).toString());

  const refresh = () => {
    const box = sheet.root.querySelector('#sync-state');
    if (box) box.innerHTML = statusText(club.id).toString();
  };
  sheet.root.querySelector('#sync-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    await saveSyncConfig(club.id, {
      projectId: f.projectId.value, apiKey: f.apiKey.value, password: f.password.value, userName: f.userName.value, role: 'admin',
    });
    sheet.close();
    toast('Conectando…');
    const s = await syncClub(club.id);
    toast(s?.error ? `⚠ ${s.error}` : 'Liga conectada y sincronizada');
    onChange?.();
  });
  sheet.root.querySelector('#sync-paste')?.addEventListener('click', () => { sheet.close(); openPasteInvite(); });
  sheet.root.querySelector('#sync-name')?.addEventListener('click', () => {
    const name = prompt('Tu nombre (se guarda en los partidos y puntos que registras):', userName(club.id));
    if (name == null || !name.trim()) return;
    setUserName(club.id, name);
    sheet.close();
    toast(`Nombre guardado: ${name.trim()}`);
    openSyncSheet(onChange);
    onChange?.();
  });
  sheet.root.querySelector('#sync-now')?.addEventListener('click', async () => {
    const p = syncClub(club.id);
    refresh();
    const s = await p;
    refresh();
    toast(s?.error ? `⚠ ${s.error}` : summaryText(s));
    onChange?.();
  });
  sheet.root.querySelector('#sync-mine')?.addEventListener('click', async () => {
    const url = inviteLink(club.id, { admin: true });
    try {
      if (navigator.share) await navigator.share({ title: 'Voley Stats', text: `Abrir «${club.name}» en mi otro dispositivo`, url });
      else { await navigator.clipboard.writeText(url); toast('Enlace copiado: ábrelo en tu otro dispositivo'); }
    } catch {
      prompt('Copia el enlace y ábrelo en tu otro dispositivo:', url);
    }
  });
  sheet.root.querySelector('#sync-invite')?.addEventListener('click', async () => {
    const url = inviteLink(club.id);
    try {
      if (navigator.share) await navigator.share({ title: `Liga ${club.name}`, text: `Únete a la liga «${club.name}» en Voley Stats`, url });
      else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
    } catch {
      prompt('Copia el enlace de invitación:', url);
    }
  });
  sheet.root.querySelector('#sync-password')?.addEventListener('click', async () => {
    const pw = prompt('Nueva contraseña de la liga (mínimo 6 caracteres). Los demás tendrán que entrar con el enlace nuevo:');
    if (pw == null) return;
    if (pw.trim().length < 6) { alert('La contraseña necesita al menos 6 caracteres.'); return; }
    if (!confirm('Se moverán todos los datos a la contraseña nueva y la antigua dejará de funcionar. Después envía el enlace nuevo al equipo. ¿Continuar?')) return;
    toast('Cambiando la contraseña…');
    const r = await changePassword(club.id, pw.trim());
    if (r.error) { alert(`No se pudo cambiar: ${r.error}`); return; }
    sheet.close();
    toast('Contraseña cambiada: comparte el enlace nuevo');
    openSyncSheet(onChange);
  });
  sheet.root.querySelector('#sync-off')?.addEventListener('click', () => {
    if (!confirm('¿Desconectar este dispositivo del servidor? Los datos se quedan aquí y en el servidor; solo deja de sincronizar.')) return;
    removeSyncConfig(club.id);
    sheet.close();
    toast('Desconectado del servidor');
    onChange?.();
  });
}

export function summaryText(s) {
  if (!s) return '';
  const parts = [];
  if (s.pulled) parts.push(`${s.pulled} recibidos`);
  if (s.pushed) parts.push(`${s.pushed} subidos`);
  if (s.deleted) parts.push(`${s.deleted} borrados`);
  if (s.conflicts) parts.push(`⚠ ${s.conflicts} con dos versiones`);
  return parts.length ? `Sincronizado: ${parts.join(', ')}` : 'Todo al día';
}

// Página del enlace de invitación (#/unirse?p=…&k=…&c=…&n=…).
export function renderJoin(el, { query }) {
  const { p, k, c, n, a, u } = query;
  const admin = a === '1';
  if (!p || !k || !c) {
    el.innerHTML = html`<div class="card empty"><p>El enlace de invitación está incompleto. Pide otro a quien lo creó.</p><a class="btn" href="#/">Volver</a></div>`;
    return;
  }
  el.innerHTML = html`
    <header class="page-head"><h1>Unirse a la liga</h1></header>
    <section class="card stack">
      ${admin
        ? html`<p>Enlace de <b>administración</b> de la liga <b>${n || 'compartida'}</b>: este dispositivo también la administrará, con tu mismo nombre.</p>`
        : html`<p>Te han invitado a la liga <b>${n || 'compartida'}</b>. Al unirte, sus jugadores y partidos se descargan en este dispositivo y lo que registres se compartirá con el equipo.</p>`}
      <form id="join-form" class="stack">
        <label class="field"><span>Tu nombre</span>
          <input name="userName" required maxlength="40" autocomplete="name" placeholder="Ej.: Laura" value="${u || ''}" /></label>
        <p class="small muted">Se guarda en cada partido y punto que registres, para saber quién anotó qué.</p>
        <button class="btn btn-primary btn-block btn-lg" id="join" type="submit">Unirme</button>
      </form>
      <p class="small muted" id="join-info"></p>
    </section>
  `;
  el.querySelector('#join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el.querySelector('#join');
    const who = e.target.userName.value.trim();
    btn.disabled = true;
    el.querySelector('#join-info').textContent = 'Descargando la liga…';
    const r = await joinClub({ projectId: p, apiKey: k, password: c, name: n, userName: who, admin });
    if (r.error) {
      el.querySelector('#join-info').textContent = `⚠ ${r.error}`;
      btn.disabled = false;
      return;
    }
    toast(r.existed ? `Ya estabas en «${r.club.name}»` : `Te has unido a «${r.club.name}»`);
    location.hash = '#/';
  });
}

// Avisos de partidos con dos versiones (en la lista de partidos).
export function conflictCards(onChange) {
  const club = activeClub();
  const list = conflictsOf(club);
  if (!list.length) return '';
  const points = (m) => m.events.filter((e) => e.point).length;
  return html`${list.map((copy) => {
    const mine = club.matches.find((m) => m.id === copy.conflictOf);
    if (!mine) return '';
    return html`
      <section class="card conflict-card" data-conflict="${mine.id}">
        <p><b>⚠ vs ${mine.opponent}</b> (${formatDate(mine.date)}) se ha registrado en dos dispositivos con datos distintos. Elige cuál conservar (la otra se descarta en todos):</p>
        <div class="form-actions">
          <button class="btn" data-keep="local">La de este dispositivo (${points(mine)} puntos)</button>
          <button class="btn" data-keep="remote">La de ${copy.remote?.by || 'otro dispositivo'} (${points(copy)} puntos)</button>
        </div>
      </section>`;
  })}`;
}

export function bindConflictCards(root, onChange) {
  root.querySelectorAll('[data-conflict]').forEach((card) => card.querySelectorAll('[data-keep]').forEach((b) => b.addEventListener('click', () => {
    resolveConflict(activeClub().id, card.dataset.conflict, b.dataset.keep);
    toast('Versión elegida');
    onChange?.();
  })));
}

// ---------- Pegar un enlace de invitación dentro de la app ----------
// En el iPhone, la app añadida a la pantalla de inicio no recibe los enlaces (se abren en Safari, que guarda
// sus datos aparte). Pegando el enlace aquí se une desde la propia app.
export function parseInvite(text) {
  const m = String(text || '').match(/unirse\?([^\s#]+)/);
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  return q.get('p') && q.get('k') && q.get('c') ? m[1] : null;
}

export function openPasteInvite() {
  const sheet = openSheet(html`
    <div class="sheet-title"><h2 class="grow">Unirme con un enlace</h2><button class="btn btn-ghost" data-close aria-label="Cerrar">✕</button></div>
    <p class="small muted">Copia el enlace de invitación (de WhatsApp, del correo…) y pégalo aquí. También vale el enlace de «otro dispositivo mío».</p>
    <form id="paste-form" class="stack">
      <label class="field"><span>Enlace de invitación</span>
        <textarea name="link" rows="3" required autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…/#/unirse?…"></textarea></label>
      <p class="small sync-error" id="paste-error" hidden>Eso no parece un enlace de invitación de la app. Cópialo entero.</p>
      <div class="form-actions">
        ${navigator.clipboard?.readText ? html`<button type="button" class="btn" id="paste-btn">Pegar</button>` : ''}
        <button type="submit" class="btn btn-primary">Continuar</button>
      </div>
    </form>
  `.toString());
  const form = sheet.root.querySelector('#paste-form');
  sheet.root.querySelector('#paste-btn')?.addEventListener('click', async () => {
    try { form.link.value = await navigator.clipboard.readText(); } catch { form.link.focus(); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const qs = parseInvite(form.link.value);
    if (!qs) { sheet.root.querySelector('#paste-error').hidden = false; return; }
    sheet.close();
    location.hash = `#/unirse?${qs}`;
  });
}
