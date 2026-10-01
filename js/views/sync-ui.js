// Interfaz de la sincronización: conectar un club al servidor, estado, enlace de invitación, unirse y conflictos.
import { activeClub } from '../store.js';
import {
  syncConfig, saveSyncConfig, removeSyncConfig, syncStatus, syncClub, inviteLink, joinClub, conflictsOf,
  resolveConflict,
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
  return html`<button class="sync-chip st-${s.state}" id="sync-chip" title="${title}" aria-label="Servidor del club: ${title}">${label}</button>`;
}

function statusText(clubId) {
  const s = syncStatus(clubId);
  if (s.state === 'running') return html`<p class="small">Sincronizando…</p>`;
  if (s.state === 'error') return html`<p class="small sync-error">⚠ ${s.error}${s.at ? ` (última vez correcta: ${hhmm(s.at)})` : ''}</p>`;
  if (s.state === 'pending') return html`<p class="small">${s.pending} ${s.pending === 1 ? 'cambio' : 'cambios'} sin subir${s.at ? ` · última sincronización ${hhmm(s.at)}` : ''}.</p>`;
  return html`<p class="small">✓ Sincronizado${s.at ? ` a las ${hhmm(s.at)}` : ''}.</p>`;
}

export function openSyncSheet(onChange, { edit = false } = {}) {
  const club = activeClub();
  const cfg = syncConfig(club.id);
  const conflicts = conflictsOf(club).length;
  const sheet = openSheet((cfg && !edit ? html`
    <div class="sheet-title">
      <h2 class="grow">Servidor del club</h2>
      <button class="btn btn-ghost" data-close aria-label="Cerrar">✕</button>
    </div>
    <p class="small muted">«${club.name}» está conectado: todos los que tengan la contraseña ven y registran sus partidos. Se sincroniza al abrir la app, al cerrar cada set y al volver la conexión.</p>
    <div id="sync-state">${statusText(club.id)}</div>
    ${conflicts ? html`<p class="small sync-error">⚠ ${conflicts} ${conflicts === 1 ? 'partido tiene' : 'partidos tienen'} dos versiones: elige cuál conservar en la lista de partidos.</p>` : ''}
    <div class="stack sheet-actions">
      <button class="btn btn-primary btn-block" id="sync-now">Sincronizar ahora</button>
      <button class="btn btn-block" id="sync-invite">Compartir enlace de invitación</button>
      <p class="small muted">El enlace lleva la contraseña: quien lo abra entra directamente en el club. Compártelo solo con el equipo.</p>
      <button class="btn btn-block" id="sync-edit">Cambiar configuración</button>
      <button class="btn btn-block btn-danger" id="sync-off">Desconectar este dispositivo</button>
    </div>
  ` : html`
    <div class="sheet-title">
      <h2 class="grow">Compartir el club con el equipo</h2>
      <button class="btn btn-ghost" data-close aria-label="Cerrar">✕</button>
    </div>
    <p class="small muted">Conecta «${club.name}» a un servidor gratuito (Firebase) para que todo el equipo registre y vea los partidos.
      La configuración es <b>solo de este club</b>: los demás clubes no la usan. Se guarda en este dispositivo y no va en las copias.</p>
    <p class="small"><a href="${GUIDE}" target="_blank" rel="noopener">Cómo crear el servidor (10 minutos, una sola vez)</a>. Si ya existe, pide el enlace de invitación a quien lo creó.</p>
    <form id="sync-form" class="stack">
      <label class="field"><span>ID del proyecto (projectId)</span>
        <input name="projectId" required autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="voley-mi-club" value="${cfg?.projectId ?? ''}" /></label>
      <label class="field"><span>Clave web (apiKey)</span>
        <input name="apiKey" required autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="AIza…" value="${cfg?.apiKey ?? ''}" /></label>
      <label class="field"><span>Contraseña del club</span>
        <input name="password" required minlength="6" autocomplete="off" autocapitalize="off" spellcheck="false" value="${cfg?.password ?? ''}" /></label>
      <p class="small muted">Con una contraseña nueva se crea el club en el servidor con los datos de este dispositivo. Con la de un club que ya existe, se juntan.</p>
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
    await saveSyncConfig(club.id, { projectId: f.projectId.value, apiKey: f.apiKey.value, password: f.password.value });
    sheet.close();
    toast('Conectando…');
    const s = await syncClub(club.id);
    toast(s?.error ? `⚠ ${s.error}` : 'Club conectado y sincronizado');
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
  sheet.root.querySelector('#sync-invite')?.addEventListener('click', async () => {
    const url = inviteLink(club.id);
    try {
      if (navigator.share) await navigator.share({ title: `Club ${club.name}`, text: `Únete al club «${club.name}» en Voley Stats`, url });
      else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
    } catch {
      prompt('Copia el enlace de invitación:', url);
    }
  });
  sheet.root.querySelector('#sync-edit')?.addEventListener('click', () => { sheet.close(); openSyncSheet(onChange, { edit: true }); });
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
  const { p, k, c, n } = query;
  if (!p || !k || !c) {
    el.innerHTML = html`<div class="card empty"><p>El enlace de invitación está incompleto. Pide otro a quien lo creó.</p><a class="btn" href="#/">Volver</a></div>`;
    return;
  }
  el.innerHTML = html`
    <header class="page-head"><h1>Unirse al club</h1></header>
    <section class="card stack">
      <p>Te han invitado al club <b>${n || 'compartido'}</b>. Al unirte, sus jugadores y partidos se descargan en este dispositivo y lo que registres se compartirá con el equipo.</p>
      <button class="btn btn-primary btn-block btn-lg" id="join">Unirme</button>
      <p class="small muted" id="join-info"></p>
    </section>
  `;
  el.querySelector('#join').addEventListener('click', async (e) => {
    e.target.disabled = true;
    el.querySelector('#join-info').textContent = 'Descargando el club…';
    const r = await joinClub({ projectId: p, apiKey: k, password: c, name: n });
    if (r.error) {
      el.querySelector('#join-info').textContent = `⚠ ${r.error}`;
      e.target.disabled = false;
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
          <button class="btn" data-keep="remote">La del otro (${points(copy)} puntos)</button>
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
