import { getData, sortedMatches, playerById, setsSummary } from '../store.js';
import { POSITIONS, positionById, TOUCH_LABEL, skillById } from '../actions.js';
import { filterEvents, countsBy, metrics, teamSummary, rotationStats, zoneStats, rivalStats, freeStats, pct } from '../stats.js';
import { activePlayers, rivalPlayerById } from '../store.js';
import { html, raw, openSheet, formatDate } from '../ui.js';

const TABS = [
  { id: 'jugadores', label: 'Jugadores' },
  { id: 'posiciones', label: 'Posición' },
  { id: 'rotaciones', label: 'Rotación' },
  { id: 'zonas', label: 'Zonas' },
  { id: 'free', label: 'FREE' },
  { id: 'rival', label: 'Rival' },
  { id: 'partidos', label: 'Partidos' },
];

let state = { tab: 'jugadores', matchId: '', set: '', player: '' };

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
        : state.tab === 'rotaciones' ? rotationsTab(events)
        : state.tab === 'zonas' ? zonesTab(events)
        : state.tab === 'free' ? freeTab(events)
        : state.tab === 'rival' ? rivalTab(events, matches)
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
  el.querySelector('#f-player')?.addEventListener('change', (e) => {
    state.player = e.target.value;
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

// ---------- Pestaña Rotaciones ----------

function rotationsTab(events) {
  const rows = rotationStats(events);
  const total = rows.reduce((a, r) => ({ recv: a.recv + r.recv, sideOut: a.sideOut + r.sideOut, serve: a.serve + r.serve, breaks: a.breaks + r.breaks }), { recv: 0, sideOut: 0, serve: 0, breaks: 0 });
  if (total.recv + total.serve === 0) {
    return html`<p class="center muted">Aún no hay puntos registrados con alineación (se registran al jugar con el campo).</p>`;
  }
  return html`
    <section class="kpis">
      ${kpi('Side-out', pct(total.recv ? total.sideOut / total.recv : null), `${total.sideOut} de ${total.recv} recibiendo`)}
      ${kpi('Break', pct(total.serve ? total.breaks / total.serve : null), `${total.breaks} de ${total.serve} sacando`)}
    </section>
    <section class="card">
      <h2>Side-out por rotación</h2>
      ${barChart(rows.map((r) => ({
        label: `R${r.rot}`,
        value: r.recv ? Math.round((r.sideOut / r.recv) * 100) : 0,
        suffix: '%',
        detail: `${r.sideOut} de ${r.recv} puntos recibiendo`,
      })), 100)}
    </section>
    <section class="card">
      <h2>Detalle por rotación <span class="muted small">(R = zona del colocador)</span></h2>
      <div class="table-wrap">
        <table class="stats-table">
          <thead><tr>
            <th class="sticky-col">Rot.</th>
            <th>Recibiendo<br><small>ganados/jugados</small></th><th>Side-out</th>
            <th>Sacando<br><small>ganados/jugados</small></th><th>Break</th>
            <th>Balance</th>
          </tr></thead>
          <tbody>
            ${rows.map((r) => html`
              <tr>
                <th class="sticky-col" scope="row"><b>R${r.rot}</b></th>
                <td>${r.sideOut}/${r.recv}</td>
                <td>${pct(r.recv ? r.sideOut / r.recv : null)}</td>
                <td>${r.breaks}/${r.serve}</td>
                <td>${pct(r.serve ? r.breaks / r.serve : null)}</td>
                <td class="${r.won - r.lost > 0 ? 'good' : r.won - r.lost < 0 ? 'bad' : ''}">${r.won - r.lost > 0 ? '+' : ''}${r.won - r.lost}</td>
              </tr>`)}
          </tbody>
        </table>
      </div>
      <p class="muted small legend">Side-out = puntos ganados cuando saca el rival · Break = puntos ganados con nuestro saque.</p>
    </section>
  `;
}

// ---------- Pestaña Zonas ----------

const OUR_ORDER = [4, 3, 2, 5, 6, 1];
const RIVAL_ORDER = [1, 6, 5, 2, 3, 4];

function zonesTab(allEvents) {
  const players = activePlayers();
  const events = state.player ? allEvents.filter((e) => e.playerId === state.player) : allEvents;
  return html`
    <select id="f-player" aria-label="Jugador">
      <option value="">Todo el equipo</option>
      ${players.map((p) => html`<option value="${p.id}" ${p.id === state.player ? 'selected' : ''}>${p.number} · ${p.name}</option>`)}
    </select>
    <div class="zone-cards">
      ${zoneCard('Ataque · zona de origen', zoneStats(events, 'ataque'), OUR_ORDER, 'puntos')}
      ${zoneCard('Ataque · destino en campo rival', zoneStats(events, 'ataque', 'zoneTo'), RIVAL_ORDER, 'puntos')}
      ${zoneCard('Recepción · zona', zoneStats(events, 'recepcion'), OUR_ORDER, 'positivas')}
      ${zoneCard('Saque · destino en campo rival', zoneStats(events, 'saque', 'zoneTo'), RIVAL_ORDER, 'aces')}
    </div>
    <p class="muted small legend">Cada zona muestra el total de acciones; debajo, cuántas fueron buenas (puntos, aces o recepciones positivas). Cuanto más intenso el color, más acciones.</p>
  `;
}

function zoneCard(title, zones, order, goodLabel) {
  const max = Math.max(1, ...Object.values(zones).map((z) => z.total));
  const rival = order === RIVAL_ORDER;
  return html`
    <section class="card">
      <h2>${title}</h2>
      ${rival ? '' : html`<div class="mini-net">red</div>`}
      <div class="mini-court">
        ${order.map((zn) => {
          const z = zones[zn];
          const share = z.total ? 12 + Math.round((z.total / max) * 48) : 0;
          return html`
            <div class="mini-zone" style="--heat:${share}%" title="Zona ${zn}: ${z.total} acciones, ${z.good} ${goodLabel}, ${z.bad} errores">
              <span class="zone-num">${zn}</span>
              <span class="mz-total">${z.total}</span>
              <span class="mz-sub">${z.total ? `${z.good} ${goodLabel} · ${pct(z.good / z.total)}` : ''}</span>
            </div>`;
        })}
      </div>
      ${rival ? html`<div class="mini-net">red</div>` : ''}
    </section>
  `;
}

// ---------- Pestaña FREE ----------

function freeTab(events) {
  const { ours, theirs } = freeStats(events);
  if (ours.total + theirs.total === 0) {
    return html`<p class="center muted">No hay bolas FREE registradas.</p>`;
  }
  const rate = (a, b) => pct(b ? a / b : null);
  const table = (head, rows) => html`
    <div class="table-wrap">
      <table class="stats-table">
        <thead><tr><th class="sticky-col"></th>${head.map((h) => html`<th>${h}</th>`)}</tr></thead>
        <tbody>${rows.map(([label, ...cells]) => html`<tr><th class="sticky-col" scope="row">${label}</th>${cells.map((c) => html`<td>${c}</td>`)}</tr>`)}</tbody>
      </table>
    </div>`;
  const outcomeRows = (map, labelOf) => [...map].sort((a, b) => b[1].n - a[1].n)
    .map(([k, r]) => [labelOf(k), r.n, r.won, r.lost, rate(r.won, r.won + r.lost)]);
  const playerLabel = (id) => {
    const p = playerById(id);
    return p ? html`<b>${p.number}</b> ${p.name}` : '—';
  };
  const rotRows = (map) => [1, 2, 3, 4, 5, 6].filter((r) => map.has(r))
    .map((r) => [html`<b>R${r}</b>`, map.get(r).n, map.get(r).won, map.get(r).lost, rate(map.get(r).won, map.get(r).won + map.get(r).lost)]);
  const HEAD = ['FREE', 'Ganados', 'Perdidos', '% ganados'];
  const attackResults = [...skillById('ataque').results.map((r) => [r.label, theirs.firstAttack[r.id] || 0]), ['Sin llegar a atacar', theirs.noAttack]];

  return html`
    <section class="kpis">
      ${kpi('FREE nuestras', ours.total, `ganamos ${rate(ours.won, ours.won + ours.lost)} de esos puntos`)}
      ${kpi('FREE del rival', theirs.total, `ganamos ${rate(theirs.won, theirs.won + theirs.lost)} de esos puntos`)}
    </section>

    ${ours.total ? html`
      <section class="card">
        <h2>Nuestras FREE · quién</h2>
        ${table(HEAD, outcomeRows(ours.byPlayer, playerLabel))}
      </section>
      <section class="card">
        <h2>Nuestras FREE · en qué toque</h2>
        ${table(HEAD, outcomeRows(ours.byTouch, (k) => TOUCH_LABEL[k] ?? k))}
        <p class="muted small legend">Punto directo del rival justo después de nuestra FREE: <b>${ours.direct}</b> (${rate(ours.direct, ours.total)}).</p>
      </section>
      <section class="card">
        <h2>Nuestras FREE · por rotación</h2>
        ${table(HEAD, rotRows(ours.byRot))}
      </section>` : ''}

    ${theirs.total ? html`
      <section class="card">
        <h2>FREE del rival · cómo las aprovechamos</h2>
        ${table(['Veces', '%'], attackResults.map(([label, n]) => [label, n, rate(n, theirs.total)]))}
        <p class="muted small legend">Resultado de nuestro primer ataque después de recibir la FREE.</p>
      </section>
      <section class="card">
        <h2>FREE del rival · por rotación</h2>
        ${table(HEAD, rotRows(theirs.byRot))}
      </section>` : ''}

    <div class="zone-cards">
      ${zoneCard('Nuestras FREE · destino', ours.zones, RIVAL_ORDER, 'ganadas')}
      ${zoneCard('FREE del rival · origen', theirs.zones, RIVAL_ORDER, 'ganadas')}
    </div>
  `;
}

// ---------- Pestaña Rival ----------

function rivalTab(events, matches) {
  const r = rivalStats(events);
  const opponentOf = new Map(matches.map((m) => [m.id, m.opponent]));
  const rivalRows = [...r.players].map(([id, s]) => {
    const ev = events.find((e) => e.rivalPlayerId === id);
    return { p: rivalPlayerById(opponentOf.get(ev?.matchId) ?? '', id), team: opponentOf.get(ev?.matchId), s };
  }).filter((x) => x.p).sort((a, b) => b.s.points - a.s.points);
  return html`
    <div class="zone-cards">
      ${zoneCard('Ataque rival · zona de origen', r.attack, RIVAL_ORDER, 'pts. rival')}
    </div>

    ${rivalRows.length ? html`
      <section class="card">
        <h2>Jugadores rivales</h2>
        <div class="table-wrap">
          <table class="stats-table">
            <thead><tr><th class="sticky-col"></th><th>Saques</th><th>Ataques</th><th>Puntos</th><th>Errores</th></tr></thead>
            <tbody>
              ${rivalRows.map(({ p, team, s }) => html`
                <tr>
                  <th class="sticky-col" scope="row"><b>${p.number}</b> ${p.name} ${state.matchId ? '' : html`<small class="muted">${team}</small>`}</th>
                  <td>${s.serves}</td><td>${s.attacks}</td><td><b>${s.points}</b></td><td>${s.errors}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>
        <p class="muted small legend">Solo acciones en las que se marcó el jugador rival.</p>
      </section>` : html`<p class="muted small center">Añade la plantilla del rival en el partido para ver estadísticas por jugador rival.</p>`}
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
function barChart(items, fixedMax = null) {
  const max = fixedMax ?? Math.max(1, ...items.map((i) => i.value));
  return html`
    <div class="bars" role="table">
      ${items.map((i) => html`
        <div class="bar-row" role="row" title="${i.label}: ${i.value}${i.suffix ?? ' puntos'} · ${i.detail}" tabindex="0">
          <span class="bar-label" role="cell">${i.label}</span>
          <span class="bar-track" role="cell">
            <span class="bar-fill" style="width:${(i.value / max) * 100}%"></span>
          </span>
          <span class="bar-value" role="cell">${i.value}${i.suffix ?? ''}</span>
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
            <th title="Bloqueos punto (block)">Block</th>
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
    Pts = ace + ataque punto + block · Ced = errores que dan punto al rival ·
    Ef. ataque = (puntos − errores − bloqueados) / total.
  </p>`;
}

function playerDetail(playerId, events) {
  const p = playerById(playerId);
  const g = countsBy(events.filter((e) => e.playerId === playerId), () => 'x').get('x');
  if (!p || !g) return;
  const m = metrics(g.counts);
  const frees = events.filter((e) => e.playerId === playerId && e.skill === 'equipo' && e.result === 'free');
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
    ${block('Ataque', [['Total', m.ataque.total], ['Puntos', m.ataque.punto], ['Blockouts', m.ataque.blockout], ['Errores', m.ataque.error], ['Bloqueados', m.ataque.bloqueado], ['% Punto', pct(m.ataque.kill)], ['Eficacia', pct(m.ataque.eff)]])}
    ${block('Bloqueo', [['Block', m.bloqueo.punto], ['Toques', m.bloqueo.toque], ['Blockout', m.bloqueo.error]])}
    ${block('Defensa', [['Total', m.defensa.total], ['Buenas', m.defensa.buena], ['Errores', m.defensa.error]])}
    ${block('Colocación', [['Total', m.colocacion.total], ['Buenas', m.colocacion.buena], ['Errores', m.colocacion.error]])}
    ${block('FREE enviadas', Object.entries(TOUCH_LABEL).map(([k, label]) => [label, frees.filter((e) => (e.phase ?? 'attack') === k).length]).filter(([, n]) => n).concat([['Total', frees.length]]))}
  `.toString());
}
