// Barra de club activo y gestión de clubes. Cada club tiene su equipo, jugadores, partidos y rivales.
import { clubs, activeClub, switchClub, createClub, updateClub, deleteClub } from '../store.js';
import { html, openSheet, toast } from '../ui.js';
import { syncChip, openPasteInvite } from './sync-ui.js';
import { syncConfig, removeSyncConfig } from '../sync.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function renderClubBar(el, onChange) {
  const club = activeClub();
  el.innerHTML = html`
    <div class="club-line">
      <button class="club-switch" id="club-switch" aria-label="Cambiar de liga">
        <span class="club-icon" aria-hidden="true">🏆</span>
        <span class="grow club-names"><b>${club.name}</b> <span class="muted">· ${club.team.name}</span></span>
        ${club.demo ? html`<span class="badge badge-demo">PRUEBA</span>` : ''}
        <span aria-hidden="true">▾</span>
      </button>
      ${syncChip(club.id)}
    </div>
    ${club.demo && ['', '#', '#/'].includes(location.hash) ? html`
      <div class="demo-note">
        <span>Liga de prueba con datos de ejemplo.</span>
        <button class="btn btn-small btn-primary" id="demo-create">Crear mi liga</button>
      </div>` : ''}
  `;
  el.querySelector('#club-switch').addEventListener('click', () => openClubSheet(onChange));
  // El servidor se gestiona en Ajustes: el aviso de la barra lleva allí.
  el.querySelector('#sync-chip')?.addEventListener('click', () => { location.hash = '#/datos?servidor=1'; });
  el.querySelector('#demo-create')?.addEventListener('click', () => openClubForm(null, onChange));
}

export function openClubSheet(onChange) {
  const current = activeClub();
  const sheet = openSheet(html`
    <div class="sheet-title">
      <h2 class="grow">Ligas</h2>
      <button class="btn btn-ghost" data-close aria-label="Cerrar">✕</button>
    </div>
    <p class="muted small">Cada liga tiene su propio equipo, jugadores, rivales y partidos. No se mezclan entre sí.</p>
    <div class="list">
      ${clubs().map((c) => html`
        <button class="card club-row ${c.id === current.id ? 'active' : ''}" data-club="${c.id}">
          <span class="grow"><b>${c.name}</b><br><span class="muted small">${c.team.name} · ${plural(c.players.filter((p) => p.active !== false).length, 'jugador', 'jugadores')} · ${plural(c.matches.length, 'partido', 'partidos')}</span></span>
          ${c.demo ? html`<span class="badge badge-demo">PRUEBA</span>` : ''}
          ${c.id === current.id ? html`<span class="badge badge-active">Activa</span>` : ''}
        </button>`)}
    </div>
    <div class="stack sheet-actions">
      <button class="btn btn-primary btn-block" id="new-club">＋ Nueva liga</button>
      <button class="btn btn-block" id="join-club">Unirme a una liga con un enlace</button>
      <button class="btn btn-block" id="edit-club">Editar «${current.name}»</button>
      <button class="btn btn-block btn-danger" id="delete-club">Eliminar «${current.name}»</button>
    </div>
  `.toString());

  sheet.root.querySelectorAll('[data-club]').forEach((b) => b.addEventListener('click', () => {
    switchClub(b.dataset.club);
    sheet.close();
    toast(`Liga: ${activeClub().name}`);
    onChange();
  }));
  sheet.root.querySelector('#new-club').addEventListener('click', () => { sheet.close(); openClubForm(null, onChange); });
  sheet.root.querySelector('#join-club').addEventListener('click', () => { sheet.close(); openPasteInvite(); });
  sheet.root.querySelector('#edit-club').addEventListener('click', () => { sheet.close(); openClubForm(current, onChange); });
  sheet.root.querySelector('#delete-club').addEventListener('click', () => {
    const n = current.matches.length;
    const shared = syncConfig(current.id);
    if (!confirm(shared
      ? `¿Quitar la liga «${current.name}» de este dispositivo? En el servidor no se borra nada: el resto del equipo la sigue teniendo y puedes volver a entrar con el enlace de invitación.`
      : `¿Eliminar la liga «${current.name}» con sus jugadores, rivales y ${n} ${n === 1 ? 'partido' : 'partidos'}? No se puede deshacer. Exporta antes una copia si la necesitas.`)) return;
    if (shared) removeSyncConfig(current.id);
    deleteClub(current.id);
    sheet.close();
    toast('Liga eliminada');
    onChange();
  });
}

export function openClubForm(club, onChange) {
  const sheet = openSheet(html`
    <h2>${club ? 'Editar liga' : 'Nueva liga'}</h2>
    <form id="club-form" class="stack">
      <label class="field">
        <span>Nombre de la liga</span>
        <input name="name" value="${club?.name ?? ''}" required autocomplete="off" placeholder="Ej.: Liga provincial sénior" />
      </label>
      <label class="field">
        <span>Nombre de mi equipo</span>
        <input name="teamName" value="${club?.team.name ?? ''}" autocomplete="off" placeholder="Ej.: Juvenil femenino" />
      </label>
      <div class="form-actions">
        <button type="button" class="btn" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">${club ? 'Guardar' : 'Crear liga'}</button>
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
    toast(club ? 'Liga guardada' : 'Liga creada: añade tus jugadores');
    if (!club) location.hash = '#/equipo';
    onChange();
  });
}
