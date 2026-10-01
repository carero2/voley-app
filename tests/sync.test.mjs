// Pruebas de la lógica de sincronización (sin navegador): node tests/sync.test.mjs
import { decide, matchHash, matchPayload, mergeInfo, toDoc, fromDoc, clubKey, hashOf } from '../js/sync-core.js';

let ok = 0;
let fail = 0;
function check(name, cond) {
  if (cond) ok++;
  else { fail++; console.log('✗', name); }
}

const ev = (id) => ({ id, set: 1, point: 'us' });
const match = (events, extra = {}) => ({ id: 'm1', opponent: 'Rival', events: events.map(ev), ...extra });
const synced = (m, ver) => ({ ...m, sync: { ver, hash: matchHash(m), updateTime: 't' } });
const remote = (m, ver, extra = {}) => ({ ver, data: matchPayload(m), updateTime: `t${ver}`, ...extra });

// Partido nuevo aquí → subir. Nuevo en el servidor → bajar.
check('nuevo aquí se sube', decide(match(['a']), null) === 'push');
check('nuevo allí se baja', decide(null, remote(match(['a']), 1)) === 'pull');

// Sin cambios en ningún lado.
const base = synced(match(['a']), 1);
check('sin cambios', decide(base, remote(match(['a']), 1)) === 'none');
// Cambio solo aquí → subir.
const mine = { ...base, events: [...base.events, ev('b')] };
check('cambio aquí se sube', decide(mine, remote(match(['a']), 1)) === 'push');
// Cambio solo allí → bajar.
check('cambio allí se baja', decide(base, remote(match(['a', 'c']), 2)) === 'pull');
// Cambio en los dos, pero lo de aquí contiene todo lo de allí → subir.
const superset = { ...base, events: [ev('a'), ev('c'), ev('d')] };
check('aquí contiene lo de allí: se sube', decide(superset, remote(match(['a', 'c']), 2)) === 'push');
// Cambio en los dos con acciones distintas → conflicto (nunca se sobrescribe).
check('cambios distintos: conflicto', decide(mine, remote(match(['a', 'c']), 2)) === 'conflict');
// Deshacer aquí (se quita una acción) y sin cambios allí → subir (no vuelve la acción deshecha).
const synced2 = synced(match(['a', 'b']), 3);
const undone = { ...synced2, events: [ev('a')] };
check('deshacer aquí se sube', decide(undone, remote(match(['a', 'b']), 3)) === 'push');

// Borrados.
check('borrado aquí se borra allí', decide(null, remote(match(['a']), 1), true) === 'push-delete');
check('borrado allí se borra aquí', decide(base, remote(match([]), 2, { deleted: true, data: null })) === 'delete-local');
check('borrado allí pero cambiado aquí: se conserva', decide(mine, remote(match([]), 2, { deleted: true, data: null })) === 'push');

// Los campos locales no cuentan como cambios.
check('hash sin campos locales', matchHash({ ...match(['a']), conflict: true, sync: { ver: 9 } }) === matchHash(match(['a'])));
check('hash estable con claves en otro orden', hashOf({ a: 1, b: [1, { c: 2, d: 3 }] }) === hashOf({ b: [1, { d: 3, c: 2 }], a: 1 }));

// Datos del club: sin cambios aquí manda el servidor; con cambios se juntan.
const local = { id: 'x', name: 'Mi club', team: { name: 'Juvenil' }, players: [{ id: 'p1', name: 'Ana' }], rivals: { r1: { name: 'R1' } } };
const rem = { name: 'Club', team: { name: 'Juvenil F' }, players: [{ id: 'p2', name: 'Bea' }], rivals: { r2: { name: 'R2' } } };
const taken = mergeInfo(local, rem, false);
check('sin cambios aquí: el del servidor', taken.name === 'Club' && taken.players.length === 1 && taken.players[0].id === 'p2' && taken.id === 'x');
const joined = mergeInfo(local, rem, true);
check('con cambios: se juntan jugadores', joined.players.map((p) => p.id).sort().join() === 'p1,p2' && joined.name === 'Mi club');
check('con cambios: se juntan rivales', Object.keys(joined.rivals).sort().join() === 'r1,r2');

// Documento de Firestore ida y vuelta.
const doc = toDoc({ data: match(['a']), ver: 4, dev: 'abc' });
const back = fromDoc({ ...doc, name: 'projects/p/databases/(default)/documents/c/k/partidos/m1', updateTime: 'T' });
check('documento ida y vuelta', back.id === 'm1' && back.ver === 4 && back.dev === 'abc' && back.data.events.length === 1 && back.updateTime === 'T');
const tomb = fromDoc({ ...toDoc({ data: null, ver: 5, deleted: true }), name: 'x/partidos/m2' });
check('lápida', tomb.deleted && tomb.data === null);

// Clave del club: 64 hexadecimales, distinta para cada contraseña.
const k1 = await clubKey('secreto1');
const k2 = await clubKey('secreto2');
check('clave de 64 hex', /^[0-9a-f]{64}$/.test(k1) && k1 !== k2 && k1 === await clubKey('secreto1'));

console.log(`${ok}/${ok + fail} casos correctos`);
if (fail) process.exit(1);
