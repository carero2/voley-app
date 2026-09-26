// Pruebas del analizador de voz: node tests/parser.test.mjs
import { parse } from '../js/voice/parser.js';

const players = [
  { id: 'carlos', number: '23', name: 'Carlos', position: 'receptor' },
  { id: 'simon', number: '10', name: 'Simón', position: 'libero' },
  { id: 'pablo', number: '7', name: 'Pablo', position: 'opuesto' },
  { id: 'dani', number: '9', name: 'Dani', position: 'central' },
  { id: 'ana', number: '1', name: 'Ana', position: 'colocador' },
  { id: 'eva', number: '11', name: 'Eva Martínez', position: 'receptor' },
  { id: 'flor', number: '12', name: 'Flor', position: 'central' },
];
// Rotación de ejemplo: Carlos (punta delantero), Eva (punta zaguero), Dani central delantero, líbero Simón.
const onCourt = [
  { playerId: 'carlos', zone: 4, front: true, role: 'receptor' },
  { playerId: 'dani', zone: 3, front: true, role: 'central' },
  { playerId: 'pablo', zone: 2, front: true, role: 'opuesto' },
  { playerId: 'eva', zone: 6, front: false, role: 'receptor' },
  { playerId: 'simon', zone: 5, front: false, role: 'libero' },
  { playerId: 'ana', zone: 1, front: false, role: 'colocador' },
];
const rivals = [{ id: 'r8', number: '8', name: 'Marta' }];
// Zonas de ataque en posiciones de juego: 4 punta delantero, 3 central, 2 opuesto.
const attackZones = { 4: 'carlos', 3: 'dani', 2: 'pablo', 6: 'eva', 1: 'ana' };
const ctx = (extra = {}) => ({ players, onCourt, rivals, serving: 'them', serverId: null, setterId: 'ana', attackZones, pointTo: 'us', ...extra });

const cases = [
  ['Carlos recibe bien, Carlos ataca por 4, punto', ctx(),
    [{ skill: 'recepcion', playerId: 'carlos', result: 'buena' }, { skill: 'ataque', playerId: 'carlos', zone: 4, result: 'punto' }]],
  ['el punta ataca por cuatro punto', ctx(),
    [{ skill: 'ataque', playerId: 'carlos', zone: 4, result: 'punto' }]],
  ['recibe mal el diez y el opuesto tira fuera', ctx({ pointTo: 'them' }),
    [{ skill: 'recepcion', playerId: 'simon', result: 'mala' }, { skill: 'ataque', playerId: 'pablo', result: 'error' }]],
  ['ataque rival por 4, defensa Simón buena, Carlos punto', ctx({ serving: 'us', serverId: 'ana' }),
    [{ skill: 'ataque', team: 'them', zone: 4 }, { skill: 'defensa', playerId: 'simon', result: 'buena' }, { skill: 'ataque', playerId: 'carlos', result: 'punto' }]],
  ['bloqueo de la central, toque', ctx(),
    [{ skill: 'bloqueo', playerId: 'dani', result: 'toque' }]],
  ['el 23 blockout', ctx(),
    [{ skill: 'ataque', playerId: 'carlos', result: 'blockout' }]],
  ['Eva recibe perfecta. Pablo remata, lo bloquean, bloqueado', ctx({ pointTo: 'them' }),
    [{ skill: 'recepcion', playerId: 'eva', result: 'buena' }, { skill: 'ataque', playerId: 'pablo', result: 'bloqueado' }]],
  ['free del punta zaguero', ctx(),
    [{ skill: 'free', playerId: 'eva' }]],
  ['el rival ataca por la dos y el 8 gana el punto', ctx({ pointTo: 'them', serving: 'us' }),
    [{ skill: 'ataque', team: 'them', zone: 2 }, { skill: 'ataque', team: 'them', rivalPlayerId: 'r8', result: 'punto' }]],
  ['Carlos Carlos ehh bueno', ctx(),
    [{ skill: 'recepcion', playerId: 'carlos', result: 'buena' }]],
  ['saque en juego, ataca el rival, defensa mala', ctx({ serving: 'us', serverId: 'ana', pointTo: 'them' }),
    [{ skill: 'saque', playerId: 'ana', result: 'enjuego' }, { skill: 'ataque', team: 'them' }, { skill: 'defensa', playerId: null, result: 'mala' }]],
  ['Marinez recibe bien', ctx(),
    [{ skill: 'recepcion', playerId: 'eva', result: 'buena' }]],
  // Frases reales dictadas en un partido:
  ['Recibe el punta trasero, coloca a punta delantero y remata dentro', ctx(),
    [{ skill: 'recepcion', playerId: 'eva' }, { skill: 'colocacion', playerId: 'ana' }, { skill: 'ataque', playerId: 'carlos', result: 'punto' }]],
  ['Recibe el punta 11 y remata el opuesto.', ctx({ pointTo: 'them' }),
    [{ skill: 'recepcion', playerId: 'eva' }, { skill: 'ataque', playerId: 'pablo', result: null }]],
  ['Recibe el punta 11 y remata el opuesto.', ctx({ pointTo: 'us' }),
    [{ skill: 'recepcion', playerId: 'eva' }, { skill: 'ataque', playerId: 'pablo', result: 'punto' }]],
  // Variantes de orden y forma:
  ['remata el central por la 3', ctx(),
    [{ skill: 'ataque', playerId: 'dani', zone: 3, result: 'punto' }]],
  ['Carlos el 23 ataca fuera', ctx({ pointTo: 'them' }),
    [{ skill: 'ataque', playerId: 'carlos', result: 'error' }]],
  ['coloca Ana a Pablo, punto', ctx(),
    [{ skill: 'colocacion', playerId: 'ana' }, { skill: 'ataque', playerId: 'pablo', result: 'punto' }]],
  ['recibe Simón bien, remata Carlos, bloqueado', ctx({ pointTo: 'them' }),
    [{ skill: 'recepcion', playerId: 'simon', result: 'buena' }, { skill: 'ataque', playerId: 'carlos', result: 'bloqueado' }]],
  ['defiende el líbero, coloca a la central y ataca por el centro', ctx({ serving: 'us', serverId: 'ana' }),
    [{ skill: 'defensa', playerId: 'simon' }, { skill: 'colocacion', playerId: 'ana' }, { skill: 'ataque', playerId: 'dani', zone: 3, result: 'punto' }]],
  // Frase real: conjugaciones que indican el equipo y líbero fuera de pista al empezar el punto.
  ['Atacan por 3. Defiende el libero, buena. Rematamos por 3 y punto',
    ctx({ serving: 'us', serverId: 'ana', onCourt: onCourt.filter((c) => c.role !== 'libero') }),
    [{ skill: 'ataque', team: 'them', zone: 3 }, { skill: 'defensa', playerId: 'simon', result: 'buena' }, { skill: 'ataque', playerId: 'dani', zone: 3, result: 'punto' }]],
  ['Recibe Carlos, doble positiva. Coloca a 4. Remata punta y blockout', ctx(),
    [{ skill: 'recepcion', playerId: 'carlos', result: 'buena' }, { skill: 'colocacion', playerId: 'ana' }, { skill: 'ataque', playerId: 'carlos', zone: 4, result: 'blockout' }]],
  ['recibe Eva, coloca a 3', ctx(),
    [{ skill: 'recepcion', playerId: 'eva', result: 'buena' }, { skill: 'colocacion', playerId: 'ana', result: 'buena' }, { skill: 'ataque', playerId: 'dani', zone: 3, result: 'punto' }]],
  ['sacan, recibimos bien y atacamos por 4, nos bloquean', ctx({ pointTo: 'them' }),
    [{ skill: 'saque', team: 'them' }, { skill: 'recepcion', result: 'buena' }, { skill: 'ataque', playerId: 'carlos', zone: 4, result: 'bloqueado' }]],
];

let ok = 0;
for (const [text, c, expected] of cases) {
  const { actions, cause } = parse(text, c);
  const pass = expected.length === actions.length && expected.every((e, i) =>
    Object.entries(e).every(([k, v]) => (k === 'team' ? actions[i].team === v : actions[i][k] === v)));
  if (pass) ok++;
  console.log(pass ? '✓' : '✗', text);
  if (!pass) console.log('   obtenido:', JSON.stringify(actions.map(({ skill, team, playerId, rivalPlayerId, zone, result }) => ({ skill, team, playerId, rivalPlayerId, zone, result }))));
  else console.log('   causa:', cause);
}
console.log(`\n${ok}/${cases.length} casos correctos`);
process.exit(ok === cases.length ? 0 : 1);
