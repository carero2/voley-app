// Cálculo de estadísticas a partir de los eventos registrados.

import { SKILLS } from './actions.js';

const emptyCounts = () =>
  Object.fromEntries(SKILLS.map((s) => [s.id, Object.fromEntries([...s.results.map((r) => [r.id, 0]), ['total', 0]])]));

// Eventos filtrados por partidos (array de ids o null = todos) y set (número o null).
export function filterEvents(matches, { matchIds = null, set = null } = {}) {
  const out = [];
  for (const m of matches) {
    if (matchIds && !matchIds.includes(m.id)) continue;
    for (const e of m.events) {
      if (set && e.set !== set) continue;
      out.push({ ...e, matchId: m.id });
    }
  }
  return out;
}

export function countsBy(events, keyFn) {
  const groups = new Map();
  for (const e of events) {
    if (!e.playerId || e.skill === 'rival') continue;
    const key = keyFn(e);
    if (key == null) continue;
    if (!groups.has(key)) groups.set(key, { counts: emptyCounts(), matches: new Set() });
    const g = groups.get(key);
    const c = g.counts[e.skill];
    if (!c) continue;
    c[e.result] = (c[e.result] || 0) + 1;
    c.total += 1;
    g.matches.add(e.matchId);
  }
  return groups;
}

const ratio = (n, d) => (d ? n / d : null);

export function metrics(counts) {
  const { saque, recepcion, ataque, bloqueo, defensa, colocacion } = counts;
  const points = saque.ace + ataque.punto + bloqueo.punto;
  const given =
    saque.error + recepcion.error + ataque.error + ataque.bloqueado +
    bloqueo.error + defensa.error + colocacion.error;
  return {
    points,
    given,
    balance: points - given,
    actions: SKILLS.reduce((acc, s) => acc + counts[s.id].total, 0),
    saque: {
      total: saque.total, ace: saque.ace, error: saque.error,
      eff: ratio(saque.ace + saque.positivo - saque.error, saque.total),
    },
    recepcion: {
      total: recepcion.total, perfecta: recepcion.perfecta, error: recepcion.error,
      perfect: ratio(recepcion.perfecta, recepcion.total),
      positive: ratio(recepcion.perfecta + recepcion.buena, recepcion.total),
    },
    ataque: {
      total: ataque.total, punto: ataque.punto, error: ataque.error, bloqueado: ataque.bloqueado,
      kill: ratio(ataque.punto, ataque.total),
      eff: ratio(ataque.punto - ataque.error - ataque.bloqueado, ataque.total),
    },
    bloqueo: { total: bloqueo.total, punto: bloqueo.punto, toque: bloqueo.toque, error: bloqueo.error },
    defensa: {
      total: defensa.total, buena: defensa.buena, error: defensa.error,
      pct: ratio(defensa.buena, defensa.total),
    },
    colocacion: {
      total: colocacion.total, buena: colocacion.buena, error: colocacion.error,
      pct: ratio(colocacion.buena, colocacion.total),
    },
  };
}

// Resumen de puntos del equipo: de dónde vienen los puntos ganados y cedidos.
export function teamSummary(events) {
  const s = { won: 0, lost: 0, ownPoints: 0, rivalErrors: 0, ownErrors: 0, rivalPoints: 0 };
  for (const e of events) {
    if (e.point === 'us') {
      s.won++;
      if (e.skill === 'rival') s.rivalErrors++; else s.ownPoints++;
    } else if (e.point === 'them') {
      s.lost++;
      if (e.skill === 'rival') s.rivalPoints++; else s.ownErrors++;
    }
  }
  return s;
}

export const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);
