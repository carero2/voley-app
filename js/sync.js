// Sincronización de un club con un servidor compartido (Firebase: Firestore + acceso anónimo), por su API web.
//
// - Cada club tiene su propia configuración (proyecto, clave web y contraseña del club), guardada solo en este
//   dispositivo y fuera de las copias de seguridad. Otro club no la usa.
// - La contraseña no se envía: de ella sale la «clave del club» (SHA-256), que es la carpeta del servidor. Quien
//   tiene la contraseña ve y registra los datos del club; nadie puede listar los clubes.
// - Se sincroniza al abrir la app, al cerrar cada set, al recuperar la conexión y a mano.
// - Nunca se sobrescribe: si un partido cambió en dos dispositivos, se guarda una copia y se avisa.

import { clubs, clubById, saveAll, createClub, deleteClub, activeClub, setAuthor } from './store.js';
import {
  decide, matchPayload, matchHash, mergeInfo, hashOf, toDoc, fromDoc, clubKey,
} from './sync-core.js';

const CONFIG_KEY = 'voley-app:sync';
const AUTH_KEY = 'voley-app:sync-auth';
const DEVICE_KEY = 'voley-app:device';
const MAX_DOC_BYTES = 900_000; // Firestore admite 1 MiB por documento

// ---------- Configuración por club (solo en este dispositivo) ----------

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
}

export const syncConfig = (clubId) => readJson(CONFIG_KEY)[clubId] || null;

// role: 'admin' (quien conecta el club con el formulario: gestiona la contraseña) o 'member' (entró por enlace).
export async function saveSyncConfig(clubId, { projectId, apiKey, password, role, userName }) {
  const all = readJson(CONFIG_KEY);
  const key = await clubKey(password);
  const prev = all[clubId] || {};
  all[clubId] = {
    ...prev, projectId: projectId.trim(), apiKey: apiKey.trim(), password, key, role: role || prev.role || 'admin',
    userName: (userName ?? prev.userName ?? '').trim(),
  };
  writeJson(CONFIG_KEY, all);
  return all[clubId];
}

// Nombre de quien usa este dispositivo en ese club (se guarda en cada partido y punto que registra).
export const userName = (clubId) => syncConfig(clubId)?.userName || '';
export function setUserName(clubId, name) {
  patchConfig(clubId, { userName: name.trim() });
}
setAuthor(() => userName(activeClub().id) || null);

// Quiénes han registrado en el club (por los partidos y puntos guardados).
export function contributors(club) {
  const count = new Map();
  for (const m of club.matches) {
    if (m.by) count.set(m.by, (count.get(m.by) || 0));
    for (const e of m.events) if (e.by && e.point) count.set(e.by, (count.get(e.by) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([name, points]) => ({ name, points }));
}

export const isAdmin = (clubId) => (syncConfig(clubId)?.role ?? 'admin') === 'admin';

// Un miembro no puede borrar partidos que ya están en el servidor (se borrarían para todo el equipo).
export function deleteBlocked(clubId, match) {
  if (!match?.sync || !syncConfig(clubId) || isAdmin(clubId)) return null;
  return 'Este partido está compartido con el equipo: solo quien administra el servidor del club puede borrarlo.';
}

function patchConfig(clubId, patch) {
  const all = readJson(CONFIG_KEY);
  if (!all[clubId]) return;
  all[clubId] = { ...all[clubId], ...patch };
  writeJson(CONFIG_KEY, all);
}

export function removeSyncConfig(clubId) {
  const all = readJson(CONFIG_KEY);
  delete all[clubId];
  writeJson(CONFIG_KEY, all);
}

export function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem(DEVICE_KEY, id); } catch { /* sin almacenamiento */ }
  }
  return id;
}

// Enlace para que otros se unan al club con un toque (lleva la contraseña: compártelo solo con el equipo).
export function inviteLink(clubId) {
  const cfg = syncConfig(clubId);
  const club = clubById(clubId);
  if (!cfg) return null;
  const q = new URLSearchParams({ p: cfg.projectId, k: cfg.apiKey, c: cfg.password, n: club?.name || '' });
  return `${location.origin}${location.pathname}#/unirse?${q}`;
}

// ---------- Estado (para la barra del club y los avisos) ----------

const running = new Map(); // clubId → promesa en curso

export function syncStatus(clubId) {
  const cfg = syncConfig(clubId);
  if (!cfg) return { state: 'off' };
  if (running.has(clubId)) return { state: 'running', at: cfg.lastSync };
  if (cfg.lastError) return { state: 'error', at: cfg.lastSync, error: cfg.lastError };
  const club = clubById(clubId);
  const pending = club ? pendingCount(club) : 0;
  return { state: pending ? 'pending' : 'ok', at: cfg.lastSync, pending };
}

function pendingCount(club) {
  const changed = club.matches.filter((m) => !m.sync || m.sync.hash !== matchHash(m)).length;
  return changed + (club.deletedMatches?.length || 0);
}

// Versiones de otro dispositivo pendientes de elegir. Van aparte de `matches` para no contar en estadísticas.
export const conflictsOf = (club) => club.syncCopies || [];

// ---------- Acceso (anónimo, invisible para el usuario) ----------

async function authToken(cfg) {
  const all = readJson(AUTH_KEY);
  const a = all[cfg.apiKey];
  if (a?.idToken && a.exp > Date.now() + 60_000) return a.idToken;
  let res;
  if (a?.refreshToken) {
    res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(a.refreshToken)}`,
    });
    if (res.ok) {
      const j = await res.json();
      all[cfg.apiKey] = { idToken: j.id_token, refreshToken: j.refresh_token, exp: Date.now() + Number(j.expires_in) * 1000 };
      writeJson(AUTH_KEY, all);
      return j.id_token;
    }
  }
  res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(cfg.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!res.ok) throw await syncError(res, 'auth');
  const j = await res.json();
  all[cfg.apiKey] = { idToken: j.idToken, refreshToken: j.refreshToken, exp: Date.now() + Number(j.expiresIn) * 1000 };
  writeJson(AUTH_KEY, all);
  return j.idToken;
}

class SyncError extends Error {
  constructor(message, { retry = false, precondition = false } = {}) {
    super(message);
    this.retry = retry;
    this.precondition = precondition;
  }
}

async function syncError(res, where) {
  let detail = '';
  try { detail = (await res.json())?.error?.message || ''; } catch { /* sin cuerpo */ }
  if (where === 'auth') {
    if (/OPERATION_NOT_ALLOWED|ADMIN_ONLY/i.test(detail)) return new SyncError('En Firebase falta activar el acceso «Anónimo» (Authentication → Método de acceso).');
    if (/API key|API_KEY/i.test(detail) || res.status === 400) return new SyncError('La clave web (apiKey) no es válida. Revísala en la configuración del club.');
  }
  if (res.status === 409 || /FAILED_PRECONDITION|ALREADY_EXISTS|ABORTED/i.test(detail)) {
    return new SyncError('Otro dispositivo estaba guardando a la vez.', { precondition: true });
  }
  if (res.status === 403) return new SyncError('El servidor no deja acceder: revisa las reglas de Firestore (ver instrucciones).');
  if (res.status === 404) return new SyncError('No se encuentra el proyecto o la base de datos de Firestore. Revisa el ID del proyecto.');
  if (res.status >= 500 || res.status === 429) return new SyncError('El servidor no responde ahora; se reintentará.', { retry: true });
  return new SyncError(`Error del servidor (${res.status})${detail ? `: ${detail}` : ''}`);
}

const base = (cfg) => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/(default)/documents/c/${cfg.key}`;

async function call(cfg, method, path, { body, query } = {}) {
  const token = await authToken(cfg);
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  const res = await fetch(`${base(cfg)}/${path}${qs}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === 'GET' && res.status === 404) return null;
  if (!res.ok) throw await syncError(res);
  return res.json();
}

async function listMatches(cfg) {
  const out = new Map();
  let pageToken;
  do {
    const j = await call(cfg, 'GET', 'partidos', { query: { pageSize: '300', ...(pageToken ? { pageToken } : {}) } });
    for (const d of j?.documents || []) {
      const r = fromDoc(d);
      out.set(r.id, r);
    }
    pageToken = j?.nextPageToken;
  } while (pageToken);
  return out;
}

async function putDoc(cfg, path, doc, remote) {
  const text = JSON.stringify(doc.data ?? '');
  if (text.length > MAX_DOC_BYTES) throw new SyncError('Un partido es demasiado grande para el servidor (más de 1 MB).');
  const query = remote ? { 'currentDocument.updateTime': remote.updateTime } : { 'currentDocument.exists': 'false' };
  const res = await call(cfg, 'PATCH', path, { body: toDoc({ ...doc, dev: deviceId(), by: cfg.userName }), query });
  return res.updateTime;
}

// ---------- Sincronizar un club ----------

const infoOf = (club) => ({ name: club.name, team: club.team, players: club.players, rivals: club.rivals });

async function syncInfo(cfg, club, summary) {
  const raw = await call(cfg, 'GET', 'club/info');
  const remote = raw ? fromDoc(raw) : null;
  if (!remote && club.syncJoin) {
    throw new SyncError('No hay ningún club con esa contraseña en este servidor. Revisa la contraseña o el enlace.');
  }
  if (remote?.data?.closed) {
    throw new SyncError('La contraseña del club ha cambiado. Pide el nuevo enlace de invitación a quien administra el club.');
  }
  const local = infoOf(club);
  const dirty = !club.syncInfo || club.syncInfo.hash !== hashOf(local);
  let next = local;
  if (remote && club.syncInfo?.ver !== remote.ver) {
    // Alguien cambió el club (jugadores, rivales, nombre): se combina con lo de aquí.
    next = mergeInfo(local, remote.data || {}, dirty);
    Object.assign(club, { name: next.name ?? club.name, team: next.team ?? club.team, players: next.players ?? [], rivals: next.rivals ?? {} });
    next = infoOf(club);
    if (hashOf(next) !== hashOf(local)) summary.pulled++;
    delete club.syncJoin;
  }
  const same = remote && hashOf(next) === hashOf(remote.data || {});
  if (same) {
    club.syncInfo = { ver: remote.ver, hash: hashOf(next), updateTime: remote.updateTime };
  } else if (!remote || dirty || club.syncInfo?.ver !== remote.ver) {
    const ver = (remote?.ver || 0) + 1;
    const updateTime = await putDoc(cfg, 'club/info', { data: next, ver }, remote);
    club.syncInfo = { ver, hash: hashOf(next), updateTime };
    summary.pushed++;
  }
}

async function syncMatches(cfg, club, summary) {
  const remote = await listMatches(cfg);
  const deleted = new Set(club.deletedMatches || []);
  const ids = new Set([...remote.keys(), ...club.matches.map((m) => m.id), ...deleted]);
  for (const id of ids) {
    const local = club.matches.find((m) => m.id === id) || null;
    const r = remote.get(id) || null;
    const action = decide(local, r, deleted.has(id) && !local);
    try {
      if (action === 'push') {
        const ver = (r?.ver || 0) + 1;
        const updateTime = await putDoc(cfg, `partidos/${id}`, { data: matchPayload(local), ver }, r);
        local.sync = { ver, hash: matchHash(local), updateTime };
        delete local.conflict;
        summary.pushed++;
      } else if (action === 'pull') {
        const m = { ...r.data, id };
        m.sync = { ver: r.ver, hash: matchHash(m), updateTime: r.updateTime };
        if (local) club.matches[club.matches.indexOf(local)] = m;
        else club.matches.push(m);
        summary.pulled++;
      } else if (action === 'delete-local') {
        club.matches = club.matches.filter((m) => m !== local);
        club.syncCopies = conflictsOf(club).filter((m) => m.conflictOf !== id);
        summary.deleted++;
      } else if (action === 'push-delete') {
        await putDoc(cfg, `partidos/${id}`, { data: null, ver: r.ver + 1, deleted: true }, r);
        summary.pushed++;
      } else if (action === 'conflict') {
        const copy = { ...r.data, id, conflictOf: id, remote: { ver: r.ver, updateTime: r.updateTime, dev: r.dev, by: r.by } };
        club.syncCopies = [...conflictsOf(club).filter((m) => m.conflictOf !== id), copy];
        local.conflict = true;
        summary.conflicts++;
      }
      if (deleted.has(id) && (action === 'push-delete' || action === 'none' || !r || r.deleted)) deleted.delete(id);
    } catch (err) {
      if (err.precondition) summary.retry = true; // otro dispositivo guardó a la vez: en la siguiente vuelta
      else throw err;
    }
  }
  if (deleted.size) club.deletedMatches = [...deleted];
  else delete club.deletedMatches;
  // Conflictos que ya no lo son (p. ej. el otro dispositivo eligió versión): fuera.
  const still = conflictsOf(club).filter((c) => club.matches.some((m) => m.id === c.conflictOf && m.conflict));
  if (still.length) club.syncCopies = still;
  else delete club.syncCopies;
}

const queued = new Map(); // clubId → segunda vuelta pedida mientras otra estaba en marcha

export function syncClub(clubId) {
  // Si ya hay una en marcha, se hace otra justo después (para incluir lo último que se ha registrado).
  if (running.has(clubId)) {
    if (!queued.has(clubId)) {
      queued.set(clubId, running.get(clubId).then(() => {
        queued.delete(clubId);
        return syncClub(clubId);
      }));
    }
    return queued.get(clubId);
  }
  const job = (async () => {
    const cfg = syncConfig(clubId);
    const club = clubById(clubId);
    if (!cfg || !club) return null;
    const summary = { clubId, pushed: 0, pulled: 0, deleted: 0, conflicts: 0, retry: false, error: null };
    try {
      if (!cfg.key) Object.assign(cfg, await saveSyncConfig(clubId, cfg));
      await syncInfo(cfg, club, summary);
      await syncMatches(cfg, club, summary);
      patchConfig(clubId, { lastSync: Date.now(), lastError: null });
    } catch (err) {
      const offline = err instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
      summary.error = offline ? 'Sin conexión: se subirá cuando vuelva la conexión.' : err.message;
      patchConfig(clubId, { lastError: summary.error });
    } finally {
      saveAll();
      running.delete(clubId);
    }
    window.dispatchEvent(new CustomEvent('voley-sync', { detail: summary }));
    return summary;
  })();
  running.set(clubId, job);
  window.dispatchEvent(new CustomEvent('voley-sync', { detail: { clubId, started: true } }));
  return job;
}

// Sincroniza todos los clubes conectados, agrupando peticiones seguidas.
let timer = null;
export function requestSync(delay = 800) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    for (const c of clubs()) {
      if (!syncConfig(c.id)) continue;
      const s = await syncClub(c.id);
      if (s?.retry) setTimeout(() => syncClub(c.id), 3000);
    }
  }, delay);
}

// ---------- Conflictos: dos versiones del mismo partido ----------

// keep: 'local' (la de este dispositivo) o 'remote' (la del otro).
export function resolveConflict(clubId, matchId, keep) {
  const club = clubById(clubId);
  const original = club.matches.find((m) => m.id === matchId);
  const copy = conflictsOf(club).find((m) => m.conflictOf === matchId);
  if (!original || !copy) return;
  if (keep === 'local') {
    // Se sube la de aquí por encima de la del servidor.
    original.sync = { ...(original.sync || {}), ver: copy.remote.ver, updateTime: copy.remote.updateTime, hash: '' };
    delete original.conflict;
  } else {
    const chosen = { ...matchPayload(copy), id: matchId };
    chosen.sync = { ver: copy.remote.ver, updateTime: copy.remote.updateTime, hash: matchHash(chosen) };
    club.matches[club.matches.indexOf(original)] = chosen;
  }
  club.syncCopies = conflictsOf(club).filter((m) => m !== copy);
  if (!club.syncCopies.length) delete club.syncCopies;
  saveAll();
  requestSync(0);
}

// ---------- Unirse con un enlace de invitación ----------

export async function joinClub({ projectId, apiKey, password, name, userName: who }) {
  const key = await clubKey(password);
  // ¿Ya está este club en el dispositivo?
  const all = readJson(CONFIG_KEY);
  const existing = Object.entries(all).find(([id, c]) => c.key === key && c.projectId === projectId && clubById(id));
  if (existing) {
    if (who) setUserName(existing[0], who);
    return { club: clubById(existing[0]), existed: true };
  }
  const club = createClub({ name: name || 'Club compartido', teamName: '' });
  // Club nuevo y vacío: lo del servidor manda (nombre, equipo, jugadores, rivales).
  club.syncInfo = { ver: -1, hash: hashOf(infoOf(club)) };
  club.syncJoin = true;
  await saveSyncConfig(club.id, { projectId, apiKey, password, role: 'member', userName: who });
  saveAll();
  const summary = await syncClub(club.id);
  if (summary?.error) {
    // No se pudo: se quita el club recién creado para no dejar uno vacío.
    removeSyncConfig(club.id);
    deleteClub(club.id);
    return { error: summary.error };
  }
  return { club, summary };
}

// ---------- Cambiar la contraseña (solo administración) ----------
// Se lleva el club a la carpeta de la contraseña nueva y se cierra la antigua: los que tengan la antigua reciben
// el aviso de pedir el enlace nuevo, y sus datos dejan de estar en la carpeta antigua.
export async function changePassword(clubId, newPassword) {
  const cfg = syncConfig(clubId);
  const club = clubById(clubId);
  if (!cfg || !club || !isAdmin(clubId)) return { error: 'Solo quien administra el club puede cambiar la contraseña.' };
  const first = await syncClub(clubId); // primero, todo lo último de todos
  if (first?.error) return { error: first.error };
  if (conflictsOf(club).length) return { error: 'Antes, resuelve los partidos con dos versiones.' };
  try {
    const info = fromDoc(await call(cfg, 'GET', 'club/info'));
    await putDoc(cfg, 'club/info', { data: { ...info.data, closed: true }, ver: info.ver + 1 }, info);
    const old = await listMatches(cfg);
    for (const r of old.values()) {
      if (!r.deleted) await putDoc(cfg, `partidos/${r.id}`, { data: null, ver: r.ver + 1, deleted: true }, r);
    }
  } catch (err) {
    return { error: err.message };
  }
  await saveSyncConfig(clubId, { ...cfg, password: newPassword, role: 'admin' });
  delete club.syncInfo;
  delete club.deletedMatches;
  club.matches.forEach((m) => { delete m.sync; });
  saveAll();
  const s = await syncClub(clubId);
  return s?.error ? { error: s.error } : { ok: true };
}
