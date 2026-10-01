// Barra de club activo y gestión de clubes. Cada club tiene su equipo, jugadores, partidos y rivales.
import { clubs, activeClub, switchClub, createClub, updateClub, deleteClub } from '../store.js';
import { html, openSheet, toast } from '../ui.js';
import { syncChip, openSyncSheet } from './sync-ui.js';
import { syncConfig, removeSyncConfig } from '../sync.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function renderClubBar(el, onChange) {
  const club = activeClub();
  el.innerHTML = html`
    <div class="club-line">
      <button class="club-switch" id="club-switch" aria-label="Cambiar de club">
        <span class="club-icon" aria-hidden="true">🏛</span>
        <span class="grow club-names"><b>${club.name}</b> <span class="muted">· ${club.team.name}</span></span>
        ${club.demo ? html`<span class="badge badge-demo">PRUEBA</span>` : ''}
        <span aria-hidden="true">▾</span>
      </button>
      ${syncChip(club.id)}
    </div>
    ${club.demo && ['', '#', '#/'].includes(location.hash) ? html`
      <div class="demo-note">
        <span>Club de prueba con datos de ejemplo.</span>
        <button class="btn btn-small btn-primary" id="demo-create">Crear mi club</button>
      </div>` : ''}
  `;
  el.querySelector('#club-switch').addEventListener('click', () => openClubSheet(onChange));
  el.querySelector('#sync-chip')?.addEventListener('click', () => openSyncSheet(onChange));
  el.querySelector('#demo-create')?.addEventListener('click', () => openClubForm(null, onChange));
}

export function openClubSheet(onChange) {
  const current = activeClub();
  const sheet = openSheet(html`
    <div class="sheet-title">
      <h2 class="grow">Clubes</h2>
      <button class="btn btn-ghost" data-close aria-label="Cerrar">✕</button>
    </div>
    <p class="muted small">Cada club tiene su propio equipo, jugadores, rivales y partidos. No se mezclan entre sí.</p>
    <div class="list">
      ${clubs().map((c) => html`
        <button class="card club-row ${c.id === current.id ? 'active' : ''}" data-club="${c.id}">
          <span class="grow"><b>${c.name}</b><br><span class="muted small">${c.team.name} · ${plural(c.players.filter((p) => p.active !== false).length, 'jugador', 'jugadores')} · ${plural(c.matches.length, 'partido', 'partidos')}</span></span>
          ${c.demo ? html`<span class="badge badge-demo">PRUEBA</span>` : ''}
          ${c.id === current.id ? html`<span class="badge badge-active">Activo</span>` : ''}
        </button>`)}
    </div>
    <div class="stack sheet-actions">
      <button class="btn btn-primary btn-block" id="new-club">＋ Nuevo club</button>
      <button class="btn btn-block" id="edit-club">Editar «${current.name}»</button>
      <button class="btn btn-block" id="share-club">☁ ${syncConfig(current.id) ? 'Servidor del club' : 'Compartir con el equipo (servidor)'}</button>
      <button class="btn btn-block btn-danger" id="delete-club">Eliminar «${current.name}»</button>
    </div>
  `.toString());

  sheet.root.querySelectorAll('[data-club]').forEach((b) => b.addEventListener('click', () => {
    switchClub(b.dataset.club);
    sheet.close();
    toast(`Club: ${activeClub().name}`);
    onChange();
  }));
  sheet.root.querySelector('#new-club').addEventListener('click', () => { sheet.close(); openClubForm(null, onChange); });
  sheet.root.querySelector('#edit-club').addEventListener('click', () => { sheet.close(); openClubForm(current, onChange); });
  sheet.root.querySelector('#share-club').addEventListener('click', () => { sheet.close(); openSyncSheet(onChange); });
  sheet.root.querySelector('#delete-club').addEventListener('click', () => {
    const n = current.matches.length;
    const shared = syncConfig(current.id);
    if (!confirm(shared
      ? `¿Quitar el club «${current.name}» de este dispositivo? En el servidor no se borra nada: el resto del equipo lo sigue teniendo y puedes volver a entrar con el enlace de invitación.`
      : `¿Eliminar el club «${current.name}» con sus jugadores, rivales y ${n} ${n === 1 ? 'partido' : 'partidos'}? No se puede deshacer. Exporta antes una copia si la necesitas.`)) return;
    if (shared) removeSyncConfig(current.id);
    deleteClub(current.id);
    sheet.close();
    toast('Club eliminado');
    onChange();
  });
}

export function openClubForm(club, onChange) {
  const sheet = openSheet(html`
    <h2>${club ? 'Editar club' : 'Nuevo club'}</h2>
    <form id="club-form" class="stack">
      <label class="field">
        <span>Nombre del club</span>
        <input name="name" value="${club?.name ?? ''}" required autocomplete="off" placeholder="Ej.: CV Ejemplo" />
      </label>
      <label class="field">
        <span>Nombre de mi equipo</span>
        <input name="teamName" value="${club?.team.name ?? ''}" autocomplete="off" placeholder="Ej.: Juvenil femenino" />
      </label>
      <div class="form-actions">
        <button type="button" class="btn" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">${club ? 'Guardar' : 'Crear club'}</button>
      </div>
    </form>
  `.toString());
  const form = sheet.root.querySelector('#club-form');
  form.name.focus();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const values = { name: form.name.value, teamName: form.teamName.value };
    if (club) updateClub(club.id, values);
    else createClub(values);
    sheet.close();
    toast(club ? 'Club guardado' : 'Club creado: añade tus jugadores');
    if (!club) location.hash = '#/equipo';
    onChange();
  });
}
