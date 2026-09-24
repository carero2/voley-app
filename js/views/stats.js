import { getData, sortedMatches, playerById, setsSummary } from '../store.js';
import { POSITIONS, positionById } from '../actions.js';
import { filterEvents, countsBy, metrics, teamSummary, pct } from '../stats.js';
import { html, raw, openSheet, formatDate } from '../ui.js';

const TABS = [
  { id: 'jugadores', label: 'Jugadores' },
  { id: 'posiciones', label: 'Posiciones' },
  { id: 'partidos', label: 'Partidos' },
];

let state = { tab: 'jugadores', matchId: '', set: '' };

export function renderStats(el, { query }) {
  if (query.m !== undefined) {
    state = { ...state, matchId: query.m, set: '' };
    history.replaceState(null, '', '#/estadisticas');
  }
  const matches = sortedMatches();
  if (state.matchId && !matches.some((m) => m.id === state.matchId)) state.matchId = '';
  const selected = matches.find((m) => m.id === state.matchId);
  const maxSet = selected ? selected.currentSet : 0;

  const events = filterEvents(getData().matches, {
    matchIds: state.matchId ? [state.matchId] : null,
    set: state.set ? Number(state.set) : null,
  });

  el.innerHTML = html`
    <header class="page-head"><h1>Estadísticas</h1></header>

    <div class="filters">
      <select id="f-match" aria-label="Partido">
        <option value="">Todos los partidos</option>
        ${matches.map((m) => html`<option value="${m.id}" ${m.id === state.matchId ? 'selected' : ''}>${formatDate(m.date)} · vs ${m.opponent}</option>`)}
      </select>
      <select id="f-set" aria-label="Set" ${selected ? '' : 'disabled'}>
        <option value="">Todos los sets</option>
        ${Array.from({ length: maxSet }, (_, i) => i + 1).map((s) =>
          html`<option value="${s}" ${String(s) === state.set ? 'selected' : ''}>Set ${s}</option>`)}
      </select>
    </div>

    <nav class="tabs" role="tablist">
      ${TABS.map((t) => html`<button role="tab" class="tab ${t.id === state.tab ? 'active' : ''}" data-tab="${t.id}" aria-selected="${String(t.id === state.tab)}">${t.label}</button>`)}
    </nav>

    <div id="tab-body">
      ${events.length === 0
        ? html`<p class="center muted">No hay acciones registradas todavía.</p>`
        : state.tab === 'jugadores' ? playersTab(events)
        : state.tab === 'posiciones' ? positionsTab(events)
        : matchesTab(matches.filter((m) => !state.matchId || m.id === state.matchId))}
    </div>
  `;

  const rerender = () => renderStats(el, { query: {} });
  el.querySelector('#f-match').addEventListener('change', (e) => {
    state.matchId = e.target.value;
    state.set = '';
    rerender();
  });
  el.querySelector('#f-set').addEventListener('change', (e) => {
    state.set = e.target.value;
    rerender();
  });
  el.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => { state.tab = b.dataset.tab; rerender(); }),
  );
  el.querySelectorAll('[data-player-detail]').forEach((row) =>
    row.addEventListener('click', () => playerDetail(row.dataset.playerDetail, events)),
  );
}

// ---------- Pestaña Jugadores ----------

function playersTab(events) {
  const team = teamSummary(events);
  const rows = [...countsBy(events, (e) => e.playerId)]
    .map(([id, g]) => ({ player: playerById(id), m: metrics(g.counts), matches: g.matches.size }))
    .filter((r) => r.player)
    .sort((a, b) => b.m.points - a.m.points || a.m.given - b.m.given);

  return html`
    <section class="kpis">
      ${kpi('Puntos ganados', team.won, `${team.ownPoints} propios · ${team.rivalErrors} errores rival`)}
      ${kpi('Puntos cedidos', team.lost, `${team.ownErrors} errores propios · ${team.rivalPoints} del rival`)}
    </section>

    <section class="card">
      <h2>Puntos por jugador</h2>
      ${barChart(rows.map((r) => ({ label: `${r.player.number} ${r.player.name}`, value: r.m.points, detail: detailText(r.m) })))}
    </section>

    <section class="card">
      <h2>Detalle <span class="muted small">(toca un jugador)</span></h2>
      ${statsTable(rows.map((r) => ({
        key: r.player.id,
        label: html`<b>${r.player.number}</b> ${r.player.name}`,
        m: r.m,
      })), true)}
      ${legend()}
    </section>
  `;
}

function detailText(m) {
  return `Ataque ${m.ataque.punto} · Saque ${m.saque.ace} · Bloqueo ${m.bloqueo.punto}`;
}

// ---------- Pestaña Posiciones ----------

function positionsTab(events) {
  const groups = countsBy(events, (e) => playerById(e.playerId)?.position);
  const rows = POSITIONS.filter((p) => groups.has(p.id)).map((p) => ({
    key: p.id,
    label: html`<span class="pos-tag pos-${p.id}">${p.label}</span>`,
    m: metrics(groups.get(p.id).counts),
  }));
  return html`
    <section class="card">
      <h2>Puntos por posición</h2>
      ${barChart(rows.map((r) => ({ label: positionById(r.key).label, value: r.m.points, detail: detailText(r.m) })))}
    </section>
    <section class="card">
      <h2>Rendimiento por posición</h2>
      ${statsTable(rows, false)}
      ${legend()}
    </section>
  `;
}

// ---------- Pestaña Partidos ----------

function matchesTab(matches) {
  return html`
    <section class="list">
      ${matches.map((m) => {
        const ev = filterEvents([m]);
        const t = teamSummary(ev);
        const all = countsBy(ev, () => 'team').get('team');
        const mm = all ? metrics(all.counts) : null;
        const { sets, won, lost } = setsSummary(m);
        return html`
          <article class="card">
            <div class="match-card">
              <div>
                <div class="match-opp">vs ${m.opponent}</div>
                <div class="muted small">${formatDate(m.date)}${m.status === 'live' ? ' · en juego' : ''}</div>
              </div>
              <span class="sets ${won > lost ? 'win' : won < lost ? 'loss' : ''}">${won}-${lost}</span>
            </div>
            <div class="set-scores">
              ${sets.map((s) => html`<span class="set-chip ${s.us > s.them ? 'win' : 'loss'}">S${s.set} ${s.us}-${s.them}</span>`)}
            </div>
            <dl class="mini-stats">
              <div><dt>Puntos propios</dt><dd>${t.ownPoints}</dd></div>
              <div><dt>Errores rival</dt><dd>${t.rivalErrors}</dd></div>
              <div><dt>Errores propios</dt><dd>${t.ownErrors}</dd></div>
              <div><dt>Ef. ataque</dt><dd>${pct(mm?.ataque.eff)}</dd></div>
              <div><dt>Rec. positiva</dt><dd>${pct(mm?.recepcion.positive)}</dd></div>
              <div><dt>Aces / err. saque</dt><dd>${mm ? `${mm.saque.ace} / ${mm.saque.error}` : '–'}</dd></div>
            </dl>
          </article>
        `;
      })}
    </section>
  `;
}

// ---------- Componentes ----------

function kpi(label, value, sub) {
  return html`
    <div class="card kpi">
      <span class="kpi-label">${label}</span>
      <span class="kpi-value">${value}</span>
      <span class="muted small">${sub}</span>
    </div>
  `;
}

// Gráfico de barras horizontales de una sola serie (sin librerías).
function barChart(items) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return html`
    <div class="bars" role="table">
      ${items.map((i) => html`
        <div class="bar-row" role="row" title="${i.label}: ${i.value} puntos · ${i.detail}" tabindex="0">
          <span class="bar-label" role="cell">${i.label}</span>
          <span class="bar-track" role="cell">
            <span class="bar-fill" style="width:${(i.value / max) * 100}%"></span>
          </span>
          <span class="bar-value" role="cell">${i.value}</span>
          <span class="bar-tip">${i.detail}</span>
        </div>
      `)}
    </div>
  `;
}

function statsTable(rows, clickable) {
  return html`
    <div class="table-wrap">
      <table class="stats-table">
        <thead>
          <tr>
            <th class="sticky-col"></th>
            <th title="Puntos ganados">Pts</th>
            <th title="Puntos cedidos por errores">Ced</th>
            <th title="Saques: aces / errores / total">Saque<br><small>A/E/T</small></th>
            <th title="Recepción positiva (perfecta+buena)">Rec<br><small>pos%</small></th>
            <th title="Recepción perfecta">Rec<br><small>perf%</small></th>
            <th title="Ataques: puntos / total">Ataque<br><small>P/T</small></th>
            <th title="Eficacia de ataque = (puntos − errores − bloqueados) / total">Ataque<br><small>efic.</small></th>
            <th title="Bloqueos punto">Bloq</th>
            <th title="Defensas buenas / total">Def<br><small>B/T</small></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => html`
            <tr ${raw(clickable ? `data-player-detail="${r.key}" class="clickable"` : '')}>
              <th class="sticky-col" scope="row">${r.label}</th>
              <td><b>${r.m.points}</b></td>
              <td>${r.m.given}</td>
              <td>${r.m.saque.ace}/${r.m.saque.error}/${r.m.saque.total}</td>
              <td>${pct(r.m.recepcion.positive)}</td>
              <td>${pct(r.m.recepcion.perfect)}</td>
              <td>${r.m.ataque.punto}/${r.m.ataque.total}</td>
              <td class="${effClass(r.m.ataque.eff)}">${pct(r.m.ataque.eff)}</td>
              <td>${r.m.bloqueo.punto}</td>
              <td>${r.m.defensa.buena}/${r.m.defensa.total}</td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}

const effClass = (v) => (v == null ? '' : v >= 0.3 ? 'good' : v < 0.1 ? 'bad' : '');

function legend() {
  return html`<p class="muted small legend">
    Pts = ace + ataque punto + bloqueo punto · Ced = errores que dan punto al rival ·
    Ef. ataque = (puntos − errores − bloqueados) / total.
  </p>`;
}

function playerDetail(playerId, events) {
  const p = playerById(playerId);
  const g = countsBy(events.filter((e) => e.playerId === playerId), () => 'x').get('x');
  if (!p || !g) return;
  const m = metrics(g.counts);
  const block = (title, items) => html`
    <div class="detail-block">
      <h3>${title}</h3>
      <dl class="mini-stats">
        ${items.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}
      </dl>
    </div>`;

  openSheet(html`
    <div class="sheet-title">
      <span class="dorsal">${p.number}</span>
      <div class="grow">
        <h2>${p.name}</h2>
        <span class="muted small">${positionById(p.position)?.label ?? ''} · ${g.matches.size} ${g.matches.size === 1 ? 'partido' : 'partidos'}</span>
      </div>
      <button class="btn btn-ghost" data-close aria-label="Cerrar">✕</button>
    </div>
    <dl class="mini-stats highlight">
      <div><dt>Puntos</dt><dd>${m.points}</dd></div>
      <div><dt>Cedidos</dt><dd>${m.given}</dd></div>
      <div><dt>Balance</dt><dd>${m.balance > 0 ? '+' : ''}${m.balance}</dd></div>
    </dl>
    ${block('Saque', [['Total', m.saque.total], ['Aces', m.saque.ace], ['Errores', m.saque.error], ['Eficacia', pct(m.saque.eff)]])}
    ${block('Recepción', [['Total', m.recepcion.total], ['Perfectas', m.recepcion.perfecta], ['Positiva', pct(m.recepcion.positive)], ['Errores', m.recepcion.error]])}
    ${block('Ataque', [['Total', m.ataque.total], ['Puntos', m.ataque.punto], ['Errores', m.ataque.error], ['Bloqueados', m.ataque.bloqueado], ['% Punto', pct(m.ataque.kill)], ['Eficacia', pct(m.ataque.eff)]])}
    ${block('Bloqueo', [['Puntos', m.bloqueo.punto], ['Toques', m.bloqueo.toque], ['Errores', m.bloqueo.error]])}
    ${block('Defensa', [['Total', m.defensa.total], ['Buenas', m.defensa.buena], ['Errores', m.defensa.error]])}
    ${block('Colocación', [['Total', m.colocacion.total], ['Buenas', m.colocacion.buena], ['Errores', m.colocacion.error]])}
  `.toString());
}
