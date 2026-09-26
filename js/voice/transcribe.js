// Voz → texto. Proveedor principal: Groq (Whisper large v3 turbo), llamado directamente
// desde el móvil con la clave gratuita del usuario. No usa Cloudflare ni servidor propio.
// La clave se guarda solo en este dispositivo y no se incluye en las copias de seguridad.

const SETTINGS_KEY = 'voley-app:voz';
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3-turbo';

export function voiceSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveVoiceSettings(patch) {
  const next = { ...voiceSettings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
  return next;
}

export const hasTranscriber = () => Boolean(voiceSettings().groqKey);

const extFor = (type) => (type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm');

// `prompt` orienta a Whisper con el vocabulario y los nombres de la plantilla.
export async function transcribe(blob, prompt = '') {
  const { groqKey } = voiceSettings();
  if (!groqKey) throw new Error('Falta la clave de Groq (Datos → Registro por voz).');
  const form = new FormData();
  form.append('file', blob, `punto.${extFor(blob.type || '')}`);
  form.append('model', MODEL);
  form.append('language', 'es');
  form.append('temperature', '0');
  form.append('response_format', 'json');
  if (prompt) form.append('prompt', prompt.slice(0, 800));
  const res = await fetch(GROQ_URL, { method: 'POST', headers: { Authorization: `Bearer ${groqKey}` }, body: form });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Groq ${res.status}: ${detail.slice(0, 160)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return (data.text || '').trim();
}

// Comprueba la clave y que el navegador puede llamar a Groq.
export async function testConnection() {
  const { groqKey } = voiceSettings();
  if (!groqKey) return { ok: false, message: 'Introduce primero la clave.' };
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${groqKey}` } });
    if (res.status === 401) return { ok: false, message: 'La clave no es válida.' };
    if (!res.ok) return { ok: false, message: `Groq respondió ${res.status}.` };
    return { ok: true, message: 'Conexión correcta con Groq.' };
  } catch (err) {
    return { ok: false, message: `No se pudo conectar (${err.message}). Revisa la conexión.` };
  }
}
