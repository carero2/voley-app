// Cola en segundo plano: audio → texto (Groq) → plantilla (analizador) → acciones en el partido.
// El marcador y la rotación nunca esperan a la cola: si no hay conexión, los audios esperan y se reintentan.

import { getData, matchById, setVoice, applyVoice, rallyContext, playerById, rivalPlayers } from '../store.js';
import { courtLayout, isFront } from '../rally.js';
import { parse } from './parser.js';
import { getAudio, audioId } from './db.js';
import { transcribe, hasTranscriber } from './transcribe.js';

const listeners = new Set();
let busy = false;
let timer = null;

export const onVoiceChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach((fn) => { try { fn(); } catch { /* vista ya cerrada */ } });

export function startQueue() {
  if (timer) return;
  timer = setInterval(tick, 4000);
  window.addEventListener('online', tick);
  tick();
}
export const kickQueue = () => setTimeout(tick, 50);

// Contexto del punto para el analizador: plantilla, quién estaba en pista y en qué puesto, quién sacaba.
export function buildContext(match, meta) {
  const ctx = rallyContext(match, meta.set, meta.rally);
  const players = match.roster.map(playerById).filter(Boolean);
  const base = { players, onCourt: [], rivals: rivalPlayers(match.opponent), serving: 'us', serverId: null, pointTo: null };
  if (!ctx?.st.setup) return base;
  const layout = courtLayout(ctx.st);
  return {
    ...base,
    onCourt: layout.map((c) => ({
      playerId: c.playerId,
      zone: c.zone,
      front: isFront(c.zone),
      role: playerById(c.playerId)?.position ?? null,
    })),
    serving: ctx.st.serving,
    serverId: ctx.st.serving === 'us' ? layout[0].playerId : null,
    pointTo: ctx.closing.point,
  };
}

// Vocabulario para orientar a Whisper (mejora nombres y términos de voleibol).
export function buildPrompt(match) {
  const names = match.roster.map(playerById).filter(Boolean).map((p) => `${p.name} ${p.number}`).join(', ');
  return `Voleibol. Saque, recepción, colocación, ataque, bloqueo, defensa, free, apoyo, blockout, zona, punta, opuesto, central, líbero, colocador, rival. Jugadores: ${names}.`;
}

// Analiza (o vuelve a analizar) el texto de un punto y lo aplica al partido.
export function processText(matchId, key, text) {
  const match = matchById(matchId);
  const meta = match?.voice?.[key];
  if (!meta) return null;
  const ctx = buildContext(match, meta);
  const result = parse(text ?? meta.transcript ?? '', ctx);
  // Si sacábamos y no se dijo nada del saque, se registra el saque en juego del sacador.
  if (ctx.serving === 'us' && ctx.serverId && !result.actions.some((a) => a.skill === 'saque' && a.team === 'us')) {
    result.actions.unshift({ skill: 'saque', team: 'us', playerId: ctx.serverId, result: 'enjuego', zone: null, inferredSkill: true, auto: true });
  }
  setVoice(matchId, key, {
    transcript: text ?? meta.transcript ?? '',
    actions: result.actions,
    unknown: result.unknown,
    cause: result.cause,
    status: 'parsed',
    error: null,
  });
  applyVoice(matchId, key);
  notify();
  return match.voice[key];
}

// Siguiente punto pendiente de transcribir en el club activo.
function nextPending() {
  const now = Date.now();
  for (const m of getData().matches) {
    for (const [key, meta] of Object.entries(m.voice || {})) {
      if (meta.status === 'recorded' || (meta.status === 'error' && (meta.retryAt ?? 0) <= now && (meta.attempts ?? 0) < 6)) {
        return { match: m, key, meta };
      }
    }
  }
  return null;
}

async function tick() {
  if (busy || !navigator.onLine || !hasTranscriber()) return;
  const item = nextPending();
  if (!item) return;
  busy = true;
  const { match, key, meta } = item;
  try {
    setVoice(match.id, key, { status: 'transcribing' });
    notify();
    const blob = await getAudio(audioId(match.id, key));
    if (!blob) {
      setVoice(match.id, key, { status: 'noaudio' });
    } else {
      const text = await transcribe(blob, buildPrompt(match));
      processText(match.id, key, text);
    }
  } catch (err) {
    const attempts = (meta.attempts ?? 0) + 1;
    // Reintentos con espera creciente (8 s, 16 s, 32 s…); una clave inválida no se reintenta sola.
    setVoice(match.id, key, {
      status: 'error',
      error: err.message,
      attempts: err.status === 401 ? 6 : attempts,
      retryAt: Date.now() + 8000 * 2 ** (attempts - 1),
    });
  } finally {
    busy = false;
    notify();
    if (nextPending()) kickQueue();
  }
}

// Resumen para mostrar en directo.
export function voiceSummary(match) {
  const s = { total: 0, recording: 0, pending: 0, done: 0, error: 0, noaudio: 0 };
  for (const meta of Object.values(match.voice || {})) {
    s.total++;
    if (meta.status === 'recording') s.recording++;
    else if (meta.status === 'recorded' || meta.status === 'transcribing') s.pending++;
    else if (meta.status === 'applied' || meta.status === 'parsed') s.done++;
    else if (meta.status === 'error') s.error++;
    else if (meta.status === 'noaudio') s.noaudio++;
  }
  return s;
}
