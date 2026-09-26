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
    // Sin jugador o sin resultado (p. ej. dictado incompleto) no cuenta en las estadísticas individuales.
    if (!e.playerId || e.skill === 'rival' || !e.result) continue;
    const key = keyFn(e);
    if (key == null || !SKILLS.some((s) => s.id === e.skill)) continue;
    if (!groups.has(key)) groups.set(key, { counts: emptyCounts(), matches: new Set() });
    const g = groups.get(key);
    const c = g.counts[e.skill];
    c[e.result] = (c[e.result] || 0) + 1;
    c.total += 1;
    g.matches.add(e.matchId);
  }
  return groups;
}

const ratio = (n, d) => (d ? n / d : null);

export function metrics(counts) {
  const { saque, recepcion, ataque, bloqueo, defensa, colocacion } = counts;
  const points = saque.ace + ataque.punto + ataque.blockout + bloqueo.punto;
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
      eff: ratio(saque.ace - saque.error, saque.total),
    },
    recepcion: {
      // «Perfecta» es un valor antiguo: cuenta como buena.
      total: recepcion.total, buena: recepcion.buena + recepcion.perfecta, mala: recepcion.mala, error: recepcion.error,
      positive: ratio(recepcion.perfecta + recepcion.buena, recepcion.total),
    },
    ataque: {
      total: ataque.total, punto: ataque.punto + ataque.blockout, blockout: ataque.blockout,
      error: ataque.error, bloqueado: ataque.bloqueado,
      kill: ratio(ataque.punto + ataque.blockout, ataque.total),
      eff: ratio(ataque.punto + ataque.blockout - ataque.error - ataque.bloqueado, ataque.total),
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
  const s = { won: 0, lost: 0, ownPoints: 0, rivalErrors: 0, ownErrors: 0, rivalPoints: 0, unknownWon: 0, unknownLost: 0 };
  // Puntos cerrados con botón (modo voz): el origen sale de lo dictado, si se entendió.
  const CAUSE = { own: 'ownPoints', rivalError: 'rivalErrors', ownError: 'ownErrors', rivalPoint: 'rivalPoints' };
  for (const e of events) {
    if (e.skill === 'cierre') {
      if (e.point === 'us') s.won++; else s.lost++;
      if (CAUSE[e.cause]) s[CAUSE[e.cause]]++;
      else if (e.point === 'us') s.unknownWon++; else s.unknownLost++;
      continue;
    }
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

// Puntos jugados agrupados por rotación: side-out (recibiendo) y break (sacando).
export function rotationStats(events) {
  const rows = new Map([1, 2, 3, 4, 5, 6].map((r) => [r, { rot: r, recv: 0, sideOut: 0, serve: 0, breaks: 0, won: 0, lost: 0 }]));
  for (const e of events) {
    if (!e.point || !e.rot || !e.serving) continue;
    const r = rows.get(e.rot);
    if (e.point === 'us') r.won++; else r.lost++;
    if (e.serving === 'them') {
      r.recv++;
      if (e.point === 'us') r.sideOut++;
    } else {
      r.serve++;
      if (e.point === 'us') r.breaks++;
    }
  }
  return [...rows.values()];
}

// Recuento por zona (1..6) de un fundamento, usando la zona de origen o la de destino.
export function zoneStats(events, skill, field = 'zone') {
  const zones = Object.fromEntries([1, 2, 3, 4, 5, 6].map((z) => [z, { total: 0, good: 0, bad: 0 }]));
  const GOOD = { ataque: ['punto', 'blockout'], saque: ['ace'], recepcion: ['perfecta', 'buena'] };
  const BAD = { ataque: ['error', 'bloqueado'], saque: ['error'], recepcion: ['error', 'mala'] };
  for (const e of events) {
    if (e.skill !== skill || !e[field]) continue;
    const z = zones[e[field]];
    z.total++;
    if (GOOD[skill]?.includes(e.result)) z.good++;
    if (BAD[skill]?.includes(e.result)) z.bad++;
  }
  return zones;
}

// Ganador de cada punto (clave partido-set-punto).
function rallyWinners(events) {
  const w = new Map();
  for (const e of events) if (e.point && e.rally) w.set(`${e.matchId}|${e.set}|${e.rally}`, e.point);
  return w;
}

// Ataque rival por zona de origen y jugadores rivales.
export function rivalStats(events) {
  const winners = rallyWinners(events);
  const rallyKey = (e) => `${e.matchId}|${e.set}|${e.rally}`;
  const zoneMap = () => Object.fromEntries([1, 2, 3, 4, 5, 6].map((z) => [z, { total: 0, good: 0, bad: 0 }]));

  // good = punto del rival, bad = punto nuestro (en ese mismo punto jugado).
  const attack = zoneMap();
  const players = new Map();

  for (const e of events) {
    const outcome = winners.get(rallyKey(e));
    // La zona de una FREE rival no es un ataque; la de nuestra defensa (aunque acabe en FREE) sí.
    const rivalFree = e.skill === 'rival' && e.result === 'free';
    if (!rivalFree && e.rivalZone) {
      const z = attack[e.rivalZone];
      z.total++;
      if (outcome === 'them') z.good++; else if (outcome === 'us') z.bad++;
    }
    if (e.rivalPlayerId) {
      if (!players.has(e.rivalPlayerId)) players.set(e.rivalPlayerId, { serves: 0, attacks: 0, points: 0, errors: 0 });
      const p = players.get(e.rivalPlayerId);
      const serve = e.serving === 'them' && (e.skill === 'recepcion' || ['ace', 'saque_error'].includes(e.result));
      if (serve) p.serves++; else p.attacks++;
      if (e.point === 'them') p.points++; else if (e.point === 'us') p.errors++;
    }
  }
  return { attack, players };
}

// Bolas FREE: quién, cuándo (toque y rotación), cuántas y cómo terminan los puntos.
export function freeStats(events) {
  const rallies = new Map();
  for (const e of events) {
    if (!e.rally) continue;
    const k = `${e.matchId}|${e.set}|${e.rally}`;
    if (!rallies.has(k)) rallies.set(k, []);
    rallies.get(k).push(e);
  }
  const zoneMap = () => Object.fromEntries([1, 2, 3, 4, 5, 6].map((z) => [z, { total: 0, good: 0, bad: 0 }]));
  const bump = (map, key, won) => {
    if (key == null) return;
    if (!map.has(key)) map.set(key, { n: 0, won: 0, lost: 0 });
    const r = map.get(key);
    r.n++;
    if (won === true) r.won++; else if (won === false) r.lost++;
  };
  const ours = { total: 0, won: 0, lost: 0, direct: 0, byPlayer: new Map(), byTouch: new Map(), byRot: new Map(), zones: zoneMap() };
  const theirs = { total: 0, won: 0, lost: 0, firstAttack: {}, noAttack: 0, byRot: new Map(), zones: zoneMap() };

  for (const list of rallies.values()) {
    const winner = list.find((e) => e.point)?.point;
    list.forEach((e, i) => {
      if (e.result !== 'free') return;
      const rest = list.slice(i + 1);
      if (e.skill === 'equipo') {
        const won = winner ? winner === 'us' : null;
        ours.total++;
        if (won === true) ours.won++; else if (won === false) ours.lost++;
        // Punto directo del rival: lo siguiente que se anota es un punto suyo sin que toquemos el balón.
        const next = rest.find((x) => x.point || x.playerId);
        if (next?.point === 'them' && next.skill === 'rival') ours.direct++;
        bump(ours.byPlayer, e.playerId, won);
        bump(ours.byTouch, e.phase ?? 'attack', won);
        bump(ours.byRot, e.rot, won);
        if (e.zoneTo) {
          ours.zones[e.zoneTo].total++;
          if (won === true) ours.zones[e.zoneTo].good++;
        }
      } else if (e.skill === 'rival') {
        const won = winner ? winner === 'us' : null;
        theirs.total++;
        if (won === true) theirs.won++; else if (won === false) theirs.lost++;
        const attack = rest.find((x) => x.skill === 'ataque');
        if (attack) theirs.firstAttack[attack.result] = (theirs.firstAttack[attack.result] || 0) + 1;
        else theirs.noAttack++;
        bump(theirs.byRot, e.rot, won);
        if (e.rivalZone) {
          theirs.zones[e.rivalZone].total++;
          if (won === true) theirs.zones[e.rivalZone].good++;
        }
      }
    });
  }
  return { ours, theirs };
}

export const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);
