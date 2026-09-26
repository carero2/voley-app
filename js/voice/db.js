// Audios de cada punto guardados en el propio dispositivo (IndexedDB).
// Un punto de ~10 s en Opus a 24 kbps ocupa unos 30–45 KB: un partido son unos pocos MB.

const DB_NAME = 'voley-audio';
const STORE = 'audio';
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const audioId = (matchId, key) => `${matchId}|${key}`;
export const putAudio = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
export const getAudio = (id) => tx('readonly', (s) => s.get(id));
export const deleteAudio = (id) => tx('readwrite', (s) => s.delete(id));

// Espacio usado aproximado (para mostrarlo en la pantalla de datos).
export async function audioUsage() {
  const db = await open();
  return new Promise((resolve) => {
    let bytes = 0;
    let count = 0;
    const req = db.transaction(STORE).objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve({ bytes, count });
      bytes += cur.value?.size ?? 0;
      count++;
      cur.continue();
    };
    req.onerror = () => resolve({ bytes, count });
  });
}
