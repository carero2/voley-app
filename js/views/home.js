import { getData, sortedMatches, setsSummary, setScore, activePlayers } from '../store.js';
import { html, formatDate } from '../ui.js';
import { conflictCards, bindConflictCards } from './sync-ui.js';

export function renderHome(el) {
  const matches = sortedMatches();
  const hasPlayers = activePlayers().length > 0;
  const live = matches.filter((m) => m.status === 'live');
  const done = matches.filter((m) => m.status !== 'live');

  el.innerHTML = html`
    <header class="page-head">
      <h1>${getData().team.name}</h1>
      <p class="muted">${matches.length} ${matches.length === 1 ? 'partido' : 'partidos'} registrados</p>
    </header>

    ${hasPlayers
      ? html`<a class="btn btn-primary btn-block btn-lg" href="#/partido/nuevo">＋ Nuevo partido</a>`
      : html`<div class="card empty">
          <p>Empieza añadiendo a los jugadores de tu equipo.</p>
          <a class="btn btn-primary" href="#/equipo">Crear plantilla</a>
        </div>`}

    ${conflictCards()}

    ${live.length ? html`
      <h2 class="list-title">En juego</h2>
      <section class="list">${live.map((m) => matchCard(m))}</section>` : ''}
    ${done.length ? html`
      <h2 class="list-title">${live.length ? 'Terminados' : 'Partidos'}</h2>
      <section class="list">${done.map((m) => matchCard(m))}</section>` : ''}
    ${!matches.length && hasPlayers ? html`<p class="muted center small">Aún no hay partidos. Pulsa «Nuevo partido» al empezar el primero.</p>` : ''}
  `;
  bindConflictCards(el, () => renderHome(el));
}

function matchCard(m) {
  const { sets, won, lost } = setsSummary(m);
  const live = m.status === 'live';
  const cur = setScore(m, m.currentSet);
  const result = won > lost ? 'win' : won < lost ? 'loss' : '';
  // Parciales de cada set: 25-20 · 23-25…
  const partials = [...sets, ...(live && (cur.us || cur.them) ? [{ ...cur, live: true }] : [])];
  return html`
    <a class="card match-card" href="#/partido/${m.id}">
      <div class="grow">
        <div class="match-opp">vs ${m.opponent}</div>
        <div class="muted small">${formatDate(m.date)}${m.place ? ` · ${m.place}` : ''}</div>
        ${partials.length ? html`<div class="set-line">${partials.map((s) => html`<span class="${s.live ? 'cur' : s.us > s.them ? 'w' : 'l'}">${s.us}-${s.them}</span>`)}</div>` : ''}
      </div>
      <div class="match-res">
        ${live
          ? html`<span class="badge badge-live">Set ${m.currentSet} · ${cur.us}-${cur.them}</span>`
          : html`<span class="sets ${result}">${won}-${lost}</span>`}
      </div>
    </a>
  `;
}
