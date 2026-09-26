// Catálogo de posiciones, fundamentos (skills) y resultados posibles.
// `point`: a quién da el punto la acción ('us' = nuestro equipo, 'them' = rival, null = sigue la jugada).
// `tone`: cómo se colorea el botón (good / ok / bad / error).

export const POSITIONS = [
  { id: 'colocador', label: 'Colocador', short: 'C' },
  { id: 'opuesto', label: 'Opuesto', short: 'O' },
  { id: 'receptor', label: 'Receptor', short: 'R' },
  { id: 'central', label: 'Central', short: 'CE' },
  { id: 'libero', label: 'Líbero', short: 'L' },
];

export const SKILLS = [
  {
    id: 'saque', label: 'Saque', results: [
      { id: 'ace', label: 'Ace', tone: 'good', point: 'us' },
      { id: 'enjuego', label: 'En juego', tone: 'neutral', point: null },
      { id: 'error', label: 'Error', tone: 'error', point: 'them' },
      // Valor antiguo: ya no se ofrece, pero se conserva para leer datos registrados antes.
      { id: 'positivo', label: 'Positivo', tone: 'ok', point: null, legacy: true },
    ],
  },
  {
    id: 'recepcion', label: 'Recepción', results: [
      { id: 'buena', label: 'Buena', tone: 'good', point: null },
      { id: 'mala', label: 'Mala', tone: 'bad', point: null },
      { id: 'error', label: 'Error', tone: 'error', point: 'them' },
      // Valor antiguo (antes había «Perfecta» y «Buena»): cuenta como recepción buena.
      { id: 'perfecta', label: 'Perfecta', tone: 'good', point: null, legacy: true },
    ],
  },
  {
    id: 'ataque', label: 'Ataque', results: [
      { id: 'punto', label: 'Punto', tone: 'good', point: 'us' },
      { id: 'blockout', label: 'Blockout', tone: 'good', point: 'us' },
      { id: 'enjuego', label: 'En juego', tone: 'neutral', point: null },
      { id: 'bloqueado', label: 'Bloqueado', tone: 'bad', point: 'them' },
      // Bloqueado pero el apoyo recupera el balón: el punto sigue.
      { id: 'recuperado', label: 'Bloq. + apoyo', tone: 'ok', point: null },
      { id: 'error', label: 'Error', tone: 'error', point: 'them' },
    ],
  },
  {
    // Se mantienen los ids ('punto', 'error') para no romper datos ya guardados.
    id: 'bloqueo', label: 'Bloqueo', results: [
      { id: 'punto', label: 'Block', tone: 'good', point: 'us' },
      { id: 'toque', label: 'Toque', tone: 'ok', point: null },
      { id: 'error', label: 'Blockout', tone: 'error', point: 'them' },
    ],
  },
  {
    id: 'defensa', label: 'Defensa', results: [
      { id: 'buena', label: 'Buena', tone: 'good', point: null },
      { id: 'mala', label: 'Mala', tone: 'bad', point: null },
      { id: 'error', label: 'Error', tone: 'error', point: 'them' },
    ],
  },
  {
    id: 'colocacion', label: 'Colocación', results: [
      { id: 'buena', label: 'Buena', tone: 'good', point: null },
      { id: 'mala', label: 'Mala', tone: 'bad', point: null },
      { id: 'error', label: 'Error', tone: 'error', point: 'them' },
    ],
  },
];

// Acciones sin jugador asociado.
export const TEAM_EVENTS = {
  errorRival: { skill: 'rival', result: 'error', point: 'us', label: 'Error rival' },
  puntoRival: { skill: 'rival', result: 'punto', point: 'them', label: 'Punto rival' },
  errorSaqueRival: { skill: 'rival', result: 'saque_error', point: 'us', label: 'Error de saque rival' },
  aceRival: { skill: 'rival', result: 'ace', point: 'them', label: 'Ace rival' },
  // FREE propia: la envía un jugador en cualquier toque (recepción, defensa, colocación o ataque).
  freeBall: { skill: 'equipo', result: 'free', point: null, label: 'FREE' },
  freeRival: { skill: 'rival', result: 'free', point: null, label: 'FREE rival' },
  // Ataque del rival dictado por voz (solo informativo; el punto lo lleva el cierre).
  rivalAttack: { skill: 'rival', result: 'ataque', point: null, label: 'Ataque rival' },
  // Modo voz: cierre del punto con un botón; el detalle llega después desde el audio.
  rallyUs: { skill: 'cierre', result: 'us', point: 'us', label: 'Punto propio' },
  rallyThem: { skill: 'cierre', result: 'them', point: 'them', label: 'Punto rival' },
};

const TEAM_SKILLS = ['rival', 'equipo', 'cierre'];

// Toque en el que se produce una acción (según la fase del punto).
export const TOUCH_LABEL = {
  reception: 'Recepción',
  defense: 'Defensa',
  freeRecv: 'Recepción de FREE',
  cover: 'Apoyo',
  set: 'Colocación',
  attack: 'Ataque',
};

// Resultados que se ofrecen al registrar (sin los antiguos).
export const activeResults = (skill) => skill.results.filter((r) => !r.legacy);

export const skillById = (id) => SKILLS.find((s) => s.id === id);
export const positionById = (id) => POSITIONS.find((p) => p.id === id);

export function resultDef(skillId, resultId) {
  if (TEAM_SKILLS.includes(skillId)) {
    return Object.values(TEAM_EVENTS).find((e) => e.skill === skillId && e.result === resultId);
  }
  return skillById(skillId)?.results.find((r) => r.id === resultId);
}

export function describeEvent(ev) {
  if (TEAM_SKILLS.includes(ev.skill)) return resultDef(ev.skill, ev.result)?.label ?? ev.result;
  if (ev.skill === 'cambio') return 'Cambio';
  const skill = skillById(ev.skill);
  const res = resultDef(ev.skill, ev.result);
  return `${skill?.label ?? ev.skill} · ${res?.label ?? ev.result}`;
}
