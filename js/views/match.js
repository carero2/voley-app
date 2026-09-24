import {
  getData, activePlayers, playerById, matchById, createMatch, addEvent, undoLastEvent,
  setScore, setWinner, setsSummary, closeSet, reopenMatch, deleteMatch, updateMatch,
  setLineup, substitute, rivalPlayers, rivalPlayerById, rivalTeams,
} from '../store.js';
import { SKILLS, TEAM_EVENTS, skillById, positionById, describeEvent } from '../actions.js';
import {
  SYSTEMS, buildSetup, setState, courtLayout, rotationOf, currentPhase, suggestedSetter, PHASES,
  formation, formationKind, isFront,
} from '../rally.js';
import { html, raw, openSheet, toast, vibrate, today, formatDate } from '../ui.js';
import { openRivalEditor } from './rivals.js';

// ---------- Nuevo partido ----------

export function renderNewMatch(el) {
  const players = activePlayers();
  const rivals = rivalTeams();
  el.innerHTML = html`
    <header class="page-head with-back">
      <a class="back" href="#/" aria-label="Volver">‹</a>
      <h1>Nuevo partido</h1>
    </header>
    <form id="new-match" class="card stack">
      <label class="field">
        <span>Rival</span>
        <input name="opponent" required autocomplete="off" list="rival-list" placeholder="Elige un rival o escribe uno nuevo" />
        <datalist id="rival-list">${rivals.map((r) => html`<option value="${r.name}"></option>`)}</datalist>
      </label>
      ${rivals.length ? html`
        <div class="chips">
          ${rivals.map((r) => html`<button type="button" class="chip-btn" data-rival-name="${r.name}">${r.name}</button>`)}
        </div>` : ''}
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
      <button class="btn btn-primary btn-block btn-lg" type="submit">Continuar a la alineación</button>
    </form>
  `;

  el.querySelectorAll('[data-rival-name]').forEach((b) => b.addEventListener('click', () => {
    el.querySelector('input[name=opponent]').value = b.dataset.rivalName;
    el.querySelectorAll('[data-rival-name]').forEach((x) => x.classList.toggle('selected', x === b));
  }));

  el.querySelector('#new-match').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const roster = fd.getAll('roster');
    if (roster.length < 6) {
      toast('Selecciona al menos 6 jugadores');
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

// ---------- Partido ----------

// Estado de interfaz que no se guarda (selección en curso).
let ui = freshUi();
function freshUi(matchId = null) {
  return {
    matchId, selected: null, rivalTap: null, rivalPlayer: null, phase: null, showBase: false,
    editLineup: false, draft: null,
  };
}
const clearSelection = () =>
  Object.assign(ui, { selected: null, rivalTap: null, rivalPlayer: null, phase: null, showBase: false });

export function renderMatch(el, { id }) {
  const match = matchById(id);
  if (!match) {
    el.innerHTML = html`<p class="center muted">Partido no encontrado. <a href="#/">Volver</a></p>`;
    return;
  }
  if (ui.matchId !== id) ui = freshUi(id);
  const rerender = () => renderMatch(el, { id });
  if (match.status === 'finished') return renderFinished(el, match, rerender);

  const st = setState(match, match.currentSet);
  if (!st.setup || ui.editLineup) return renderLineup(el, match, rerender);
  return renderLive(el, match, st, rerender);
}

// ---------- Alineación al inicio del set ----------

const posOf = (id) => playerById(id)?.position;

function defaultDraft(match) {
  const prev = match.sets?.[match.currentSet] ?? match.sets?.[match.currentSet - 1];
  if (prev) {
    const isNew = !match.sets?.[match.currentSet];
    return {
      system: prev.system,
      slots: [...prev.slots].map((p) => (match.roster.includes(p) ? p : '')),
      rotation: prev.rotation,
      libero: prev.libero ?? '',
      liberoFor: prev.liberoSlots.map((s) => prev.slots[s]),
      // En cada set se alterna el saque inicial.
      serveFirst: isNew ? (prev.serveFirst === 'us' ? 'them' : 'us') : prev.serveFirst,
    };
  }
  const draft = { system: '5-1', slots: [], rotation: 1, libero: '', liberoFor: [], serveFirst: 'us' };
  fillRoles(draft, match);
  draft.libero = rosterPlayers(match).find((p) => p.position === 'libero')?.id ?? '';
  return draft;
}

const rosterPlayers = (match) =>
  match.roster.map(playerById).filter(Boolean).sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));

// Rellena los roles vacíos con jugadores de la posición adecuada.
function fillRoles(draft, match) {
  const roles = SYSTEMS[draft.system].roles;
  const used = new Set(draft.slots.filter(Boolean));
  draft.slots = roles.map((role, i) => {
    if (draft.slots[i]) return draft.slots[i];
    const p = rosterPlayers(match).find((x) => x.position === role.pos && !used.has(x.id));
    if (p) used.add(p.id);
    return p?.id ?? '';
  });
  if (draft.system === 'manual' && draft.liberoFor.length === 0) {
    draft.liberoFor = draft.slots.filter((id) => posOf(id) === 'central');
  }
}

function draftSetup(d) {
  const manual = d.system === 'manual';
  const liberoSlots = manual
    ? d.slots.map((id, i) => (d.liberoFor.includes(id) ? i : -1)).filter((i) => i >= 0)
    : undefined;
  const refSlot = manual ? Math.max(0, d.slots.findIndex((id) => posOf(id) === 'colocador')) : 0;
  return buildSetup({ ...d, libero: d.libero || null, liberoSlots, refSlot });
}

function renderLineup(el, match, rerender) {
  if (!ui.draft) ui.draft = defaultDraft(match);
  const d = ui.draft;
  const sys = SYSTEMS[d.system];
  const players = rosterPlayers(match);
  const complete = d.slots.length === 6 && d.slots.every(Boolean);
  const dupes = new Set(d.slots.filter((id, i) => id && d.slots.indexOf(id) !== i));
  const liberoClash = d.libero && d.slots.includes(d.libero);
  const valid = complete && dupes.size === 0 && !liberoClash;
  const previewSt = valid ? { setup: draftSetup(d), rotations: 0, serving: d.serveFirst, slots: d.slots } : null;
  const preview = previewSt ? courtLayout(previewSt) : null;
  const rivalCount = rivalPlayers(match.opponent).length;
  const hasEvents = match.events.some((e) => e.set === match.currentSet);

  const option = (p, current) =>
    html`<option value="${p.id}" ${p.id === current ? 'selected' : ''}>${p.number} · ${p.name} (${positionById(p.position)?.short ?? ''})</option>`;

  el.innerHTML = html`
    <header class="page-head with-back">
      <a class="back" href="#/" aria-label="Volver">‹</a>
      <h1>Set ${match.currentSet} · Alineación</h1>
    </header>

    <section class="card stack">
      <fieldset class="field">
        <span>Sistema de juego</span>
        <div class="chips">
          ${Object.entries(SYSTEMS).map(([key, s]) => html`
            <label class="chip"><input type="radio" name="system" value="${key}" ${key === d.system ? 'checked' : ''} /><span>${s.label}</span></label>
          `)}
        </div>
      </fieldset>

      <div class="role-grid">
        ${sys.roles.map((role, i) => html`
          <label class="field">
            <span>${role.label}</span>
            <select data-slot="${i}" class="${dupes.has(d.slots[i]) ? 'invalid' : ''}">
              <option value="">— Elegir —</option>
              ${players.map((p) => option(p, d.slots[i]))}
            </select>
          </label>
        `)}
        <label class="field">
          <span>Líbero</span>
          <select id="libero" class="${liberoClash ? 'invalid' : ''}">
            <option value="">Sin líbero</option>
            ${players.map((p) => option(p, d.libero))}
          </select>
        </label>
      </div>

      ${d.system === 'manual' && d.libero ? html`
        <fieldset class="field">
          <span>El líbero sustituye a (en zaguero)</span>
          <div class="chips">
            ${d.slots.filter(Boolean).map((id) => html`
              <label class="chip"><input type="checkbox" name="liberoFor" value="${id}" ${d.liberoFor.includes(id) ? 'checked' : ''} /><span>${playerById(id)?.number} ${playerById(id)?.name}</span></label>
            `)}
          </div>
        </fieldset>` : ''}

      ${d.system !== 'manual' ? html`
        <fieldset class="field">
          <span>Rotación de salida (zona del ${d.system === '5-1' ? 'colocador' : 'colocador 1'})</span>
          <div class="chips">
            ${[1, 2, 3, 4, 5, 6].map((r) => html`
              <label class="chip"><input type="radio" name="rotation" value="${r}" ${r === Number(d.rotation) ? 'checked' : ''} /><span>R${r}</span></label>
            `)}
          </div>
        </fieldset>` : ''}

      <fieldset class="field">
        <span>Saca primero</span>
        <div class="chips">
          <label class="chip"><input type="radio" name="serveFirst" value="us" ${d.serveFirst === 'us' ? 'checked' : ''} /><span>${getData().team.name}</span></label>
          <label class="chip"><input type="radio" name="serveFirst" value="them" ${d.serveFirst === 'them' ? 'checked' : ''} /><span>${match.opponent}</span></label>
        </div>
      </fieldset>
    </section>

    ${preview
      ? html`<section class="card">
          <h2>Así empieza el set <span class="muted small">(rotación principal)</span></h2>
          ${courtHtml({
            cells: formation(previewSt, 'serve', 'base'),
            serving: d.serveFirst,
            server: d.serveFirst === 'us' ? preview[0].playerId : null,
            opponent: match.opponent,
            rivalLabel: d.serveFirst === 'them' ? 'saca' : '',
          })}
        </section>`
      : html`<p class="muted center small">${dupes.size || liberoClash ? 'Hay jugadores repetidos.' : 'Completa los seis puestos para ver el campo.'}</p>`}

    <button class="btn btn-block" id="rival-roster">
      Plantilla de ${match.opponent} (opcional)${rivalCount ? ` · ${rivalCount} jugadores` : ''}
    </button>
    <button class="btn btn-primary btn-block btn-lg" id="start" ${valid ? '' : 'disabled'}>
      ${ui.editLineup ? 'Guardar alineación' : `Empezar set ${match.currentSet}`}
    </button>
    ${ui.editLineup ? html`<button class="btn btn-block" id="cancel-lineup">Cancelar</button>` : ''}
    ${hasEvents ? html`<p class="muted small center">El set ya tiene acciones: la alineación nueva se aplica desde el principio del set.</p>` : ''}
  `;

  el.querySelectorAll('input[name=system]').forEach((r) => r.addEventListener('change', () => {
    if (r.value === 'manual' && preview) {
      // Se conserva la colocación actual: en manual cada slot es una zona (1..6).
      d.slots = preview.map((c) => (c.libero ? d.slots[c.slot] : c.playerId));
    } else {
      d.slots = [];
    }
    d.system = r.value;
    d.liberoFor = [];
    fillRoles(d, match);
    rerender();
  }));
  el.querySelectorAll('[data-slot]').forEach((s) => s.addEventListener('change', () => {
    d.slots[Number(s.dataset.slot)] = s.value;
    rerender();
  }));
  el.querySelector('#libero').addEventListener('change', (e) => { d.libero = e.target.value; rerender(); });
  el.querySelectorAll('input[name=liberoFor]').forEach((c) => c.addEventListener('change', () => {
    d.liberoFor = [...el.querySelectorAll('input[name=liberoFor]:checked')].map((x) => x.value);
    rerender();
  }));
  el.querySelectorAll('input[name=rotation]').forEach((r) => r.addEventListener('change', () => { d.rotation = Number(r.value); rerender(); }));
  el.querySelectorAll('input[name=serveFirst]').forEach((r) => r.addEventListener('change', () => { d.serveFirst = r.value; rerender(); }));
  el.querySelector('#start').addEventListener('click', () => {
    setLineup(match.id, match.currentSet, draftSetup(d));
    ui.editLineup = false;
    ui.draft = null;
    clearSelection();
    rerender();
  });
  el.querySelector('#rival-roster').addEventListener('click', () => openRivalEditor(match.opponent, rerender, { fixedName: true }));
  el.querySelector('#cancel-lineup')?.addEventListener('click', () => {
    ui.editLineup = false;
    ui.draft = null;
    rerender();
  });
}

// ---------- Campo ----------

// Nuestro campo visto desde el banquillo: la red arriba, delanteros (4-3-2) junto a ella.
// Campo rival visto desde nuestro lado: su zona 1 queda arriba a la izquierda y su zona 4 junto a la red a la derecha.
const OUR_ORDER = [4, 3, 2, 5, 6, 1];
const RIVAL_ORDER = [1, 6, 5, 2, 3, 4];

function courtHtml({
  cells, serving, server = null, opponent, selectable = false, selected = null,
  rivalSelectable = false, rivalLabel = '', rivalZone = null,
}) {
  return html`
    <div class="court ${selectable ? 'is-selecting' : ''}">
      <div class="half rival ${rivalSelectable ? 'is-selecting' : ''}">
        <span class="half-label">${opponent}${rivalLabel ? ` · ${rivalLabel}` : ''}</span>
        ${RIVAL_ORDER.map((z) => html`
          <button class="zone rival-zone ${rivalZone === z ? 'selected' : ''}" data-rival-zone="${z}" ${rivalSelectable ? '' : 'disabled'} aria-label="Zona ${z} rival">
            <span class="zone-num">${z}</span>
          </button>
        `)}
      </div>
      <div class="net" aria-hidden="true"></div>
      <div class="half ours">
        ${OUR_ORDER.map((z) => html`<span class="zone-bg" aria-hidden="true">${z}</span>`)}
        <span class="attack-line" aria-hidden="true"></span>
        ${cells.map((c) => {
          const p = playerById(c.playerId);
          const isServer = serving === 'us' && c.playerId === server;
          return html`
            <button class="token ${c.libero ? 'libero' : ''} ${selected === c.playerId ? 'selected' : ''}"
              style="left:${c.x}%;top:${c.y}%" data-player="${c.playerId}" ${selectable ? '' : 'disabled'}
              aria-label="${p?.number ?? ''} ${p?.name ?? ''}, zona ${c.spot}">
              ${isServer ? html`<span class="serve-ball" title="Saca">🏐</span>` : ''}
              <span class="pz-number">${p?.number ?? '?'}</span>
              <span class="pz-name">${p?.name ?? ''}</span>
            </button>
          `;
        })}
      </div>
    </div>
  `;
}

// ---------- Partido en directo ----------

function renderLive(el, match, st, rerender) {
  const teamName = getData().team.name;
  const winner = setWinner(match, match.currentSet);
  const { sets, won, lost } = setsSummary(match);
  const phase = ui.phase ?? currentPhase(st);
  const naturalKind = formationKind(st, phase);
  const kind = ui.showBase ? 'base' : naturalKind;
  const cells = formation(st, phase, kind);
  const played = formation(st, phase); // posiciones de juego (para saber quién está delante)
  const rot = rotationOf(st);
  const server = st.serving === 'us' ? courtLayout(st)[0].playerId : null;

  if (phase === 'serve') ui.selected = server;
  else if (phase === 'set' && !ui.selected) ui.selected = suggestedSetter(st, posOf);

  const sel = ui.selected ? playerById(ui.selected) : null;
  const selFront = isFront(played.find((c) => c.playerId === ui.selected)?.spot);
  const selectable = phase !== 'serve';
  // Campo rival: destino de saque/ataque/FREE, o zona desde la que ataca el rival en defensa.
  const rivalSelectable = true;
  const rivals = rivalPlayers(match.opponent);
  const showRivals = rivals.length > 0 && (phase === 'reception' || phase === 'defense');
  const recent = match.events.filter((e) => e.set === match.currentSet).slice(-6).reverse();

  el.innerHTML = html`
    <header class="page-head with-back live-head">
      <a class="back" href="#/" aria-label="Volver">‹</a>
      <h1>vs ${match.opponent}</h1>
      <button class="btn btn-ghost" id="menu" aria-label="Opciones">⋯</button>
    </header>

    <section class="scoreboard">
      <div class="sb-team">
        <span class="sb-name">${st.serving === 'us' ? '🏐 ' : ''}${teamName}</span>
        <span class="sb-score">${st.us}</span>
      </div>
      <div class="sb-mid">
        <span class="sb-set">Set ${match.currentSet}</span>
        <span class="sb-sets">${won} - ${lost}</span>
        <span class="sb-rot">R${rot}</span>
      </div>
      <div class="sb-team">
        <span class="sb-name">${st.serving === 'them' ? '🏐 ' : ''}${match.opponent}</span>
        <span class="sb-score">${st.them}</span>
      </div>
      ${sets.length ? html`<span class="sb-prev">${sets.map((s) => `${s.us}-${s.them}`).join(' · ')}</span>` : ''}
    </section>

    ${winner ? html`
      <div class="banner ${winner === 'us' ? 'banner-good' : 'banner-bad'}">
        <span>${winner === 'us' ? '¡Set ganado!' : 'Set perdido'} (${st.us}-${st.them})</span>
        <button class="btn btn-primary" id="close-set">Cerrar set</button>
      </div>` : ''}

    <section class="court-wrap">
      ${courtHtml({
        cells, serving: st.serving, server, opponent: match.opponent, selectable, selected: ui.selected,
        rivalSelectable,
        rivalLabel: phase === 'defense' ? '¿desde dónde ataca?'
          : ['serve', 'attack'].includes(phase) ? 'destino' : 'destino de la FREE',
        rivalZone: ui.rivalTap,
      })}
      <div class="court-foot">
        <span class="muted small">${FORMATION_LABEL[kind]}</span>
        ${naturalKind !== 'base' ? html`
          <button class="btn btn-small" id="toggle-base">${ui.showBase ? 'Mostrar posiciones de juego' : 'Mostrar rotación principal'}</button>` : ''}
      </div>
    </section>

    <section class="panel">
      <div class="prompt">
        <span class="phase-tag">${PHASES[phase].label}</span>
        <span class="prompt-text">${promptText(phase, sel)}</span>
      </div>
      ${showRivals ? html`
        <div class="rival-pick">
          <span class="small muted">${phase === 'reception' ? 'Saca' : 'Ataca'}:</span>
          ${rivals.map((p) => html`<button class="chip-btn ${ui.rivalPlayer === p.id ? 'selected' : ''}" data-rival-player="${p.id}">${p.number}${p.name ? html` <small>${p.name}</small>` : ''}</button>`)}
        </div>` : ''}
      ${raw(actionButtons(phase, Boolean(sel), selFront))}
      ${phase !== 'reception' ? html`
        <div class="shortcuts">
          <button class="btn tone-good" data-team="errorRival">＋ Error rival</button>
          <button class="btn tone-error" data-team="puntoRival">− Punto rival</button>
        </div>` : ''}
      <div class="shortcuts">
        <button class="btn" id="undo" ${match.events.length || match.currentSet > 1 ? '' : 'disabled'}>↶ Deshacer</button>
        <button class="btn" id="other" ${sel ? '' : 'disabled'}>Otra acción…</button>
      </div>
    </section>

    <section class="log">
      <h2>Últimas acciones</h2>
      ${recent.length === 0 ? html`<p class="muted small">Sigue las indicaciones: la app propone la siguiente acción.</p>` : ''}
      <ol class="log-list">${recent.map((ev) => logItem(ev, match))}</ol>
    </section>
  `;

  const commit = (skill, result, playerId = ui.selected) => {
    const before = rot;
    const ev = addEvent(match.id, {
      playerId,
      skill,
      result,
      phase,
      zoneTo: phase !== 'defense' && (['saque', 'ataque'].includes(skill) || result === 'free') ? ui.rivalTap : null,
      rivalZone: phase === 'defense' ? ui.rivalTap : null,
      rivalPlayerId: showRivals ? ui.rivalPlayer : null,
    });
    vibrate();
    clearSelection();
    const after = rotationOf(setState(match, match.currentSet));
    const p = playerId ? playerById(playerId) : null;
    toast(after !== before
      ? `Side-out · rotación R${after}`
      : `${p ? `${p.number} ${p.name} · ` : ''}${describeEvent(ev)}`);
    rerender();
  };

  el.querySelectorAll('[data-player]').forEach((b) => b.addEventListener('click', () => {
    ui.selected = ui.selected === b.dataset.player && phase !== 'set' ? null : b.dataset.player;
    rerender();
  }));
  el.querySelectorAll('[data-rival-zone]').forEach((b) => b.addEventListener('click', () => {
    const z = Number(b.dataset.rivalZone);
    ui.rivalTap = ui.rivalTap === z ? null : z;
    rerender();
  }));
  el.querySelectorAll('[data-rival-player]').forEach((b) => b.addEventListener('click', () => {
    ui.rivalPlayer = ui.rivalPlayer === b.dataset.rivalPlayer ? null : b.dataset.rivalPlayer;
    rerender();
  }));
  el.querySelectorAll('[data-skill]').forEach((b) => b.addEventListener('click', () => {
    if (!ui.selected) return toast('Primero toca al jugador en el campo');
    commit(b.dataset.skill, b.dataset.result);
  }));
  el.querySelectorAll('[data-team]').forEach((b) => b.addEventListener('click', () => {
    const def = TEAM_EVENTS[b.dataset.team];
    commit(def.skill, def.result, null);
  }));
  el.querySelector('[data-free]')?.addEventListener('click', () => {
    const def = TEAM_EVENTS.freeBall;
    commit(def.skill, def.result, ui.selected);
  });
  el.querySelector('[data-skip]')?.addEventListener('click', (e) => {
    ui.phase = e.currentTarget.dataset.skip;
    ui.selected = null;
    rerender();
  });
  el.querySelector('#toggle-base')?.addEventListener('click', () => {
    ui.showBase = !ui.showBase;
    rerender();
  });
  el.querySelector('#undo').addEventListener('click', () => {
    const undone = undoLastEvent(match.id);
    clearSelection();
    if (undone?.type === 'event') toast(`Deshecho: ${describeEvent(undone.event)}`);
    else if (undone?.type === 'set') toast(`Set ${match.currentSet} reabierto`);
    rerender();
  });
  el.querySelector('#other').addEventListener('click', () => openActionSheet(sel, (skill, result) => commit(skill, result)));
  el.querySelector('#close-set')?.addEventListener('click', () => {
    const status = closeSet(match.id);
    clearSelection();
    toast(status === 'finished' ? 'Partido finalizado' : `Set ${match.currentSet}: elige la alineación`);
    rerender();
  });
  el.querySelector('#menu').addEventListener('click', () => openMatchMenu(match, st, rerender));
}

const FORMATION_LABEL = {
  base: 'Rotación principal',
  reception: 'Posiciones de recepción',
  play: 'Posiciones de ataque / defensa',
};

function promptText(phase, sel) {
  const who = sel ? `${sel.number} ${sel.name}` : null;
  switch (phase) {
    case 'serve': return `Saca ${who ?? '—'}. Marca el destino en el campo rival (opcional) y el resultado.`;
    case 'reception': return who ? `Recibe ${who}. ¿Cómo ha sido?` : 'Saca el rival: toca al jugador que recibe.';
    case 'set': return who ? `Coloca ${who}. ¿Cómo ha sido?` : 'Toca al jugador que coloca.';
    case 'attack': return who ? `Ataca ${who}. Marca el destino (opcional) y el resultado.` : 'Toca al atacante y, si quieres, la zona de destino.';
    case 'freeRecv': return who ? `Recibe la FREE ${who}. ¿Cómo ha sido?` : 'El rival pasa FREE: toca a quien la recibe.';
    default: return who
      ? `${who}: ¿bloqueo o defensa? Marca también desde dónde ataca el rival (opcional).`
      : 'Ataca el rival: marca desde dónde (opcional) y toca a quien bloquea o defiende.';
  }
}

function resultRow(skillId, enabled, label = null, note = '') {
  const s = skillById(skillId);
  return `
    <div class="result-row">
      ${label ? `<span class="skill-name">${label}${note ? ` <small class="muted">${note}</small>` : ''}</span>` : ''}
      <div class="skill-results">
        ${s.results.map((r) => `<button class="btn tone-${r.tone}" data-skill="${s.id}" data-result="${r.id}" ${enabled ? '' : 'disabled'}>${r.label}</button>`).join('')}
      </div>
    </div>`;
}

function actionButtons(phase, hasSel, selFront) {
  const extra = (key) => `<button class="btn tone-${TEAM_EVENTS[key].point === 'us' ? 'good' : TEAM_EVENTS[key].point ? 'error' : 'neutral'}" data-team="${key}">${TEAM_EVENTS[key].label}</button>`;
  // FREE propia: el jugador seleccionado pasa el balón sin atacar, en cualquier toque.
  const free = `<button class="btn tone-bad" data-free ${hasSel ? '' : 'disabled'}>FREE${hasSel ? '' : ' (toca al jugador)'}</button>`;
  switch (phase) {
    case 'serve':
      return resultRow('saque', hasSel)
        + '<p class="hint">Positivo: el rival recibe mal (sin ataque cómodo) · En juego: el rival recibe bien.</p>';
    case 'reception':
      return resultRow('recepcion', hasSel)
        + `<div class="shortcuts">${free}</div><div class="shortcuts">${extra('errorSaqueRival')}${extra('aceRival')}</div>`;
    case 'set':
      return resultRow('colocacion', hasSel)
        + `<div class="shortcuts">${free}<button class="btn" data-skip="attack">Saltar colocación →</button></div>`;
    case 'attack':
      return resultRow('ataque', hasSel) + `<div class="shortcuts">${free}</div>`;
    case 'freeRecv':
      return resultRow('defensa', hasSel, 'Recepción de la FREE') + `<div class="shortcuts">${free}</div>`;
    default:
      return resultRow('bloqueo', hasSel && selFront, 'Bloqueo', hasSel && !selFront ? '(solo delanteros)' : '')
        + resultRow('defensa', hasSel, 'Defensa')
        + `<div class="shortcuts">${free}${extra('freeRival')}</div>`;
  }
}

function logItem(ev, match) {
  const p = ev.playerId ? playerById(ev.playerId) : null;
  if (ev.skill === 'cambio') {
    const out = playerById(ev.out);
    return html`
      <li class="log-item">
        <span class="dot tone-neutral"></span>
        <span class="grow">Cambio: entra <b>${p?.number}</b> ${p?.name} por <b>${out?.number}</b> ${out?.name}</span>
      </li>`;
  }
  const tone = ev.point === 'us' ? 'good' : ev.point === 'them' ? 'error' : 'neutral';
  const running = scoreAt(match, ev);
  const rival = ev.rivalPlayerId ? rivalPlayerById(match.opponent, ev.rivalPlayerId) : null;
  const where = [
    ev.zone ? `Z${ev.zone}` : '',
    ev.zoneTo ? `→ Z${ev.zoneTo}` : '',
    ev.rivalZone ? `ataque rival Z${ev.rivalZone}` : '',
    rival ? `rival ${rival.number}` : '',
  ].filter(Boolean).join(' · ');
  return html`
    <li class="log-item">
      <span class="dot tone-${tone}"></span>
      <span class="grow">${p ? html`<b>${p.number}</b> ${p.name} · ` : ''}${describeEvent(ev)}${where ? html` <span class="muted small">${where}</span>` : ''}</span>
      <span class="muted small">${ev.point ? `${running.us}-${running.them}` : ''}</span>
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

// Cualquier acción para el jugador seleccionado (para jugadas fuera de la secuencia habitual).
function openActionSheet(player, onPick) {
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
              <button class="btn tone-${r.tone}" data-pick-skill="${s.id}" data-pick-result="${r.id}">${r.label}</button>
            `)}
          </div>
        </div>
      `)}
    </div>
  `.toString());

  sheet.root.querySelectorAll('[data-pick-skill]').forEach((b) =>
    b.addEventListener('click', () => {
      sheet.close();
      onPick(b.dataset.pickSkill, b.dataset.pickResult);
    }),
  );
}

function openMatchMenu(match, st, rerender) {
  const rallyStarted = st.rallyEvents.length > 0;
  const setStarted = match.events.some((e) => e.set === match.currentSet);
  const sheet = openSheet(html`
    <h2>Opciones del partido</h2>
    <div class="stack">
      <button class="btn btn-block" id="m-sub" ${rallyStarted ? 'disabled' : ''}>Cambio de jugador</button>
      <button class="btn btn-block" id="m-lineup">Editar alineación${setStarted ? ' del set' : ''}</button>
      <button class="btn btn-block" id="m-close-set">Cerrar set ${match.currentSet} ahora</button>
      <button class="btn btn-block" id="m-roster">Cambiar convocados</button>
      <button class="btn btn-block" id="m-rivals">Plantilla de ${match.opponent}</button>
      <a class="btn btn-block" href="#/estadisticas?m=${match.id}" data-close>Ver estadísticas</a>
      <button class="btn btn-block btn-danger" id="m-delete">Eliminar partido</button>
      <button class="btn btn-block btn-ghost" data-close>Cancelar</button>
    </div>
  `.toString());

  sheet.root.querySelector('#m-sub').addEventListener('click', () => {
    sheet.close();
    openSubstitution(match, st, rerender);
  });
  sheet.root.querySelector('#m-lineup').addEventListener('click', () => {
    if (setStarted && !confirm('El set ya tiene acciones. Si cambias la alineación, se recalcularán las rotaciones desde el principio del set. ¿Continuar?')) return;
    sheet.close();
    ui.editLineup = true;
    ui.draft = null;
    rerender();
  });
  sheet.root.querySelector('#m-close-set').addEventListener('click', () => {
    const s = setScore(match, match.currentSet);
    if (!confirm(`¿Cerrar el set ${match.currentSet} con ${s.us}-${s.them}?`)) return;
    closeSet(match.id);
    sheet.close();
    clearSelection();
    rerender();
  });
  sheet.root.querySelector('#m-roster').addEventListener('click', () => {
    sheet.close();
    editRoster(match, rerender);
  });
  sheet.root.querySelector('#m-rivals').addEventListener('click', () => {
    sheet.close();
    openRivalEditor(match.opponent, rerender, { fixedName: true });
  });
  sheet.root.querySelector('#m-delete').addEventListener('click', () => {
    if (!confirm('¿Eliminar este partido y todas sus acciones? No se puede deshacer.')) return;
    deleteMatch(match.id);
    sheet.close();
    location.hash = '#/';
  });
}

function openSubstitution(match, st, rerender) {
  let outSlot = null;
  const draw = () => {
    const onCourt = st.slots;
    const bench = rosterPlayers(match).filter((p) => !onCourt.includes(p.id) && p.id !== st.setup.libero);
    const sheet = openSheet(html`
      <div class="sheet-title">
        <h2 class="grow">Cambio de jugador</h2>
        <button class="btn btn-ghost" data-close aria-label="Cerrar">✕</button>
      </div>
      <p class="muted small">${outSlot == null ? '¿Quién sale?' : '¿Quién entra?'}</p>
      <div class="chips">
        ${outSlot == null
          ? onCourt.map((id, slot) => html`<button class="btn" data-out="${slot}"><b>${playerById(id)?.number}</b> ${playerById(id)?.name}</button>`)
          : bench.length
            ? bench.map((p) => html`<button class="btn" data-in="${p.id}"><b>${p.number}</b> ${p.name}</button>`)
            : html`<p class="muted">No hay jugadores en el banquillo.</p>`}
      </div>
    `.toString());
    sheet.root.querySelectorAll('[data-out]').forEach((b) => b.addEventListener('click', () => {
      outSlot = Number(b.dataset.out);
      sheet.close();
      draw();
    }));
    sheet.root.querySelectorAll('[data-in]').forEach((b) => b.addEventListener('click', () => {
      substitute(match.id, outSlot, b.dataset.in, st.slots[outSlot]);
      sheet.close();
      toast('Cambio registrado');
      rerender();
    }));
  };
  draw();
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
    if (roster.length < 6) return toast('Selecciona al menos 6 jugadores');
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
