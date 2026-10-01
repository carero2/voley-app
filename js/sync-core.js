// Lógica de sincronización sin dependencias del navegador (se prueba con node: tests/sync.test.mjs).
//
// Cada partido se guarda en el servidor como un documento con { data (JSON del partido), ver, dev, deleted }.
// En el dispositivo, `match.sync = { ver, hash, updateTime }` recuerda la versión del servidor con la que se
// sincronizó por última vez y el «hash» del partido en ese momento: si el hash actual es otro, hay cambios
// locales sin subir. Nunca se sobrescribe a ciegas: si el partido cambió en los dos sitios, se guarda una
// copia del otro dispositivo y se avisa para elegir.

const LOCAL_ONLY = ['sync', 'conflict', 'conflictOf', 'remote'];

// Copia del partido sin los campos que solo tienen sentido en este dispositivo.
export function matchPayload(match) {
  const out = {};
  for (const [k, v] of Object.entries(match)) if (!LOCAL_ONLY.includes(k)) out[k] = v;
  return out;
}

// JSON con las claves ordenadas: el mismo contenido da siempre el mismo texto.
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

// Hash corto (FNV-1a de 32 bits) para detectar cambios; no es criptográfico ni lo necesita.
export function hashOf(value) {
  const s = typeof value === 'string' ? value : stableStringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const matchHash = (match) => hashOf(matchPayload(match));
export const isDirty = (match) => !match.sync || match.sync.hash !== matchHash(match);

/**
 * Qué hacer con un partido.
 * @param local  partido del dispositivo (o null)
 * @param remote { ver, data, deleted, updateTime } del servidor (o null)
 * @param deletedHere  el partido se borró en este dispositivo
 * @returns 'none' | 'push' | 'pull' | 'delete-local' | 'push-delete' | 'conflict'
 */
export function decide(local, remote, deletedHere = false) {
  if (deletedHere) return remote && !remote.deleted ? 'push-delete' : 'none';
  if (!remote) return local && !local.conflictOf ? 'push' : 'none';
  if (remote.deleted) {
    if (!local) return 'none';
    return isDirty(local) && local.sync?.ver !== remote.ver ? 'push' : 'delete-local';
  }
  if (!local) return 'pull';
  if (local.conflictOf) return 'none'; // copia de otro dispositivo pendiente de elegir
  const dirty = isDirty(local);
  if (local.sync?.ver === remote.ver) return dirty ? 'push' : 'none';
  if (!dirty) return 'pull';
  // Cambió en los dos sitios. Si lo de aquí ya contiene todo lo del servidor (mismas acciones y más), se sube.
  const ids = new Set((local.events || []).map((e) => e.id));
  if ((remote.data?.events || []).every((e) => ids.has(e.id))) return 'push';
  return 'conflict';
}

// Datos del club que se comparten (sin partidos, que van aparte).
export const clubInfo = (club) => ({
  id: club.id, name: club.name, team: club.team, players: club.players, rivals: club.rivals,
});

/** Combina la información del club: si aquí hay cambios sin subir, se juntan jugadores y rivales (lo de aquí
 *  manda en los repetidos); si no, se toma la del servidor tal cual (así llegan también los borrados). */
export function mergeInfo(local, remote, localDirty) {
  if (!remote) return local;
  if (!localDirty) return { ...remote, id: local.id };
  const byId = new Map((remote.players || []).map((p) => [p.id, p]));
  (local.players || []).forEach((p) => byId.set(p.id, p));
  return {
    id: local.id,
    name: local.name,
    team: local.team,
    players: [...byId.values()],
    rivals: { ...(remote.rivals || {}), ...(local.rivals || {}) },
  };
}

// ---------- Documentos de Firestore (API REST) ----------

export function toDoc({ data, ver, dev, deleted = false }) {
  return {
    fields: {
      data: { stringValue: data == null ? '' : JSON.stringify(data) },
      ver: { integerValue: String(ver) },
      dev: { stringValue: dev || '' },
      deleted: { booleanValue: Boolean(deleted) },
    },
  };
}

export function fromDoc(doc) {
  const f = doc.fields || {};
  const raw = f.data?.stringValue;
  return {
    id: doc.name.split('/').pop(),
    ver: Number(f.ver?.integerValue || 0),
    dev: f.dev?.stringValue || '',
    deleted: Boolean(f.deleted?.booleanValue),
    data: raw ? JSON.parse(raw) : null,
    updateTime: doc.updateTime,
  };
}

// Clave del club en el servidor: SHA-256 de la contraseña (la contraseña no viaja ni se guarda en el servidor).
export async function clubKey(password) {
  const bytes = new TextEncoder().encode(`voley-app:${password}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
