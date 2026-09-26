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
  free: ['free', 'fri', 'freeball', 'fribol'],
  apoyo: ['apoyo', 'cubre', 'cobertura', 'apoya'],
};

const RESULT_WORDS = {
  punto: ['punto', 'gana', 'tanto', 'kill', 'mata', 'directo', 'suelo'],
  ace: ['ace', 'eis'],
  blockout: ['blockout', 'blocaut', 'blokout', 'bloqueout'],
  bloqueado: ['bloqueado', 'bloqueada', 'tapado', 'tapada', 'taponado', 'taponada'],
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
const RIVAL_WORDS = ['rival', 'rivales', 'ellos', 'contrario', 'contrarios', 'contraria', 'adversario', 'adversarios', 'ellas'];
const ZONE_PREFIX = ['zona', 'por', 'desde'];
const ZONE_WORDS = { pipe: 6, centro: 3 };
const STOP = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'a', 'al', 'que', 'y', 'con', 'en', 'lo', 'le', 'se', 'su', 'una', 'un', 'uno', 'numero', 'dorsal', 'jugador', 'jugadora', 'luego', 'despues', 'entonces', 'pero', 'muy', 'otra', 'otro', 'vez', 'es', 'ha', 'hace', 'hacen', 'hizo', 'pues', 'vale', 'bola', 'balon', 'pelota']);

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

    const skill = lookup(SKILL_WORDS, w);
    // «coloca» puede ser verbo (colocación) o puesto: se decide después según contexto.
    if (skill) { toks.push({ type: 'skill', value: skill, word: w, i }); continue; }

    const result = lookup(RESULT_WORDS, w);
    if (result) { toks.push({ type: 'result', value: result, i }); continue; }

    const role = lookup(ROLE_WORDS, w);
    if (role) { toks.push({ type: 'role', value: role, i }); continue; }
    if (FRONT_WORDS.includes(w)) { toks.push({ type: 'qual', value: 'front', i }); continue; }
    if (BACK_WORDS.includes(w)) { toks.push({ type: 'qual', value: 'back', i }); continue; }

    if (STOP.has(w) || w.length < 3) continue;

    // Nombre de jugador (tolerando 1 error de transcripción en nombres de 5+ letras).
    const hit = names.find(({ parts }) => parts.some((part) => part === w || (w.length >= 5 && editDistance(part, w) <= 1)));
    if (hit) { toks.push({ type: 'player', value: hit.p.id, i }); continue; }

    toks.push({ type: 'unknown', value: w, i });
  }
  return toks;
}

// ---------- Agrupación en acciones ----------

// Cada acción se construye alrededor de una palabra de acción (o de un resultado si no hay acción).
// Los sujetos (jugador, puesto, dorsal) suelen ir antes del verbo y los complementos (zona, resultado) después.
function groupActions(toks) {
  const groups = [];
  let current = null;
  let pending = []; // sujetos vistos antes de la palabra de acción
  const flush = () => {
    if (current) groups.push(current);
    current = null;
  };
  const newGroup = (skill) => {
    flush();
    current = { skill, items: [...pending] };
    pending = [];
  };

  for (const t of toks) {
    if (t.type === 'cut') {
      if (current) { current.items.push(...pending); pending = []; flush(); }
      continue;
    }
    if (t.type === 'soft') {
      if (current) { current.items.push(...pending); pending = []; flush(); }
      continue;
    }
    if (t.type === 'skill') {
      // Si el grupo actual todavía no tiene acción, se la asignamos.
      if (current && !current.skill) {
        current.skill = t.value;
        current.items.push(...pending);
        pending = [];
      } else {
        newGroup(t.value);
      }
      continue;
    }
    const isSubject = ['player', 'role', 'number', 'rival', 'qual'].includes(t.type);
    if (isSubject) {
      // Un sujeto nuevo tras un grupo que ya tiene sujeto y resultado abre otra acción.
      if (current && current.items.some((x) => ['player', 'role', 'number'].includes(x.type)) && ['player', 'role', 'number'].includes(t.type)) {
        flush();
      }
      if (current) current.items.push(t); else pending.push(t);
      continue;
    }
    // Resultado o zona.
    if (!current) newGroup(null);
    current.items.push(t);
  }
  if (current) current.items.push(...pending);
  else if (pending.length) groups.push({ skill: null, items: pending });
  flush();
  return groups.filter((g) => g.skill || g.items.some((x) => x.type !== 'unknown'));
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

function resolvePlayer(items, skill, ctx) {
  const player = items.find((x) => x.type === 'player');
  if (player) return player.value;
  const num = items.find((x) => x.type === 'number' && x.ours);
  if (num) return num.ours;
  const role = items.find((x) => x.type === 'role');
  if (!role) return null;
  const qual = items.find((x) => x.type === 'qual')?.value;
  let cands = (ctx.onCourt || []).filter((c) => c.role === role.value);
  if (qual) cands = cands.filter((c) => (qual === 'front' ? c.front : !c.front));
  if (cands.length > 1) {
    // Solo los delanteros atacan desde la red y bloquean; en recepción/defensa no se puede decidir.
    if (['ataque', 'bloqueo'].includes(skill)) cands = cands.filter((c) => c.front);
  }
  return cands.length === 1 ? cands[0].playerId : null;
}

// Si no se dice la acción, se deduce del momento del punto.
function inferSkill(prev, group, ctx, isFirst) {
  const r = group.items.find((x) => x.type === 'result')?.value;
  if (['punto', 'blockout', 'bloqueado'].includes(r)) return 'ataque';
  if (r === 'toque') return 'bloqueo';
  if (!prev) return ctx.serving === 'them' && isFirst ? 'recepcion' : 'defensa';
  if (prev.team === 'them' && prev.skill === 'ataque') return 'defensa';
  if (['recepcion', 'defensa', 'apoyo', 'colocacion', 'free'].includes(prev.skill) && prev.team === 'them') return 'defensa';
  if (['recepcion', 'defensa', 'apoyo'].includes(prev.skill)) return 'ataque';
  if (prev.skill === 'colocacion') return 'ataque';
  return null;
}

export function parse(text, ctx) {
  const toks = tokenize(text || '', ctx);
  const groups = groupActions(toks);
  const actions = [];

  groups.forEach((g, idx) => {
    // Resultado o zona sueltos tras una pausa («Carlos ataca por 4, punto»): completan la acción anterior.
    const prevAction = actions.at(-1);
    const orphan = !g.skill && g.items.every((x) => ['result', 'zone', 'unknown'].includes(x.type));
    if (orphan && prevAction && !prevAction.result) {
      const r = g.items.filter((x) => x.type === 'result').at(-1)?.value;
      const z = g.items.find((x) => x.type === 'zone')?.value;
      if (prevAction.team === 'us') prevAction.result = mapResult(prevAction.skill, r) ?? prevAction.result;
      else if (r === 'punto' || r === 'error') prevAction.result = r;
      if (z && !prevAction.zone) prevAction.zone = z;
      return;
    }
    const isRival = g.items.some((x) => x.type === 'rival')
      || (!g.items.some((x) => ['player', 'role'].includes(x.type)) && g.items.some((x) => x.type === 'number' && !x.ours && x.theirs));
    const prev = actions.at(-1);
    let skill = g.skill;
    const inferred = !skill;
    if (!skill) skill = isRival ? 'ataque' : inferSkill(prev, g, ctx, idx === 0);
    // «coloca» como puesto en vez de verbo: «el coloca ataca» es raro; lo dejamos como colocación.
    const rawResult = g.items.filter((x) => x.type === 'result').at(-1)?.value ?? null;
    const zone = g.items.find((x) => x.type === 'zone')?.value ?? null;
    const team = isRival ? 'them' : 'us';

    const action = {
      skill,
      team,
      playerId: null,
      rivalPlayerId: null,
      zone,
      result: null,
      inferredSkill: inferred,
    };
    if (team === 'us') {
      action.playerId = skill === 'saque' && ctx.serving === 'us' && !g.items.some((x) => ['player', 'role', 'number'].includes(x.type))
        ? ctx.serverId ?? null
        : resolvePlayer(g.items, skill, ctx);
      action.result = skill === 'free' ? 'free' : mapResult(skill, rawResult);
    } else {
      action.rivalPlayerId = g.items.find((x) => x.type === 'number' && x.theirs)?.theirs ?? null;
      action.result = rawResult === 'punto' ? 'punto' : rawResult === 'error' ? 'error' : null;
    }
    if (!skill) action.skill = null;
    actions.push(action);
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
