// Estado de la aplicación y persistencia.
// Por ahora todo vive en localStorage. Para añadir más adelante una API
// (p. ej. un Cloudflare Worker), basta con implementar `pushToRemote`/`pullFromRemote`
// usando `exportData()` / `importData()`; el resto de la app no cambia.

import { resultDef } from './actions.js';

const STORAGE_KEY = 'voley-app:v1';
const SCHEMA_VERSION = 1;

const emptyData = () => ({
  version: SCHEMA_VERSION,
  team: { name: 'Mi equipo' },
  players: [],
  matches: [],
});

let data = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    return normalize(JSON.parse(raw));
  } catch (err) {
    console.error('No se pudieron leer los datos guardados', err);
    return emptyData();
  }
}

function normalize(d) {
  const base = emptyData();
  return {
    version: SCHEMA_VERSION,
    team: { ...base.team, ...(d.team || {}) },
    players: Array.isArray(d.players) ? d.players : [],
    matches: Array.isArray(d.matches) ? d.matches : [],
  };
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('No se pudieron guardar los datos', err);
    alert('No se han podido guardar los datos en este dispositivo. Exporta una copia de seguridad.');
  }
  listeners.forEach((fn) => fn(data));
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const getData = () => data;
export const subscribe = (fn) => listeners.add(fn);

// ---------- Equipo y jugadores ----------

export function setTeamName(name) {
  data.team.name = name.trim() || 'Mi equipo';
  persist();
}

export const activePlayers = () =>
  data.players.filter((p) => p.active !== false).sort(byNumber);

export const playerById = (id) => data.players.find((p) => p.id === id);

function byNumber(a, b) {
  return (Number(a.number) || 0) - (Number(b.number) || 0);
}

export function savePlayer({ id, number, name, position }) {
  const clean = { number: String(number).trim(), name: name.trim(), position };
  if (id) {
    Object.assign(playerById(id), clean);
  } else {
    data.players.push({ id: uid(), active: true, ...clean });
  }
  persist();
}

// Si el jugador ya tiene acciones registradas se archiva (para no perder estadísticas).
export function removePlayer(id) {
  const used = data.matches.some((m) => m.events.some((e) => e.playerId === id));
  if (used) {
    playerById(id).active = false;
  } else {
    data.players = data.players.filter((p) => p.id !== id);
  }
  persist();
}

// ---------- Partidos ----------

export const matchById = (id) => data.matches.find((m) => m.id === id);

export const sortedMatches = () =>
  [...data.matches].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);

export function createMatch({ opponent, date, place, bestOf, roster }) {
  const match = {
    id: uid(),
    createdAt: Date.now(),
    opponent: opponent.trim() || 'Rival',
    date,
    place: place.trim(),
    bestOf: Number(bestOf) || 5,
    roster,
    currentSet: 1,
    status: 'live',
    events: [],
  };
  data.matches.push(match);
  persist();
  return match;
}

export function updateMatch(id, fields) {
  Object.assign(matchById(id), fields);
  persist();
}

export function deleteMatch(id) {
  data.matches = data.matches.filter((m) => m.id !== id);
  persist();
}

export function addEvent(matchId, { playerId = null, skill, result }) {
  const match = matchById(matchId);
  const def = resultDef(skill, result);
  const ev = {
    id: uid(),
    t: Date.now(),
    set: match.currentSet,
    playerId,
    skill,
    result,
    point: def?.point ?? null,
  };
  match.events.push(ev);
  persist();
  return ev;
}

export function undoLastEvent(matchId) {
  const match = matchById(matchId);
  const last = match.events.at(-1);
  if (last && last.set === match.currentSet) {
    match.events.pop();
    persist();
    return { type: 'event', event: last };
  }
  // Set actual vacío: deshacer significa reabrir el set anterior.
  if (match.currentSet > 1) {
    match.currentSet -= 1;
    persist();
    return { type: 'set' };
  }
  return null;
}

export function setScore(match, set) {
  let us = 0;
  let them = 0;
  for (const e of match.events) {
    if (e.set !== set) continue;
    if (e.point === 'us') us++;
    else if (e.point === 'them') them++;
  }
  return { us, them };
}

export const isTiebreak = (match, set) => set === match.bestOf;
export const setTarget = (match, set) => (isTiebreak(match, set) ? 15 : 25);

// Devuelve 'us' | 'them' si el set se puede dar por ganado, o null.
export function setWinner(match, set) {
  const { us, them } = setScore(match, set);
  const target = setTarget(match, set);
  if (us >= target && us - them >= 2) return 'us';
  if (them >= target && them - us >= 2) return 'them';
  return null;
}

// Resultado de los sets ya cerrados (y del actual si el partido terminó).
export function setsSummary(match) {
  const last = match.status === 'finished' ? match.currentSet : match.currentSet - 1;
  const sets = [];
  for (let s = 1; s <= last; s++) sets.push({ set: s, ...setScore(match, s) });
  const won = sets.filter((s) => s.us > s.them).length;
  const lost = sets.filter((s) => s.them > s.us).length;
  return { sets, won, lost };
}

export function closeSet(matchId) {
  const match = matchById(matchId);
  const { won, lost } = setsSummary({ ...match, status: 'finished' });
  const needed = Math.ceil(match.bestOf / 2);
  if (won >= needed || lost >= needed || match.currentSet >= match.bestOf) {
    match.status = 'finished';
  } else {
    match.currentSet += 1;
  }
  persist();
  return match.status;
}

export function reopenMatch(matchId) {
  matchById(matchId).status = 'live';
  persist();
}

// ---------- Importar / exportar ----------

export const exportData = () => JSON.parse(JSON.stringify(data));

// mode 'merge': añade/actualiza por id. mode 'replace': sustituye todo.
export function importData(incoming, mode = 'merge') {
  if (!incoming || !Array.isArray(incoming.players) || !Array.isArray(incoming.matches)) {
    throw new Error('El archivo no tiene el formato esperado.');
  }
  const src = normalize(incoming);
  if (mode === 'replace') {
    data = src;
  } else {
    const mergeById = (current, extra) => {
      const map = new Map(current.map((x) => [x.id, x]));
      extra.forEach((x) => map.set(x.id, x));
      return [...map.values()];
    };
    data.players = mergeById(data.players, src.players);
    data.matches = mergeById(data.matches, src.matches);
    if (data.team.name === 'Mi equipo') data.team = src.team;
  }
  persist();
}

export function resetAll() {
  data = emptyData();
  persist();
}
