// Enrutado por hash (compatible con GitHub Pages, sin servidor).
import { renderHome } from './views/home.js';
import { renderTeam } from './views/team.js';
import { renderNewMatch, renderMatch } from './views/match.js';
import { renderStats } from './views/stats.js';
import { renderData } from './views/data.js';
import { renderClubBar } from './views/clubs.js';
import { showHelp } from './help.js';
import { renderVoiceReview } from './views/voice-review.js';
import { startQueue } from './voice/queue.js';
import { releaseMic } from './voice/recorder.js';
import { renderJoin } from './views/sync-ui.js';
import { requestSync } from './sync.js';

const routes = [
  { pattern: /^\/$/, view: renderHome, tab: 'partidos' },
  { pattern: /^\/equipo$/, view: renderTeam, tab: 'equipo' },
  { pattern: /^\/partido\/nuevo$/, view: renderNewMatch, tab: 'partidos' },
  { pattern: /^\/partido\/(?<id>[\w-]+)\/voz$/, view: renderVoiceReview, tab: 'partidos' },
  { pattern: /^\/partido\/(?<id>[\w-]+)$/, view: renderMatch, tab: 'partidos', live: true },
  { pattern: /^\/estadisticas$/, view: renderStats, tab: 'estadisticas' },
  { pattern: /^\/datos$/, view: renderData, tab: 'datos' },
  { pattern: /^\/unirse$/, view: renderJoin, tab: 'partidos' },
];

const main = document.getElementById('app');

function router() {
  const hash = location.hash.slice(1) || '/';
  const [path, qs = ''] = hash.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  const route = routes.find((r) => r.pattern.test(path)) ?? routes[0];
  const params = { ...(path.match(route.pattern)?.groups ?? {}), query };

  document.querySelectorAll('.tabbar a').forEach((a) =>
    a.classList.toggle('active', a.dataset.tab === route.tab),
  );
  document.body.classList.toggle('is-live', Boolean(route.live));
  // Fuera del partido en directo se libera el micrófono.
  if (!route.live) releaseMic();
  document.getElementById('sheet-root').hidden = true;
  renderClubBar(document.getElementById('club-bar'), onClubChange);
  route.view(main, params);
  window.scrollTo(0, 0);
}

// Al cambiar de club se vuelve al inicio (un partido abierto sería de otro club).
function onClubChange() {
  if (location.hash === '#/' || location.hash === '' || location.hash === '#/equipo') router();
  else location.hash = '#/';
}

// Botones «?» de ayuda en cualquier pantalla.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-help]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  showHelp(btn.dataset.help);
}, true);

window.addEventListener('hashchange', router);
router();

// ---------- Servidor del club ----------
// Al abrir, al volver a la app y al recuperar la conexión. Al terminar, se refresca lo que se ve
// (salvo en pleno partido, para no molestar mientras se registra).
let lastAuto = 0;
const autoSync = () => {
  if (Date.now() - lastAuto < 60_000) return;
  lastAuto = Date.now();
  requestSync();
};
autoSync();
window.addEventListener('online', () => requestSync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoSync(); });
window.addEventListener('voley-sync', (e) => {
  renderClubBar(document.getElementById('club-bar'), onClubChange);
  const s = e.detail;
  const changed = s && !s.started && (s.pulled || s.deleted || s.conflicts);
  if (changed && !document.body.classList.contains('is-live') && document.getElementById('sheet-root').hidden) router();
});
// Cola de transcripción en segundo plano (registro por voz).
startQueue();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW no registrado', err));
}
