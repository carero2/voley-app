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
      { id: 'positivo', label: 'Positivo', tone: 'ok', point: null },
      { id: 'enjuego', label: 'En juego', tone: 'neutral', point: null },
      { id: 'error', label: 'Error', tone: 'error', point: 'them' },
    ],
  },
  {
    id: 'recepcion', label: 'Recepción', results: [
      { id: 'perfecta', label: 'Perfecta', tone: 'good', point: null },
      { id: 'buena', label: 'Buena', tone: 'ok', point: null },
      { id: 'mala', label: 'Mala', tone: 'bad', point: null },
      { id: 'error', label: 'Error', tone: 'error', point: 'them' },
    ],
  },
  {
    id: 'ataque', label: 'Ataque', results: [
      { id: 'punto', label: 'Punto', tone: 'good', point: 'us' },
      { id: 'enjuego', label: 'En juego', tone: 'neutral', point: null },
      { id: 'bloqueado', label: 'Bloqueado', tone: 'bad', point: 'them' },
      { id: 'error', label: 'Error', tone: 'error', point: 'them' },
    ],
  },
  {
    id: 'bloqueo', label: 'Bloqueo', results: [
      { id: 'punto', label: 'Punto', tone: 'good', point: 'us' },
      { id: 'toque', label: 'Toque', tone: 'ok', point: null },
      { id: 'error', label: 'Error', tone: 'error', point: 'them' },
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
  freeBall: { skill: 'equipo', result: 'free', point: null, label: 'Pasa sin ataque' },
};

export const skillById = (id) => SKILLS.find((s) => s.id === id);
export const positionById = (id) => POSITIONS.find((p) => p.id === id);

export function resultDef(skillId, resultId) {
  if (skillId === 'rival' || skillId === 'equipo') {
    return Object.values(TEAM_EVENTS).find((e) => e.skill === skillId && e.result === resultId);
  }
  return skillById(skillId)?.results.find((r) => r.id === resultId);
}

export function describeEvent(ev) {
  if (ev.skill === 'rival' || ev.skill === 'equipo') return resultDef(ev.skill, ev.result)?.label ?? ev.result;
  if (ev.skill === 'cambio') return 'Cambio';
  const skill = skillById(ev.skill);
  const res = resultDef(ev.skill, ev.result);
  return `${skill?.label ?? ev.skill} · ${res?.label ?? ev.result}`;
}
