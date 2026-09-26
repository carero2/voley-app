// Grabación de audio por punto. El micrófono se abre una vez y se reutiliza durante el partido.

let stream = null;
let recorder = null;
let chunks = [];
let pendingStop = null; // parada diferida (cola de unos segundos para terminar la frase)
let wakeLock = null;
let startedAt = 0;

function pickMime() {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return options.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) ?? '';
}

export const isSupported = () => Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
export const isRecording = () => recorder?.state === 'recording' && !pendingStop;
export const recordingSeconds = () => (isRecording() ? Math.floor((Date.now() - startedAt) / 1000) : 0);

async function ensureMic() {
  if (stream && stream.getAudioTracks().some((t) => t.readyState === 'live')) return stream;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  return stream;
}

// Mantiene la pantalla encendida (si se bloquea, el navegador corta la grabación).
export async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* no soportado o denegado */ }
}

function finish() {
  return new Promise((resolve) => {
    const rec = recorder;
    if (!rec || rec.state === 'inactive') return resolve(null);
    rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || 'audio/webm' }) : null);
    rec.stop();
  });
}

export async function startRecording() {
  await ensureMic();
  // Si aún se estaba cerrando la grabación anterior, se termina ya (y se guarda).
  if (pendingStop) await pendingStop.flush();
  chunks = [];
  const mimeType = pickMime();
  recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 24000 });
  recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  recorder.start(1000);
  startedAt = Date.now();
  keepAwake();
}

// Para la grabación tras `tailMs` (para no cortar la última palabra). Devuelve el audio.
export function stopRecording(tailMs = 2500) {
  if (!recorder || recorder.state !== 'recording') return Promise.resolve(null);
  return new Promise((resolve) => {
    let timer;
    const done = async () => {
      clearTimeout(timer);
      if (!pendingStop) return;
      pendingStop = null;
      resolve(await finish());
    };
    timer = setTimeout(done, tailMs);
    pendingStop = { flush: done };
  });
}

export async function cancelRecording() {
  if (pendingStop) { pendingStop = null; }
  if (recorder && recorder.state !== 'inactive') {
    recorder.onstop = null;
    recorder.stop();
  }
  chunks = [];
}

export function releaseMic() {
  if (recorder && recorder.state !== 'inactive' && !pendingStop) cancelRecording();
  if (!pendingStop && stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}
