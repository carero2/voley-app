import { getData, activePlayers, playerById, savePlayer, removePlayer, setTeamName } from '../store.js';
import { POSITIONS, positionById } from '../actions.js';
import { html, openSheet, toast } from '../ui.js';

export function renderTeam(el) {
  const players = activePlayers();

  el.innerHTML = html`
    <header class="page-head">
      <h1>Plantilla</h1>
    </header>

    <form class="card form-inline" id="team-form">
      <label class="field grow">
        <span>Nombre del equipo</span>
        <input name="name" value="${getData().team.name}" autocomplete="off" />
      </label>
      <button class="btn" type="submit">Guardar</button>
    </form>

    <button class="btn btn-primary btn-block" id="add-player">＋ Añadir jugador</button>

    <section class="list">
      ${players.length === 0 ? html`<p class="muted center">Aún no hay jugadores.</p>` : ''}
      ${players.map((p) => html`
        <button class="card player-row" data-id="${p.id}">
          <span class="dorsal">${p.number}</span>
          <span class="grow">${p.name}</span>
          <span class="pos-tag pos-${p.position}">${positionById(p.position)?.label ?? ''}</span>
        </button>
      `)}
    </section>
  `;

  el.querySelector('#team-form').addEventListener('submit', (e) => {
    e.preventDefault();
    setTeamName(new FormData(e.target).get('name'));
    toast('Nombre guardado');
  });
  el.querySelector('#add-player').addEventListener('click', () => editPlayer(null, () => renderTeam(el)));
  el.querySelectorAll('.player-row').forEach((b) =>
    b.addEventListener('click', () => editPlayer(b.dataset.id, () => renderTeam(el))),
  );
}

function editPlayer(id, done) {
  const p = id ? playerById(id) : { number: '', name: '', position: 'receptor' };
  const sheet = openSheet(html`
    <h2>${id ? 'Editar jugador' : 'Nuevo jugador'}</h2>
    <form id="player-form" class="stack">
      <div class="form-row">
        <label class="field dorsal-field">
          <span>Dorsal</span>
          <input name="number" inputmode="numeric" value="${p.number}" required />
        </label>
        <label class="field grow">
          <span>Nombre</span>
          <input name="name" value="${p.name}" required autocomplete="off" />
        </label>
      </div>
      <fieldset class="field">
        <span>Posición</span>
        <div class="chips">
          ${POSITIONS.map((pos) => html`
            <label class="chip">
              <input type="radio" name="position" value="${pos.id}" ${pos.id === p.position ? 'checked' : ''} />
              <span>${pos.label}</span>
            </label>
          `)}
        </div>
      </fieldset>
      <div class="form-actions">
        ${id ? html`<button type="button" class="btn btn-danger" id="del">Eliminar</button>` : ''}
        <button type="button" class="btn" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">Guardar</button>
      </div>
    </form>
  `.toString());

  const form = sheet.root.querySelector('#player-form');
  if (!id) form.number.focus();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    savePlayer({ id, number: fd.get('number'), name: fd.get('name'), position: fd.get('position') });
    sheet.close();
    done();
  });
  sheet.root.querySelector('#del')?.addEventListener('click', () => {
    if (!confirm(`¿Eliminar a ${p.name}? Si tiene estadísticas se conservarán en los partidos pasados.`)) return;
    removePlayer(id);
    sheet.close();
    done();
  });
}
