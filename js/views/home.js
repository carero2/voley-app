import { getData, sortedMatches, setsSummary, setScore, activePlayers } from '../store.js';
import { html, formatDate } from '../ui.js';

export function renderHome(el) {
  const matches = sortedMatches();
  const hasPlayers = activePlayers().length > 0;

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

    <section class="list">
      ${matches.map((m) => matchCard(m))}
    </section>
  `;
}

function matchCard(m) {
  const { won, lost } = setsSummary(m);
  const live = m.status === 'live';
  const cur = setScore(m, m.currentSet);
  const result = won > lost ? 'win' : won < lost ? 'loss' : '';
  return html`
    <a class="card match-card" href="#/partido/${m.id}">
      <div>
        <div class="match-opp">vs ${m.opponent}</div>
        <div class="muted small">${formatDate(m.date)}${m.place ? ` · ${m.place}` : ''}</div>
      </div>
      <div class="match-res">
        ${live
          ? html`<span class="badge badge-live">En juego · Set ${m.currentSet} ${cur.us}-${cur.them}</span>`
          : html`<span class="sets ${result}">${won}-${lost}</span>`}
      </div>
    </a>
  `;
}
