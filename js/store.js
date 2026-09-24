// Estado de la aplicación y persistencia.
// Por ahora todo vive en localStorage. Para añadir más adelante una API
// (p. ej. un Cloudflare Worker), basta con implementar `pushToRemote`/`pullFromRemote`
// usando `exportData()` / `importData()`; el resto de la app no cambia.

import { resultDef } from './actions.js';
import { setState, rotationOf, tacticalZone, currentPhase } from './rally.js';

const STORAGE_KEY = 'voley-app:v1';
const SCHEMA_VERSION = 2;

// Estructura: { version, activeClubId, clubs: [club] }.
// Cada club es independiente: { id, name, demo?, team, players, matches, rivals }.
// `data` apunta siempre al club activo, así el resto de la app no necesita saber de clubes.
let root;
let data;
const listeners = new Set();

const emptyClub = (name = 'Mi club', teamName = 'Mi equipo') => ({
  id: uid(),
  name,
  team: { name: teamName },
  players: [],
  matches: [],
  rivals: {},
});

// Club de ejemplo que aparece la primera vez (o si se borran todos los clubes).
function demoClub() {
  const club = emptyClub('Club de prueba', 'Equipo de prueba');
  club.demo = true;
  const roster = [
    ['1', 'Colocador Demo', 'colocador'],
    ['2', 'Opuesto Demo', 'opuesto'],
    ['3', 'Receptor Demo A', 'receptor'],
    ['4', 'Receptor Demo B', 'receptor'],
    ['5', 'Central Demo A', 'central'],
    ['6', 'Central Demo B', 'central'],
    ['7', 'Líbero Demo', 'libero'],
    ['8', 'Receptor Demo C', 'receptor'],
  ];
  club.players = roster.map(([number, name, position]) => ({ id: uid(), active: true, number, name, position }));
  club.rivals = {
    'rival de prueba': {
      name: 'Rival de prueba',
      players: ['10', '11', '12', '13', '14', '15'].map((n) => ({ id: uid(), number: n, name: `Rival Demo ${n}` })),
    },
  };
  return club;
}

function normalizeClub(c) {
  return {
    id: c.id || uid(),
    name: c.name || 'Mi club',
    ...(c.demo ? { demo: true } : {}),
    team: { name: 'Mi equipo', ...(c.team || {}) },
    players: Array.isArray(c.players) ? c.players : [],
    matches: Array.isArray(c.matches) ? c.matches : [],
    rivals: c.rivals && typeof c.rivals === 'object' ? c.rivals : {},
  };
}

function normalizeRoot(d) {
  let clubs;
  if (Array.isArray(d?.clubs)) {
    clubs = d.clubs.map(normalizeClub);
  } else if (d && (d.players?.length || d.matches?.length)) {
    // Datos de la versión anterior (sin clubes): pasan a un club propio.
    clubs = [normalizeClub({ ...d, name: 'Mi club' })];
  } else {
    clubs = [];
  }
  if (clubs.length === 0) clubs.push(demoClub());
  const activeClubId = clubs.some((c) => c.id === d?.activeClubId) ? d.activeClubId : clubs[0].id;
  return { version: SCHEMA_VERSION, activeClubId, clubs };
}

function activeFrom(r) {
  return r.clubs.find((c) => c.id === r.activeClubId);
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeRoot(raw ? JSON.parse(raw) : null);
  } catch (err) {
    console.error('No se pudieron leer los datos guardados', err);
    return normalizeRoot(null);
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(root));
  } catch (err) {
    console.error('No se pudieron guardar los datos', err);
    alert('No se han podido guardar los datos en este dispositivo. Exporta una copia de seguridad.');
  }
  listeners.forEach((fn) => fn(data));
}

// ---------- Clubes ----------

export const clubs = () => root.clubs;
export const activeClub = () => data;

export function switchClub(id) {
  if (!root.clubs.some((c) => c.id === id)) return;
  root.activeClubId = id;
  data = activeFrom(root);
  persist();
}

export function createClub({ name, teamName }) {
  const club = emptyClub(name.trim() || 'Nuevo club', teamName.trim() || name.trim() || 'Mi equipo');
  root.clubs.push(club);
  switchClub(club.id);
  return club;
}

export function updateClub(id, { name, teamName }) {
  const club = root.clubs.find((c) => c.id === id);
  if (name != null) club.name = name.trim() || club.name;
  if (teamName != null) club.team.name = teamName.trim() || club.team.name;
  persist();
}

export function deleteClub(id) {
  root.clubs = root.clubs.filter((c) => c.id !== id);
  if (root.clubs.length === 0) root.clubs.push(demoClub());
  if (!root.clubs.some((c) => c.id === root.activeClubId)) root.activeClubId = root.clubs[0].id;
  data = activeFrom(root);
  persist();
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

root = load();
data = activeFrom(root);

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

// ---------- Plantillas rivales (se guardan por nombre de equipo y se reutilizan) ----------

const rivalKey = (name) => name.trim().toLowerCase();

export const rivalPlayers = (name) =>
  [...(data.rivals[rivalKey(name)]?.players ?? [])].sort(byNumber);

export const rivalPlayerById = (name, id) => rivalPlayers(name).find((p) => p.id === id);

export const rivalTeams = () =>
  Object.values(data.rivals).sort((a, b) => a.name.localeCompare(b.name));

export function ensureRivalTeam(name) {
  if (name.trim() && !data.rivals[rivalKey(name)]) {
    data.rivals[rivalKey(name)] = { name: name.trim(), players: [] };
  }
}

// Renombra un equipo rival (y los partidos contra él) o lo crea si no existía.
export function saveRivalTeam(oldName, newName) {
  const team = data.rivals[rivalKey(oldName)] ?? { players: [] };
  delete data.rivals[rivalKey(oldName)];
  data.rivals[rivalKey(newName)] = { ...team, name: newName.trim() };
  if (oldName && rivalKey(oldName) !== rivalKey(newName)) {
    data.matches.forEach((m) => { if (rivalKey(m.opponent) === rivalKey(oldName)) m.opponent = newName.trim(); });
  }
  persist();
}

export function deleteRivalTeam(name) {
  delete data.rivals[rivalKey(name)];
  persist();
}

export function saveRivalPlayers(name, players) {
  data.rivals[rivalKey(name)] = {
    name: name.trim(),
    players: players.map((p) => ({ id: p.id || uid(), number: String(p.number).trim(), name: p.name.trim() })),
  };
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
    sets: {},
    events: [],
  };
  data.matches.push(match);
  ensureRivalTeam(match.opponent);
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

// Registra una acción con su contexto (punto del set, rotación, quién sacaba y zonas).
export function addEvent(matchId, {
  playerId = null, skill, result, zoneTo = null, rivalZone = null, rivalPlayerId = null, phase,
}) {
  const match = matchById(matchId);
  const def = resultDef(skill, result);
  const st = setState(match, match.currentSet);
  const ev = {
    id: uid(),
    t: Date.now(),
    set: match.currentSet,
    rally: st.rally,
    serving: st.serving,
    rot: rotationOf(st),
    playerId,
    zone: st.setup && playerId ? tacticalZone(st, playerId, phase) : null,
    zoneTo,
    rivalZone,
    rivalPlayerId,
    phase: phase ?? (st.setup ? currentPhase(st) : null),
    skill,
    result,
    point: def?.point ?? null,
  };
  match.events.push(ev);
  persist();
  return ev;
}

export function setLineup(matchId, setNum, setup) {
  const match = matchById(matchId);
  match.sets = { ...(match.sets || {}), [setNum]: setup };
  recomputeContext(match, setNum);
  persist();
}

// Recalcula rotación, zona, saque y número de punto de las acciones de un set
// (necesario si se corrige la alineación con el set ya empezado).
function recomputeContext(match, setNum) {
  match.events.forEach((ev, i) => {
    if (ev.set !== setNum || ev.skill === 'cambio') return;
    const st = setState({ ...match, events: match.events.slice(0, i) }, setNum);
    Object.assign(ev, {
      rally: st.rally,
      serving: st.serving,
      rot: rotationOf(st),
      zone: ev.playerId ? tacticalZone(st, ev.playerId) : null,
    });
  });
}

// Cambio de jugador: `slot` es la posición en la rotación que pasa a ocupar `playerId`.
export function substitute(matchId, slot, playerId, outId) {
  const match = matchById(matchId);
  match.events.push({ id: uid(), t: Date.now(), set: match.currentSet, skill: 'cambio', slot, playerId, out: outId, point: null });
  persist();
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

export const exportData = () => JSON.parse(JSON.stringify(root));

// mode 'merge': añade/actualiza por id. mode 'replace': sustituye todo.
// Acepta copias con clubes y copias antiguas de un solo equipo (que se cargan en el club activo).
export function importData(incoming, mode = 'merge') {
  const legacy = incoming && Array.isArray(incoming.players) && Array.isArray(incoming.matches);
  if (!incoming || (!Array.isArray(incoming.clubs) && !legacy)) {
    throw new Error('El archivo no tiene el formato esperado.');
  }
  const mergeById = (current, extra) => {
    const map = new Map(current.map((x) => [x.id, x]));
    extra.forEach((x) => map.set(x.id, x));
    return [...map.values()];
  };
  const mergeClub = (target, src) => {
    target.players = mergeById(target.players, src.players);
    target.matches = mergeById(target.matches, src.matches);
    target.rivals = { ...target.rivals, ...src.rivals };
  };

  if (legacy) {
    const src = normalizeClub(incoming);
    if (mode === 'replace') Object.assign(data, { team: src.team, players: src.players, matches: src.matches, rivals: src.rivals });
    else mergeClub(data, src);
    delete data.demo;
  } else if (mode === 'replace') {
    root = normalizeRoot(incoming);
    data = activeFrom(root);
  } else {
    for (const c of incoming.clubs.map(normalizeClub)) {
      const target = root.clubs.find((x) => x.id === c.id);
      if (target) mergeClub(target, c);
      else root.clubs.push(c);
    }
  }
  persist();
}

// Borra todo (todos los clubes) y vuelve a empezar con el club de prueba.
export function resetAll() {
  root = normalizeRoot(null);
  data = activeFrom(root);
  persist();
}
