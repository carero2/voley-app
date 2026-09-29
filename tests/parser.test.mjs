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
  // Frase real: defensa tras toque de bloqueo, calidad dicha aparte y «colocación a X y fuera».
  ['Defienden y atacan por 4. El bloqueo toca la pelota y recibe el libero. Buena recepción. Colocación a opuesto y fuera.',
    ctx({ serving: 'us', serverId: 'ana', pointTo: 'them' }),
    [{ skill: 'ataque', team: 'them', zone: 4 }, { skill: 'bloqueo', result: 'toque' }, { skill: 'defensa', playerId: 'simon', result: 'buena' },
      { skill: 'colocacion', playerId: 'ana', result: 'buena' }, { skill: 'ataque', playerId: 'pablo', result: 'error' }]],
  // FREE:
  ['nos pasan free, recibe el libero y ataca el punta por 4, punto', ctx({ serving: 'us', serverId: 'ana' }),
    [{ skill: 'free', team: 'them' }, { skill: 'defensa', playerId: 'simon', result: 'buena' }, { skill: 'ataque', playerId: 'carlos', zone: 4, result: 'punto' }]],
  ['recibe mal Eva y pasamos free, atacan por 2', ctx({ pointTo: 'them' }),
    [{ skill: 'recepcion', playerId: 'eva', result: 'mala' }, { skill: 'free', team: 'us' }, { skill: 'ataque', team: 'them', zone: 2 }]],
  ['bola fácil de ellos, el central ataca y punto', ctx({ serving: 'us', serverId: 'ana' }),
    [{ skill: 'free', team: 'them' }, { skill: 'ataque', playerId: 'dani', result: 'punto' }]],
  ['fri del opuesto', ctx({ pointTo: 'them' }),
    [{ skill: 'free', playerId: 'pablo' }]],
  ['coloca Ana mal y Carlos ataca fuera', ctx({ pointTo: 'them' }),
    [{ skill: 'colocacion', playerId: 'ana', result: 'mala' }, { skill: 'ataque', playerId: 'carlos', result: 'error' }]],
  // Frase real: «y block» con punto rival = nos bloquean el ataque.
  ['Recepción de Carlos, muy buena. Colocación rápida a 3 y block.', ctx({ pointTo: 'them' }),
    [{ skill: 'recepcion', playerId: 'carlos', result: 'buena' }, { skill: 'colocacion', playerId: 'ana', result: 'buena' },
      { skill: 'ataque', playerId: 'dani', zone: 3, result: 'bloqueado' }]],
  ['el opuesto ataca por 2 y block', ctx({ pointTo: 'them' }),
    [{ skill: 'ataque', playerId: 'pablo', zone: 2, result: 'bloqueado' }]],
  // Ligado al botón:
  ['atacan por 4 y block de la central', ctx({ serving: 'us', serverId: 'ana', pointTo: 'us' }),
    [{ skill: 'ataque', team: 'them', zone: 4 }, { skill: 'bloqueo', playerId: 'dani', result: 'punto' }]],
  ['saque en juego y atacan por 2', ctx({ serving: 'us', serverId: 'ana', pointTo: 'them' }),
    [{ skill: 'saque', playerId: 'ana', result: 'enjuego' }, { skill: 'ataque', team: 'them', zone: 2, result: 'punto' }]],
  ['saque en juego y atacan por 2', ctx({ serving: 'us', serverId: 'ana', pointTo: 'us' }),
    [{ skill: 'saque', playerId: 'ana', result: 'enjuego' }, { skill: 'ataque', team: 'them', zone: 2, result: 'error' }]],
  ['recibe Eva', ctx({ pointTo: 'them' }),
    [{ skill: 'recepcion', playerId: 'eva', result: 'error' }]],
  ['atacan por 4, defiende Simón', ctx({ serving: 'us', serverId: 'ana', pointTo: 'them' }),
    [{ skill: 'ataque', team: 'them', zone: 4 }, { skill: 'defensa', playerId: 'simon', result: 'error' }]],
  // Frase real: «Coloca Simón a 2» + «Remata» sin sujeto → ataca quien ataca por la 2 según la rotación.
  ['Recibe Eva. Coloca Ana a 2. Remata y ellos defienden y atacan por 4. Defiende libero. Colocación a punta y punto.', ctx(),
    [{ skill: 'recepcion', playerId: 'eva', result: 'buena' }, { skill: 'colocacion', playerId: 'ana', result: 'buena' },
      { skill: 'ataque', playerId: 'pablo', zone: 2, result: 'enjuego' }, { skill: 'ataque', team: 'them', zone: 4 },
      { skill: 'defensa', playerId: 'simon', result: 'buena' }, { skill: 'colocacion', playerId: 'ana', result: 'buena' },
      { skill: 'ataque', playerId: 'carlos', result: 'punto' }]],
  ['coloca Ana al 7 y remata', ctx(),
    [{ skill: 'colocacion', playerId: 'ana' }, { skill: 'ataque', playerId: 'pablo', result: 'punto' }]],
];

// Frases reales dictadas con Groq (plantilla con nombres reales).
const team = [
  { id: 'mert', number: '3', name: 'Mertinho', position: 'colocador' },
  { id: 'joan', number: '4', name: 'Joan', position: 'receptor' },
  { id: 'simon', number: '10', name: 'Simon', position: 'receptor' },
  { id: 'nacho', number: '11', name: 'Nacho', position: 'libero' },
  { id: 'robert', number: '26', name: 'Robert', position: 'central' },
  { id: 'andrii', number: '8', name: 'Andrii', position: 'opuesto' },
  { id: 'pau', number: '5', name: 'Pau', position: 'central' },
];
// 5-1 en R1: colocador en Z1, Joan (punta) en Z2, Robert en Z3, Andrii (opuesto) en Z4, Simon en Z5, Nacho (líbero) en Z6.
const r1Court = [
  { playerId: 'mert', zone: 1, front: false, role: 'colocador' },
  { playerId: 'joan', zone: 2, front: true, role: 'receptor' },
  { playerId: 'robert', zone: 3, front: true, role: 'central' },
  { playerId: 'andrii', zone: 4, front: true, role: 'opuesto' },
  { playerId: 'simon', zone: 5, front: false, role: 'receptor' },
  { playerId: 'nacho', zone: 6, front: false, role: 'libero' },
];
const r1 = (extra) => ({
  players: team, onCourt: r1Court, rivals: [], serverId: null, setterId: 'mert', pointTo: 'us', ...extra,
});
// Recibiendo en R1: Joan recibe en Z1 y ataca por Z2; Andrii ataca por Z4.
const r1Receiving = r1({
  serving: 'them',
  attackZones: { 4: 'andrii', 3: 'robert', 2: 'joan', 6: 'simon' },
  zones: {
    reception: { joan: 1, simon: 5, nacho: 6, mert: 1, robert: 3, andrii: 4 },
    play: { andrii: 4, robert: 3, joan: 2, simon: 6, nacho: 5, mert: 1 },
  },
});
const r1Serving = r1({
  serving: 'us', serverId: 'mert',
  attackZones: { 4: 'joan', 3: 'robert', 2: 'andrii', 6: 'simon' },
});
cases.push(
  ['Saca a Mert, consiguen defender y colocan a 4, remata, defiende Simon, coloca a Mert a opuesto, defienden, coloca a centro, defiende Nacho, coloca a centro y Robert hace punto. Gracias.',
    r1Serving,
    [{ skill: 'saque', playerId: 'mert', result: 'enjuego' }, { skill: 'ataque', team: 'them', zone: 4 },
      { skill: 'defensa', playerId: 'simon', result: 'buena' }, { skill: 'colocacion', playerId: 'mert', result: 'buena' },
      { skill: 'ataque', playerId: 'andrii', result: 'enjuego' }, { skill: 'ataque', team: 'them', zone: 3 },
      { skill: 'defensa', playerId: 'nacho', result: 'buena' }, { skill: 'colocacion', playerId: 'mert', result: 'buena' },
      { skill: 'ataque', playerId: 'robert', zone: 3, result: 'punto' }]],
  ['Defiende Joan, coloca Mert a Joan, ataca, defienden y atacan por opuesto, defiende Nacho, coloca a punta y punto.',
    r1Receiving,
    [{ skill: 'recepcion', playerId: 'joan', zone: 1, result: 'buena' }, { skill: 'colocacion', playerId: 'mert', result: 'buena' },
      { skill: 'ataque', playerId: 'joan', zone: 2, result: 'enjuego' }, { skill: 'ataque', team: 'them', zone: 2 },
      { skill: 'defensa', playerId: 'nacho', result: 'buena' }, { skill: 'colocacion', playerId: 'mert', result: 'buena' },
      { skill: 'ataque', playerId: 'joan', zone: 2, result: 'punto' }]],
);

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
