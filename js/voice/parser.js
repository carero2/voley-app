// Analizador de texto dictado → acciones del punto.
// Es flexible con el orden y la forma de hablar: reconoce nombres, dorsales y puestos
// («el punta», «la central delantera»), acciones y resultados por palabras clave.
// Lo que no entiende lo deja vacío (null); nunca inventa.
//
// parse(texto, ctx) → { actions, unknown, cause }
// ctx = {
//   players:  [{ id, number, name, position }],        // nuestra plantilla
//   onCourt:  [{ playerId, zone, front, role }],       // quién está en pista al empezar el punto
//   rivals:   [{ id, number, name }],                  // plantilla rival (opcional)
//   serving:  'us' | 'them',
//   serverId: id del jugador que saca (si sacamos nosotros),
//   pointTo:  'us' | 'them' | null,                    // quién ganó el punto (botón)
// }

// ---------- Normalización ----------

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const UNITS = {
  cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21, veintidos: 22, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };

// Convierte números escritos en palabras a cifras («treinta y dos» → 32).
function wordsToDigits(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w in TENS) {
      if (words[i + 1] === 'y' && words[i + 2] in UNITS && UNITS[words[i + 2]] < 10) {
        out.push(String(TENS[w] + UNITS[words[i + 2]]));
        i += 2;
      } else {
        out.push(String(TENS[w]));
      }
    } else if (w in UNITS && !(w === 'un' || w === 'una' || w === 'uno')) {
      out.push(String(UNITS[w]));
    } else {
      out.push(w);
    }
  }
  return out;
}

// ---------- Vocabulario ----------

const SKILL_WORDS = {
  saque: ['saque', 'saca', 'saco', 'sirve', 'servicio'],
  recepcion: ['recepcion', 'recibe', 'recibio', 'recibido', 'recepciona', 'recibir'],
  colocacion: ['colocacion', 'coloca', 'coloco', 'colocar', 'armado'],
  ataque: ['ataque', 'ataca', 'ataco', 'atacar', 'remate', 'remata', 'remato', 'golpea', 'finta', 'tira'],
  bloqueo: ['bloqueo', 'bloquea', 'bloqueo', 'block', 'bloque', 'bloquear'],
  defensa: ['defensa', 'defiende', 'defendio', 'defender', 'levanta', 'saca la bola'],
  free: ['free', 'fri', 'frii', 'freeball', 'fribol', 'friball', 'fribo'],
  apoyo: ['apoyo', 'cubre', 'cobertura', 'apoya'],
};

// Formas verbales que ya indican el equipo: «atacan» (ellos), «rematamos» (nosotros).
const VERB_TEAM = {
  them: {
    ataque: ['atacan', 'rematan', 'tiran', 'golpean', 'fintan', 'atacaron', 'remataron'],
    saque: ['sacan', 'sirven'],
    free: ['pasan'],
    // Otras acciones del rival: se reconocen para no confundirlas, pero no se registran.
    defensa: ['defienden', 'levantan', 'reciben'],
    colocacion: ['colocan'],
  },
  us: {
    ataque: ['atacamos', 'rematamos', 'tiramos', 'atacamos', 'rematemos'],
    recepcion: ['recibimos'],
    defensa: ['defendemos', 'levantamos'],
    bloqueo: ['bloqueamos'],
    colocacion: ['colocamos'],
    saque: ['sacamos'],
    free: ['pasamos'],
  },
};

const RESULT_WORDS = {
  punto: ['punto', 'gana', 'tanto', 'kill', 'mata', 'directo', 'suelo', 'dentro', 'clava', 'clavada'],
  ace: ['ace', 'eis'],
  blockout: ['blockout', 'blocaut', 'blokout', 'bloqueout'],
  bloqueado: ['bloqueado', 'bloqueada', 'tapado', 'tapada', 'taponado', 'taponada', 'bloquean', 'tapan'],
  error: ['error', 'fuera', 'out', 'red', 'falla', 'fallo', 'erra', 'invasion', 'dobles', 'retencion'],
  buena: ['buena', 'bueno', 'bien', 'perfecta', 'perfecto', 'positiva', 'positivo', 'excelente'],
  mala: ['mala', 'malo', 'mal', 'regular', 'negativa', 'negativo'],
  toque: ['toque', 'toca', 'tocado'],
  enjuego: ['sigue', 'continua', 'juego'],
};

const ROLE_WORDS = {
  colocador: ['colocador', 'colocadora', 'armador', 'armadora', 'coloca'],
  opuesto: ['opuesto', 'opuesta'],
  central: ['central', 'centrales'],
  receptor: ['punta', 'puntas', 'receptor', 'receptora', 'ala', 'extremo', 'extrema', 'atacante'],
  libero: ['libero', 'libera'],
};
const FRONT_WORDS = ['delantero', 'delantera', 'delante', 'adelante'];
const BACK_WORDS = ['zaguero', 'zaguera', 'atras', 'trasero', 'trasera'];
// «consiguen defender», «logran recibir»: el verbo auxiliar en plural ya indica que es el rival.
const RIVAL_WORDS = ['rival', 'rivales', 'ellos', 'contrario', 'contrarios', 'contraria', 'adversario', 'adversarios', 'ellas', 'consiguen', 'logran', 'intentan'];
const ZONE_PREFIX = ['zona', 'por', 'desde'];
const ZONE_WORDS = { pipe: 6, centro: 3 };
// Zona habitual de ataque de cada puesto («atacan por opuesto» → zona 2 del rival).
const ROLE_ZONE = { receptor: 4, central: 3, opuesto: 2 };
// Tipos de colocación/ataque: se reconocen para no contarlos como palabras desconocidas.
const SET_TYPES = ['rapida', 'rapido', 'alta', 'alto', 'tensa', 'tenso', 'corta', 'larga', 'segunda', 'primer', 'tiempo', 'finta', 'dejada', 'suave', 'fuerte', 'potente', 'cruzado', 'cruzada', 'paralela', 'diagonal', 'linea'];
const STOP = new Set([...SET_TYPES, 'el', 'la', 'los', 'las', 'de', 'del', 'a', 'al', 'que', 'y', 'con', 'en', 'lo', 'le', 'se', 'su', 'una', 'un', 'uno', 'numero', 'dorsal', 'jugador', 'jugadora', 'luego', 'despues', 'entonces', 'pero', 'muy', 'otra', 'otro', 'vez', 'es', 'ha', 'hace', 'hacen', 'hizo', 'pues', 'vale', 'bola', 'balon', 'pelota', 'por', 'gracias', 'vamos', 'venga']);

// Busca una palabra en un vocabulario { clave: [palabras] }.
function lookup(dict, w) {
  for (const [key, words] of Object.entries(dict)) if (words.includes(w)) return key;
  return null;
}

// Distancia de edición pequeña para tolerar errores de transcripción en nombres.
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// ---------- Tokenización ----------

// Convierte el texto en una lista de «piezas» con tipo: acción, resultado, jugador, puesto, zona, rival, corte.
function tokenize(text, ctx) {
  const clean = strip(text)
    .replace(/block\s*out|bloc\s*out|blo\s*caut/g, 'blockout')
    .replace(/free\s*ball/g, 'freeball')
    .replace(/(bola|pelota|balon) facil/g, 'free')
    .replace(/en juego/g, 'juego')
    .replace(/saca la bola/g, 'defiende');
  const words = wordsToDigits(clean.split(/[^a-z0-9ñ.,;:!?]+/).flatMap((w) => w.split(/(?=[.,;:!?])|(?<=[.,;:!?])/)).filter(Boolean));
  // Solo sirven las partes del nombre que no comparten varios jugadores (p. ej. dos «García»).
  const allParts = ctx.players.map((p) => [...new Set(strip(p.name).split(/\s+/).filter((x) => x.length > 1))]);
  const freq = new Map();
  allParts.flat().forEach((x) => freq.set(x, (freq.get(x) || 0) + 1));
  const names = ctx.players.map((p, i) => ({ p, parts: allParts[i].filter((x) => freq.get(x) === 1 && !lookup(ROLE_WORDS, x)) }));
  const toks = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    if (/^[.,;:!?]$/.test(w)) { toks.push({ type: 'cut' }); continue; }
    // «y» separa acciones: «Carlos recibe y Simón ataca».
    if (w === 'y' || w === 'luego' || w === 'despues') { toks.push({ type: 'soft' }); continue; }

    // Zona: «zona 4», «por 4», «por la 4», «desde 2», «pipe».
    if (ZONE_PREFIX.includes(w)) {
      const n = /^\d+$/.test(next) ? next : (next === 'la' || next === 'el') && /^\d+$/.test(words[i + 2]) ? words[i + 2] : null;
      if (n && Number(n) >= 1 && Number(n) <= 6) {
        toks.push({ type: 'zone', value: Number(n), i });
        i += next === n ? 1 : 2;
        continue;
      }
      // «atacan por opuesto», «rematamos por punta»: zona según el puesto.
      const role = lookup(ROLE_WORDS, next ?? '');
      if (role && role !== 'libero' && role !== 'colocador') {
        toks.push({ type: 'zoneRole', value: role, i });
        i += 1;
        continue;
      }
    }
    if (w in ZONE_WORDS) { toks.push({ type: 'zone', value: ZONE_WORDS[w], i }); continue; }

    if (RIVAL_WORDS.includes(w)) { toks.push({ type: 'rival', i }); continue; }

    // Dorsal: número (fuera de contexto de zona). Puede ser nuestro o del rival.
    if (/^\d+$/.test(w)) {
      const n = w;
      const ours = ctx.players.find((p) => String(p.number) === n);
      const theirs = (ctx.rivals || []).find((p) => String(p.number) === n);
      toks.push({ type: 'number', value: n, ours: ours?.id ?? null, theirs: theirs?.id ?? null, i });
      continue;
    }

    const verbTeam = VERB_TEAM.them && Object.entries(VERB_TEAM).find(([, forms]) => lookup(forms, w));
    if (verbTeam) { toks.push({ type: 'skill', value: lookup(verbTeam[1], w), team: verbTeam[0], word: w, i }); continue; }

    const skill = lookup(SKILL_WORDS, w);
    // «coloca» puede ser verbo (colocación) o puesto: se decide después según contexto.
    if (skill) { toks.push({ type: 'skill', value: skill, word: w, i }); continue; }

    const result = lookup(RESULT_WORDS, w);
    if (result) { toks.push({ type: 'result', value: result, i }); continue; }

    const role = lookup(ROLE_WORDS, w);
    if (role) { toks.push({ type: 'role', value: role, i }); continue; }
    if (FRONT_WORDS.includes(w)) { toks.push({ type: 'qual', value: 'front', i }); continue; }
    if (BACK_WORDS.includes(w)) { toks.push({ type: 'qual', value: 'back', i }); continue; }

    // «coloca a Carlos», «para el punta»: marca a quién va dirigida la acción.
    if (w === 'a' || w === 'para' || w === 'al') { toks.push({ type: 'prep', i }); continue; }
    if (STOP.has(w) || w.length < 3) continue;

    // Nombre de jugador (tolerando 1 error de transcripción en nombres de 5+ letras).
    const hit = names.find(({ parts }) => parts.some((part) => part === w || (w.length >= 5 && editDistance(part, w) <= 1)));
    if (hit) { toks.push({ type: 'player', value: hit.p.id, i }); continue; }
    // Nombre abreviado o cortado por la transcripción («Mert» → Mertinho), si solo encaja con uno.
    const byPrefix = w.length >= 3 ? names.filter(({ parts }) => parts.some((part) => part.length > w.length && part.startsWith(w))) : [];
    if (byPrefix.length === 1) { toks.push({ type: 'player', value: byPrefix[0].p.id, i }); continue; }

    toks.push({ type: 'unknown', value: w, i });
  }
  return toks;
}

// ---------- Agrupación en acciones ----------

const SUBJECT_TYPES = ['player', 'number', 'role', 'qual'];

// Junta en un único «sujeto» las piezas seguidas que se refieren al mismo jugador:
// «el punta 11», «Carlos, el 23» (sin coma), «el punta trasero».
function mergeSubjects(toks) {
  const out = [];
  let target = false;
  for (const t of toks) {
    if (t.type === 'prep') { target = true; continue; }
    if (SUBJECT_TYPES.includes(t.type)) {
      const last = out.at(-1);
      // Lo que va tras «a/para» es el destinatario: nunca se une al sujeto anterior («coloca Simón a 2»).
      const canMerge = !target && last?.type === 'subj' && !(t.type === 'qual' ? last.qual : last[t.type] != null)
        && !(t.type === 'player' && last.player) && !(t.type === 'number' && last.number);
      if (canMerge) {
        if (t.type === 'qual') last.qual = t.value; else last[t.type] = t;
        continue;
      }
      out.push({ type: 'subj', target, [t.type === 'qual' ? 'qual' : t.type]: t.type === 'qual' ? t.value : t });
      target = false;
      continue;
    }
    if (t.type !== 'unknown') target = t.type === 'rival' ? target : false;
    out.push(t);
  }
  return out;
}

// Divide el texto en frases (por pausas y «y») y, dentro de cada frase, asigna a cada acción
// su jugador (antes o después del verbo), su resultado y su zona.
function groupActions(toks) {
  const clauses = [[]];
  for (const t of mergeSubjects(toks)) {
    if (t.type === 'cut' || t.type === 'soft') { if (clauses.at(-1).length) clauses.push([]); continue; }
    clauses.at(-1).push(t);
  }
  const groups = [];
  for (let cl of clauses) {
    // «pasan free», «pasamos free»: verbo y nombre de la misma acción seguidos cuentan una vez.
    cl = cl.filter((t, i) => {
      const prev = cl[i - 1];
      if (t.type === 'skill' && prev?.type === 'skill' && prev.value === t.value) {
        prev.team ??= t.team;
        return false;
      }
      return true;
    });
    if (!cl.length) continue;
    const skills = cl.map((t, i) => (t.type === 'skill' ? i : -1)).filter((i) => i >= 0);
    if (!skills.length) {
      groups.push({ skill: null, subj: cl.find((t) => t.type === 'subj' && !t.target) ?? null, target: cl.find((t) => t.type === 'subj' && t.target) ?? null, items: cl });
      continue;
    }
    const gs = skills.map((i) => ({ skill: cl[i].value, team: cl[i].team ?? null, subj: null, target: null, items: [] }));
    const groupFor = (i) => {
      let k = skills.findIndex((s) => s > i) - 1;
      if (k === -2) k = skills.length - 1; // después de la última acción
      return k < 0 ? 0 : k;
    };
    cl.forEach((t, i) => {
      if (t.type === 'skill') return;
      if (t.type === 'subj') {
        if (t.target) {
          const g = gs[Math.max(0, groupFor(i))];
          // Dos destinatarios: el primero era en realidad quien hace la acción («coloca a Mert a opuesto»).
          if (g.target && !g.subj) g.subj = { ...g.target, target: false };
          if (!g.target || g.subj) g.target = t;
          return;
        }
        const before = skills[0] > i;
        let k = before ? 0 : groupFor(i);
        // Sujeto entre dos acciones: es de la anterior si aún no tiene («recibe Carlos, remata Pablo»),
        // si no, de la siguiente («Carlos recibe, Pablo remata»).
        if (!before && gs[k].subj && k + 1 < gs.length) k += 1;
        if (!gs[k].subj) gs[k].subj = t;
        return;
      }
      gs[groupFor(i)].items.push(t);
    });
    groups.push(...gs);
  }
  return groups;
}

// ---------- Resolución ----------

// Resultado genérico → resultado válido para cada fundamento.
function mapResult(skill, r) {
  if (!r) return null;
  const table = {
    saque: { ace: 'ace', punto: 'ace', error: 'error', enjuego: 'enjuego', buena: 'enjuego', mala: 'enjuego' },
    recepcion: { buena: 'buena', mala: 'mala', error: 'error', ace: 'error' },
    colocacion: { buena: 'buena', mala: 'mala', error: 'error' },
    ataque: { punto: 'punto', blockout: 'blockout', bloqueado: 'bloqueado', error: 'error', enjuego: 'enjuego', buena: 'enjuego', toque: 'enjuego' },
    bloqueo: { punto: 'punto', buena: 'toque', toque: 'toque', error: 'error', blockout: 'error' },
    defensa: { buena: 'buena', mala: 'mala', error: 'error' },
    apoyo: { buena: 'buena', mala: 'mala', error: 'error' },
  };
  return table[skill]?.[r] ?? null;
}

// Jugador al que se refiere un sujeto: nombre o dorsal mandan; si no, el puesto según la rotación.
function resolveSubject(subj, skill, ctx) {
  if (!subj) return null;
  if (subj.player) return subj.player.value;
  if (subj.number?.ours) return subj.number.ours;
  if (!subj.role) return null;
  let cands = (ctx.onCourt || []).filter((c) => c.role === subj.role.value);
  if (subj.qual) cands = cands.filter((c) => (subj.qual === 'front' ? c.front : !c.front));
  // Solo los delanteros atacan desde la red y bloquean; en recepción/defensa no se puede decidir.
  if (cands.length > 1 && ['ataque', 'bloqueo'].includes(skill)) cands = cands.filter((c) => c.front);
  if (cands.length === 1) return cands[0].playerId;
  // Si no está en pista al empezar el punto (p. ej. el líbero cuando saca el central), se busca en la
  // plantilla: vale si solo hay un jugador con ese puesto.
  if (cands.length === 0 && !subj.qual) {
    const byPos = ctx.players.filter((p) => p.position === subj.role.value);
    if (byPos.length === 1) return byPos[0].id;
  }
  return null;
}

const isRivalSubj = (subj) => Boolean(subj?.number && !subj.number.ours && subj.number.theirs && !subj.player && !subj.role);

// Si no se dice la acción, se deduce del momento del punto.
function inferSkill(prev, group, ctx, isFirst) {
  const r = group.items.find((x) => x.type === 'result')?.value;
  if (['punto', 'blockout', 'bloqueado'].includes(r)) return 'ataque';
  if (r === 'toque') return 'bloqueo';
  if (!prev) return ctx.serving === 'them' && isFirst ? 'recepcion' : 'defensa';
  if (prev.team === 'them') return 'defensa';
  if (['recepcion', 'defensa', 'apoyo', 'colocacion'].includes(prev.skill)) return 'ataque';
  return null;
}

export function parse(text, ctx) {
  const toks = tokenize(text || '', ctx);
  const groups = groupActions(toks);
  const actions = [];
  let pendingAttacker = null; // «coloca a X»: X es el atacante siguiente
  let pendingZone = null; // «coloca a 4»: zona del ataque siguiente
  let rivalPending = false; // «colocan a 4»: el rival va a atacar
  let rivalZone = null;
  // Campo en el que está el balón: una acción sin sujeto es del equipo que lo tiene
  // («defienden, colocan a 4 y remata» → remata el rival).
  let side = ctx.serving === 'us' ? 'them' : 'us';
  let touched = false; // ya hubo algún toque tras el saque
  const PASSES = ['saque', 'ataque', 'free'];
  const moveBall = (team, skill) => { side = PASSES.includes(skill) ? (team === 'us' ? 'them' : 'us') : team; };

  // Nuestro ataque anunciado («coloca a 4») que no se llegó a decir: se da por hecho.
  const flushOurs = () => {
    if (!pendingAttacker && !pendingZone) return;
    actions.push({ skill: 'ataque', team: 'us', playerId: pendingAttacker, rivalPlayerId: null, zone: pendingZone, result: null, inferredSkill: true });
    pendingAttacker = null;
    pendingZone = null;
    moveBall('us', 'ataque');
  };
  const flushRival = () => {
    if (!rivalPending) return;
    actions.push({ skill: 'ataque', team: 'them', playerId: null, rivalPlayerId: null, zone: rivalZone, result: null, inferredSkill: true });
    rivalPending = false;
    rivalZone = null;
    moveBall('them', 'ataque');
  };
  // Si después del saque pasa algo más, el saque entró.
  const serveInPlay = () => actions.forEach((a) => {
    if (a.team === 'us' && a.skill === 'saque' && !a.result) { a.result = 'enjuego'; a.inferredResult = true; }
  });
  const targetZone = (target) => {
    if (!target) return null;
    if (target.number && !target.player && !target.role) {
      const n = Number(target.number.value);
      return n >= 1 && n <= 6 ? n : null;
    }
    return target.role ? ROLE_ZONE[target.role.value] ?? null : null;
  };

  groups.forEach((g) => {
    const prev = actions.at(-1);
    const r = g.items.filter((x) => x.type === 'result').at(-1)?.value ?? null;
    let zone = g.items.find((x) => x.type === 'zone')?.value ?? null;
    const zoneRole = g.items.find((x) => x.type === 'zoneRole')?.value ?? null;
    const rivalMark = g.items.some((x) => x.type === 'rival');

    // Resultado o zona sueltos tras una pausa («Carlos ataca por 4, punto»): completan la acción anterior.
    if (!g.skill && !g.subj && !g.target && !rivalMark && (prev || rivalPending)) {
      if (rivalPending && (r || zone)) {
        rivalZone ??= zone;
        flushRival();
        actions.at(-1).result = r === 'punto' || r === 'error' ? r : null;
        return;
      }
      if (!prev) return;
      // «Colocación a opuesto y fuera»: el resultado es del ataque, no de la colocación.
      if (prev.skill === 'colocacion' && (pendingAttacker || pendingZone)) {
        actions.push({ skill: 'ataque', team: 'us', playerId: pendingAttacker, rivalPlayerId: null, zone: pendingZone ?? zone, result: mapResult('ataque', r), inferredSkill: true });
        pendingAttacker = null;
        pendingZone = null;
        moveBall('us', 'ataque');
        return;
      }
      if (!prev.result) prev.result = prev.team === 'us' ? mapResult(prev.skill, r) : (r === 'punto' || r === 'error' ? r : null);
      if (zone && !prev.zone) prev.zone = zone;
      return;
    }
    if (!g.skill && !g.subj && !g.target && !r && !zone && !zoneRole && !rivalMark) return;

    // «Saca a Mert», «defiende a Joan»: la transcripción añade una «a»; solo colocación y FREE van dirigidas a alguien.
    let subj = g.subj;
    let target = g.target;
    if (target && !subj && g.skill && !['colocacion', 'free'].includes(g.skill)) { subj = target; target = null; }
    if (target && !subj && g.skill === 'colocacion' && ctx.setterId && resolveSubject(target, 'colocacion', ctx) === ctx.setterId) {
      subj = target; // «coloca a Mert»: Mert es el colocador, no el destinatario
      target = null;
    }

    const rivalSubj = isRivalSubj(subj);
    let team = g.team ?? (rivalMark || rivalSubj ? 'them' : subj ? 'us' : null);
    // «block» suelto se refiere siempre a la red: se resuelve más abajo con el botón del punto.
  if (!team) team = g.skill === 'saque' ? ctx.serving : g.skill === 'bloqueo' ? 'us' : side;
    // «atacan por opuesto» → zona 2 del rival; «remata por punta» → ataca nuestro punta.
    if (zoneRole && team === 'them') zone ??= ROLE_ZONE[zoneRole] ?? null;
    if (zoneRole && team === 'us' && !subj) subj = { type: 'subj', role: { value: zoneRole } };

    let skill = g.skill ?? (team === 'them' ? 'ataque' : inferSkill(prev, g, ctx, !touched));
    const firstTouch = ctx.serving === 'them' && !touched;
    if (skill !== 'saque') touched = true;

    // Del rival solo interesan ataque, saque y FREE; el resto («defienden», «colocan a 4») solo mueve el balón.
    if (team === 'them' && !PASSES.includes(skill)) {
      flushOurs();
      serveInPlay();
      if (skill === 'colocacion') {
        rivalPending = true;
        rivalZone = zone ?? targetZone(target);
      }
      moveBall('them', skill);
      return;
    }
    // El primer toque tras el saque rival es la recepción («defiende Joan» → recibe Joan);
    // después, «recibe» es defensa (tras un ataque, un toque de bloqueo o una FREE del rival).
    if (team === 'us' && skill === 'defensa' && firstTouch && !g.items.some((x) => x.type === 'rival')) skill = 'recepcion';
    if (skill === 'recepcion' && team === 'us' && !firstTouch) skill = 'defensa';
    // «block» sin decir de quién: se decide con el botón que cerró el punto.
    if (skill === 'bloqueo' && team === 'us' && !subj) {
      const ourAttackPending = pendingAttacker || pendingZone || (prev?.team === 'us' && prev.skill === 'ataque' && !prev.result);
      // Tras nuestro ataque y punto rival: nos han bloqueado.
      if (ourAttackPending && ctx.pointTo === 'them') {
        if (prev?.team === 'us' && prev.skill === 'ataque' && !prev.result) {
          prev.result = 'bloqueado';
          prev.inferredResult = true;
        } else {
          actions.push({ skill: 'ataque', team: 'us', playerId: pendingAttacker, rivalPlayerId: null, zone: pendingZone, result: 'bloqueado', inferredSkill: true, inferredResult: true });
          pendingAttacker = null;
          pendingZone = null;
        }
        return;
      }
    }
    // «Buena recepción» después de «recibe el líbero»: es la calidad de esa misma acción.
    if (g.skill && !subj && !target && team === 'us' && prev?.team === 'us' && prev.skill === skill && !prev.result && r) {
      prev.result = mapResult(skill, r);
      if (zone && !prev.zone) prev.zone = zone;
      return;
    }

    if (team === 'them' || skill !== 'ataque') flushOurs();
    if (team === 'us' || skill !== 'ataque') flushRival();
    if (skill !== 'saque') serveInPlay();

    const action = { skill, team, playerId: null, rivalPlayerId: null, zone, result: null, inferredSkill: !g.skill };

    if (team === 'us') {
      let player = resolveSubject(subj, skill, ctx);
      if (!player && skill === 'saque' && ctx.serving === 'us') player = ctx.serverId ?? null;
      if (!player && skill === 'colocacion') player = ctx.setterId ?? null; // coloca quien está de colocador
      if (!player && skill === 'ataque' && pendingAttacker) player = pendingAttacker;
      if (skill === 'ataque' && !action.zone && pendingZone) action.zone = pendingZone;
      // «rematamos por 3»: quien ataca por esa zona según la rotación.
      if (!player && skill === 'ataque' && zone && ctx.attackZones?.[zone]) player = ctx.attackZones[zone];
      action.playerId = player;
      action.result = skill === 'free' ? 'free' : mapResult(skill, r);
      if (skill === 'ataque') { pendingAttacker = null; pendingZone = null; }
      if (skill === 'colocacion') {
        // «coloca a 4», «coloca a centro»: zona del ataque siguiente; «coloca a Joan», «al opuesto»: su atacante.
        const onlyNumber = target?.number && !target.player && !target.role;
        const n = onlyNumber ? Number(target.number.value) : null;
        const setZone = n >= 1 && n <= 6 ? n : !target ? zone : null;
        if (setZone) {
          pendingZone = setZone;
          pendingAttacker = ctx.attackZones?.[setZone] ?? null;
          action.zone = null;
        } else if (target) {
          pendingAttacker = resolveSubject(target, 'ataque', ctx);
        }
      } else if (target) {
        pendingAttacker = resolveSubject(target, 'ataque', ctx);
      }
    } else {
      action.rivalPlayerId = subj?.number?.theirs ?? null;
      action.result = r === 'punto' || r === 'error' ? r : null;
      if (skill === 'ataque') {
        action.zone ??= rivalZone;
        rivalPending = false;
        rivalZone = null;
      }
    }
    actions.push(action);
    moveBall(team, skill);
  });

  // «coloca a X» sin decir luego «X ataca»: el ataque de X se da por hecho (igual con el rival).
  flushOurs();
  flushRival();

  // Colocación: buena salvo que se diga lo contrario (y la hace el colocador en pista).
  actions.forEach((a) => {
    if (a.team === 'us' && a.skill === 'colocacion' && !a.result) { a.result = 'buena'; a.inferredResult = true; }
  });

  // Nuestro ataque sin resultado seguido de una acción del rival: el balón siguió en juego.
  actions.forEach((a, i) => {
    const next = actions[i + 1];
    if (a.team === 'us' && a.skill === 'ataque' && !a.result && next?.team === 'them') {
      a.result = 'enjuego';
      a.inferredResult = true;
    }
  });

  // Primer/segundo toque sin calidad: si después atacamos (o colocamos), fue bueno; si pasamos FREE, malo.
  actions.forEach((a, i) => {
    const next = actions[i + 1];
    if (a.team !== 'us' || a.result || !next || next.team !== 'us') return;
    if (['recepcion', 'defensa', 'apoyo', 'colocacion'].includes(a.skill)) {
      if (['ataque', 'colocacion'].includes(next.skill)) a.result = 'buena';
      else if (next.skill === 'free' && a.skill !== 'colocacion') a.result = 'mala';
      if (a.result) a.inferredResult = true;
    }
  });

  // La última acción se completa con el botón que cerró el punto (si no se dijo el resultado).
  const last = actions.at(-1);
  const infer = (a, result) => { a.result = result; a.inferredResult = true; };
  if (last && !last.result && ctx.pointTo) {
    if (ctx.pointTo === 'us') {
      if (last.team === 'us' && ['ataque', 'bloqueo'].includes(last.skill)) infer(last, 'punto');
      else if (last.team === 'them' && last.skill === 'ataque') infer(last, 'error'); // su ataque acabó fuera o en la red
    } else {
      if (last.team === 'them' && last.skill === 'ataque') infer(last, 'punto');
      else if (last.team === 'us' && ['recepcion', 'defensa', 'apoyo', 'colocacion'].includes(last.skill)) infer(last, 'error');
    }
  }

  // Zona de cada acción nuestra sin zona dicha: la posición de juego del jugador en esa rotación
  // (recepción o ataque/defensa), p. ej. en R1 recibiendo el punta delantero recibe en Z1 y ataca por Z2.
  actions.forEach((a) => {
    if (a.team !== 'us' || a.zone || !a.playerId || a.skill === 'saque') return;
    const z = ctx.zones?.[a.skill === 'recepcion' ? 'reception' : 'play']?.[a.playerId];
    if (z) { a.zone = z; a.inferredZone = true; }
  });

  const unknown = toks.filter((t) => t.type === 'unknown').map((t) => t.value);
  return { actions, unknown, cause: deriveCause(actions, ctx.pointTo) };
}

// Cómo terminó el punto según lo dictado (para separar puntos propios, errores, etc.).
export function deriveCause(actions, pointTo) {
  const last = [...actions].reverse().find((a) => a.result);
  if (!last || !pointTo) return null;
  const ownPoint = last.team === 'us' && ['punto', 'blockout', 'ace'].includes(last.result);
  const ownError = last.team === 'us' && ['error', 'bloqueado'].includes(last.result);
  if (pointTo === 'us') return ownPoint ? 'own' : last.team === 'them' && last.result === 'error' ? 'rivalError' : null;
  return ownError ? 'ownError' : last.team === 'them' && last.result === 'punto' ? 'rivalPoint' : null;
}

// Campos que faltan en una acción (para la revisión y para medir información perdida).
export function missingFields(a) {
  const miss = [];
  if (!a.skill) miss.push('acción');
  if (a.team === 'us' && !a.playerId) miss.push('jugador');
  if (a.team === 'us' && !a.result && a.skill !== 'free') miss.push('resultado');
  return miss;
}
