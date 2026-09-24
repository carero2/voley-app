import {
  getData, activePlayers, playerById, matchById, createMatch, addEvent, undoLastEvent,
  setScore, setWinner, setsSummary, closeSet, reopenMatch, deleteMatch, updateMatch,
} from '../store.js';
import { SKILLS, TEAM_EVENTS, positionById, describeEvent } from '../actions.js';
import { html, openSheet, toast, vibrate, today, formatDate } from '../ui.js';

// ---------- Nuevo partido ----------

export function renderNewMatch(el) {
  const players = activePlayers();
  el.innerHTML = html`
    <header class="page-head with-back">
      <a class="back" href="#/" aria-label="Volver">‹</a>
      <h1>Nuevo partido</h1>
    </header>
    <form id="new-match" class="card stack">
      <label class="field">
        <span>Rival</span>
        <input name="opponent" required autocomplete="off" placeholder="Nombre del rival" />
      </label>
      <div class="form-row">
        <label class="field grow">
          <span>Fecha</span>
          <input name="date" type="date" value="${today()}" required />
        </label>
        <label class="field grow">
          <span>Lugar</span>
          <input name="place" autocomplete="off" placeholder="Opcional" />
        </label>
      </div>
      <fieldset class="field">
        <span>Formato</span>
        <div class="chips">
          <label class="chip"><input type="radio" name="bestOf" value="5" checked /><span>Al mejor de 5</span></label>
          <label class="chip"><input type="radio" name="bestOf" value="3" /><span>Al mejor de 3</span></label>
        </div>
      </fieldset>
      <fieldset class="field">
        <span>Convocados (${players.length})</span>
        <div class="chips">
          ${players.map((p) => html`
            <label class="chip">
              <input type="checkbox" name="roster" value="${p.id}" checked />
              <span><b>${p.number}</b> ${p.name}</span>
            </label>
          `)}
        </div>
      </fieldset>
      <button class="btn btn-primary btn-block btn-lg" type="submit">Empezar partido</button>
    </form>
  `;

  el.querySelector('#new-match').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const roster = fd.getAll('roster');
    if (roster.length === 0) {
      toast('Selecciona al menos un jugador');
      return;
    }
    const m = createMatch({
      opponent: fd.get('opponent'),
      date: fd.get('date'),
      place: fd.get('place'),
      bestOf: fd.get('bestOf'),
      roster,
    });
    location.hash = `#/partido/${m.id}`;
  });
}

// ---------- Partido (en directo o finalizado) ----------

export function renderMatch(el, { id }) {
  const match = matchById(id);
  if (!match) {
    el.innerHTML = html`<p class="center muted">Partido no encontrado. <a href="#/">Volver</a></p>`;
    return;
  }
  const rerender = () => renderMatch(el, { id });
  if (match.status === 'finished') return renderFinished(el, match, rerender);

  const teamName = getData().team.name;
  const score = setScore(match, match.currentSet);
  const winner = setWinner(match, match.currentSet);
  const { sets, won, lost } = setsSummary(match);
  const roster = match.roster.map(playerById).filter(Boolean)
    .sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
  const recent = match.events.slice(-6).reverse();

  el.innerHTML = html`
    <header class="page-head with-back live-head">
      <a class="back" href="#/" aria-label="Volver">‹</a>
      <h1>vs ${match.opponent}</h1>
      <button class="btn btn-ghost" id="menu" aria-label="Opciones">⋯</button>
    </header>

    <section class="scoreboard">
      <div class="sb-team">
        <span class="sb-name">${teamName}</span>
        <span class="sb-score">${score.us}</span>
      </div>
      <div class="sb-mid">
        <span class="sb-set">Set ${match.currentSet}</span>
        <span class="sb-sets">${won} - ${lost}</span>
        <span class="sb-prev">${sets.map((s) => `${s.us}-${s.them}`).join(' · ')}</span>
      </div>
      <div class="sb-team">
        <span class="sb-name">${match.opponent}</span>
        <span class="sb-score">${score.them}</span>
      </div>
    </section>

    ${winner ? html`
      <div class="banner ${winner === 'us' ? 'banner-good' : 'banner-bad'}">
        <span>${winner === 'us' ? '¡Set ganado!' : 'Set perdido'} (${score.us}-${score.them})</span>
        <button class="btn btn-primary" id="close-set">Cerrar set</button>
      </div>` : ''}

    <div class="team-actions">
      <button class="btn btn-lg tone-good" data-team="errorRival">＋ ${TEAM_EVENTS.errorRival.label}</button>
      <button class="btn btn-lg tone-error" data-team="puntoRival">− ${TEAM_EVENTS.puntoRival.label}</button>
    </div>

    <section class="player-grid">
      ${roster.map((p) => html`
        <button class="player-btn" data-player="${p.id}">
          <span class="pb-number">${p.number}</span>
          <span class="pb-name">${p.name}</span>
          <span class="pos-tag pos-${p.position}">${positionById(p.position)?.short ?? ''}</span>
        </button>
      `)}
    </section>

    <section class="log">
      <div class="log-head">
        <h2>Últimas acciones</h2>
        <button class="btn" id="undo" ${match.events.length || match.currentSet > 1 ? '' : 'disabled'}>↶ Deshacer</button>
      </div>
      ${recent.length === 0 ? html`<p class="muted small">Toca un jugador para registrar una acción.</p>` : ''}
      <ol class="log-list">
        ${recent.map((ev) => logItem(ev, match))}
      </ol>
    </section>
  `;

  el.querySelectorAll('[data-team]').forEach((b) =>
    b.addEventListener('click', () => {
      const def = TEAM_EVENTS[b.dataset.team];
      addEvent(match.id, { skill: def.skill, result: def.result });
      vibrate();
      rerender();
    }),
  );

  el.querySelectorAll('[data-player]').forEach((b) =>
    b.addEventListener('click', () => openActionSheet(match, playerById(b.dataset.player), rerender)),
  );

  el.querySelector('#undo').addEventListener('click', () => {
    const undone = undoLastEvent(match.id);
    if (undone?.type === 'event') toast(`Deshecho: ${describeEvent(undone.event)}`);
    else if (undone?.type === 'set') toast(`Set ${match.currentSet} reabierto`);
    rerender();
  });

  el.querySelector('#close-set')?.addEventListener('click', () => {
    const status = closeSet(match.id);
    toast(status === 'finished' ? 'Partido finalizado' : `Empieza el set ${match.currentSet}`);
    rerender();
  });

  el.querySelector('#menu').addEventListener('click', () => openMatchMenu(match, rerender));
}

function logItem(ev, match) {
  const p = ev.playerId ? playerById(ev.playerId) : null;
  const tone = ev.point === 'us' ? 'good' : ev.point === 'them' ? 'error' : 'neutral';
  const running = scoreAt(match, ev);
  return html`
    <li class="log-item">
      <span class="dot tone-${tone}"></span>
      <span class="grow">${p ? html`<b>${p.number}</b> ${p.name} · ` : ''}${describeEvent(ev)}</span>
      <span class="muted small">${ev.point ? `${running.us}-${running.them}` : `S${ev.set}`}</span>
    </li>
  `;
}

// Marcador justo después de un evento concreto.
function scoreAt(match, target) {
  let us = 0; let them = 0;
  for (const e of match.events) {
    if (e.set !== target.set) continue;
    if (e.point === 'us') us++; else if (e.point === 'them') them++;
    if (e.id === target.id) break;
  }
  return { us, them };
}

function openActionSheet(match, player, rerender) {
  const sheet = openSheet(html`
    <div class="sheet-title">
      <span class="dorsal">${player.number}</span>
      <h2 class="grow">${player.name}</h2>
      <button class="btn btn-ghost" data-close aria-label="Cerrar">✕</button>
    </div>
    <div class="skill-list">
      ${SKILLS.map((s) => html`
        <div class="skill-row">
          <span class="skill-name">${s.label}</span>
          <div class="skill-results">
            ${s.results.map((r) => html`
              <button class="btn tone-${r.tone}" data-skill="${s.id}" data-result="${r.id}">${r.label}</button>
            `)}
          </div>
        </div>
      `)}
    </div>
  `.toString());

  sheet.root.querySelectorAll('[data-skill]').forEach((b) =>
    b.addEventListener('click', () => {
      const ev = addEvent(match.id, { playerId: player.id, skill: b.dataset.skill, result: b.dataset.result });
      vibrate();
      toast(`${player.number} ${player.name} · ${describeEvent(ev)}`);
      sheet.close();
      rerender();
    }),
  );
}

function openMatchMenu(match, rerender) {
  const sheet = openSheet(html`
    <h2>Opciones del partido</h2>
    <div class="stack">
      <button class="btn btn-block" id="m-close-set">Cerrar set ${match.currentSet} ahora</button>
      <button class="btn btn-block" id="m-roster">Cambiar convocados</button>
      <a class="btn btn-block" href="#/estadisticas?m=${match.id}" data-close>Ver estadísticas</a>
      <button class="btn btn-block btn-danger" id="m-delete">Eliminar partido</button>
      <button class="btn btn-block btn-ghost" data-close>Cancelar</button>
    </div>
  `.toString());

  sheet.root.querySelector('#m-close-set').addEventListener('click', () => {
    const s = setScore(match, match.currentSet);
    if (!confirm(`¿Cerrar el set ${match.currentSet} con ${s.us}-${s.them}?`)) return;
    closeSet(match.id);
    sheet.close();
    rerender();
  });
  sheet.root.querySelector('#m-roster').addEventListener('click', () => {
    sheet.close();
    editRoster(match, rerender);
  });
  sheet.root.querySelector('#m-delete').addEventListener('click', () => {
    if (!confirm('¿Eliminar este partido y todas sus acciones? No se puede deshacer.')) return;
    deleteMatch(match.id);
    sheet.close();
    location.hash = '#/';
  });
}

function editRoster(match, rerender) {
  const sheet = openSheet(html`
    <h2>Convocados</h2>
    <form id="roster-form" class="stack">
      <div class="chips">
        ${activePlayers().map((p) => html`
          <label class="chip">
            <input type="checkbox" name="roster" value="${p.id}" ${match.roster.includes(p.id) ? 'checked' : ''} />
            <span><b>${p.number}</b> ${p.name}</span>
          </label>
        `)}
      </div>
      <div class="form-actions">
        <button type="button" class="btn" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">Guardar</button>
      </div>
    </form>
  `.toString());
  sheet.root.querySelector('#roster-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const roster = new FormData(e.target).getAll('roster');
    if (!roster.length) return toast('Selecciona al menos un jugador');
    updateMatch(match.id, { roster });
    sheet.close();
    rerender();
  });
}

function renderFinished(el, match, rerender) {
  const { sets, won, lost } = setsSummary(match);
  const result = won > lost ? 'Victoria' : won < lost ? 'Derrota' : 'Empate';
  el.innerHTML = html`
    <header class="page-head with-back">
      <a class="back" href="#/" aria-label="Volver">‹</a>
      <h1>vs ${match.opponent}</h1>
    </header>
    <section class="card center">
      <p class="muted small">${formatDate(match.date)}${match.place ? ` · ${match.place}` : ''}</p>
      <p class="final ${won > lost ? 'win' : 'loss'}">${result} ${won}-${lost}</p>
      <div class="set-scores">
        ${sets.map((s) => html`<span class="set-chip ${s.us > s.them ? 'win' : 'loss'}">S${s.set} ${s.us}-${s.them}</span>`)}
      </div>
    </section>
    <a class="btn btn-primary btn-block btn-lg" href="#/estadisticas?m=${match.id}">Ver estadísticas</a>
    <div class="form-actions">
      <button class="btn" id="reopen">Reabrir partido</button>
      <button class="btn btn-danger" id="delete">Eliminar</button>
    </div>
  `;
  el.querySelector('#reopen').addEventListener('click', () => {
    reopenMatch(match.id);
    rerender();
  });
  el.querySelector('#delete').addEventListener('click', () => {
    if (!confirm('¿Eliminar este partido y todas sus acciones? No se puede deshacer.')) return;
    deleteMatch(match.id);
    location.hash = '#/';
  });
}
