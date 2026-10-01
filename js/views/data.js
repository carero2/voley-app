// Ajustes: club, servidor, importar/exportar, registro por voz y este dispositivo.
// (La ruta sigue siendo #/datos para no romper enlaces guardados.)
import {
  getData, exportData, importData, resetAll, playerById, clubs, exportClub, importClub, importPlayers,
  exportRivals, importRivals, activePlayers,
} from '../store.js';
import { POSITIONS, positionById, skillById, resultDef } from '../actions.js';
import { html, download, toast, today, openSheet } from '../ui.js';
import { voiceSettings, saveVoiceSettings, testConnection } from '../voice/transcribe.js';
import { audioUsage } from '../voice/db.js';
import { kickQueue } from '../voice/queue.js';
import { syncConfig, syncStatus, isAdmin, userName } from '../sync.js';
import { openSyncSheet } from './sync-ui.js';
import { VERSION } from '../version.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'liga';
const refreshAll = () => window.dispatchEvent(new HashChangeEvent('hashchange')); // también la barra del club

// Cada cosa que se exporta tiene su importación (salvo el informe de acciones para Excel).
const TRANSFERS = [
  {
    id: 'club', title: 'Esta liga', desc: 'Jugadores, rivales y partidos de la liga activa',
    export: (d) => download(`voley-liga-${slug(d.name)}-${today()}.json`, JSON.stringify(exportClub(), null, 2), 'application/json'),
    accept: '.json,application/json',
  },
  {
    id: 'equipo', title: 'Mi plantilla', desc: 'Dorsal, nombre y posición. Se abre y edita en Excel',
    export: (d) => download(`voley-plantilla-${slug(d.team.name)}.csv`, playersCsv(), 'text/csv;charset=utf-8'),
    accept: '.csv,text/csv,text/plain',
  },
  {
    id: 'rivales', title: 'Equipos rivales', desc: 'Las plantillas de los rivales',
    export: (d) => download(`voley-rivales-${slug(d.name)}.json`, JSON.stringify(exportRivals(), null, 2), 'application/json'),
    accept: '.json,application/json',
  },
  {
    id: 'todo', title: 'Copia completa', desc: 'Todas las ligas de este dispositivo',
    export: () => download(`voley-copia-${today()}.json`, JSON.stringify(exportData(), null, 2), 'application/json'),
    accept: '.json,application/json',
  },
];

export function renderData(el, { query = {} } = {}) {
  const d = getData();
  const cfg = syncConfig(d.id);
  const st = syncStatus(d.id);
  const events = d.matches.reduce((n, m) => n + m.events.length, 0);
  const serverValue = !cfg ? 'Sin conectar'
    : !userName(d.id) ? 'Pon tu nombre'
      : st.state === 'error' ? '⚠ Con problemas'
        : st.state === 'pending' ? `${st.pending} sin subir` : 'Conectado';
  const rerender = () => renderData(el);

  el.innerHTML = html`
    <header class="page-head"><h1>Ajustes</h1></header>

    <section class="settings-group">
      <button class="settings-row" id="s-server">
        <span class="s-icon" aria-hidden="true">☁</span>
        <span class="grow">Servidor de la liga<span class="s-sub">${cfg ? `«${d.name}» · ${isAdmin(d.id) ? 'lo administras tú' : `entraste como ${userName(d.id) || 'miembro'}`}` : 'Compartir los partidos con el equipo'}</span></span>
        <span class="s-value ${st.state === 'error' || (cfg && !userName(d.id)) ? 'bad' : ''}">${serverValue}</span>
        <span class="s-chev" aria-hidden="true">›</span>
      </button>
      <button class="settings-row" id="s-transfer">
        <span class="s-icon" aria-hidden="true">⇅</span>
        <span class="grow">Importar y exportar<span class="s-sub">Copias, plantilla (Excel) y rivales</span></span>
        <span class="s-chev" aria-hidden="true">›</span>
      </button>
      <button class="settings-row" id="s-voice">
        <span class="s-icon" aria-hidden="true">🎙</span>
        <span class="grow">Registro por voz<span class="s-sub">Clave de Groq para transcribir</span></span>
        <span class="s-value">${voiceSettings().groqKey ? 'Activado' : 'Sin clave'}</span>
        <span class="s-chev" aria-hidden="true">›</span>
      </button>
    </section>

    <section class="settings-group">
      <div class="settings-row">
        <span class="s-icon" aria-hidden="true">📱</span>
        <span class="grow">Este dispositivo<span class="s-sub" id="s-usage">${plural(clubs().length, 'liga', 'ligas')} · ${plural(events, 'acción', 'acciones')} en «${d.name}»</span></span>
      </div>
      <button class="settings-row" id="s-update">
        <span class="s-icon" aria-hidden="true">⟳</span>
        <span class="grow">Buscar actualización<span class="s-sub">Versión ${VERSION}</span></span>
        <span class="s-chev" aria-hidden="true">›</span>
      </button>
    </section>
    <p class="settings-note">${cfg
      ? 'Los partidos de esta liga se comparten con el equipo a través del servidor.'
      : 'Los datos se guardan solo en este dispositivo: exporta una copia de vez en cuando o conecta el servidor de la liga.'}</p>
  `;

  el.querySelector('#s-server').addEventListener('click', () => openSyncSheet(rerender));
  el.querySelector('#s-transfer').addEventListener('click', () => openTransferSheet(rerender));
  el.querySelector('#s-voice').addEventListener('click', () => openVoiceSheet(rerender));
  el.querySelector('#s-update').addEventListener('click', checkUpdate);
  audioUsage().then(({ bytes, count }) => {
    const info = el.querySelector('#s-usage');
    if (info && count) info.textContent += ` · ${count} audios de voz (${(bytes / 1048576).toFixed(1)} MB)`;
  }).catch(() => {});
  if (query.servidor) {
    history.replaceState(null, '', '#/datos');
    openSyncSheet(rerender);
  }
}

// Busca una versión nueva de la app. Si la hay, se instala y la app se recarga sola (app.js); si no, se
// recarga igualmente sin la copia guardada, por si el móvil se había quedado con archivos viejos.
async function checkUpdate() {
  if (navigator.onLine === false) { toast('Sin conexión: no se puede comprobar ahora'); return; }
  toast('Buscando actualización…');
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    if (reg?.installing || reg?.waiting) {
      reg.waiting?.postMessage('skipWaiting');
      toast('Instalando la versión nueva…');
      setTimeout(() => location.reload(), 2500);
      return;
    }
    const res = await fetch(`./js/version.js?t=${Date.now()}`, { cache: 'no-store' });
    const latest = (await res.text()).match(/VERSION = '([^']+)'/)?.[1];
    if (latest && latest !== VERSION) {
      if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
      location.reload();
      return;
    }
    toast(`Ya tienes la última versión (${VERSION})`);
  } catch {
    toast('Sin conexión: no se puede comprobar ahora');
  }
}

// ---------- Importar y exportar (hoja) ----------

function openTransferSheet(onChange) {
  const d = getData();
  const sheet = openSheet(html`
    <div class="sheet-title"><h2 class="grow">Importar y exportar</h2><button class="btn btn-ghost" data-close aria-label="Cerrar">✕</button></div>
    <div class="settings-group sheet-group">
      ${TRANSFERS.map((t) => html`
        <div class="settings-row">
          <span class="grow">${t.title}<span class="s-sub">${t.desc}</span></span>
          <span class="s-actions">
            <button class="btn btn-small" data-export="${t.id}" aria-label="Exportar ${t.title}">Exportar</button>
            <button class="btn btn-small" data-import="${t.id}" aria-label="Importar ${t.title}">Importar</button>
          </span>
        </div>`)}
      <div class="settings-row">
        <span class="grow">Acciones para Excel<span class="s-sub">Informe para analizar (CSV); no se importa</span></span>
        <span class="s-actions"><button class="btn btn-small" data-export="csv">Exportar</button></span>
      </div>
    </div>
    <p class="small muted">${syncConfig(d.id)
      ? 'Lo que importes en esta liga se comparte con el equipo en la siguiente sincronización. Combinar nunca sobrescribe: solo añade lo que falte.'
      : 'Combinar nunca sobrescribe: solo añade lo que falte.'}</p>
    <input type="file" id="file" hidden />
  `.toString());
  sheet.root.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.export === 'csv') download(`voley-acciones-${today()}.csv`, toCsv(d), 'text/csv;charset=utf-8');
    else TRANSFERS.find((t) => t.id === b.dataset.export).export(d);
  }));
  const fileInput = sheet.root.querySelector('#file');
  let kind = null;
  sheet.root.querySelectorAll('[data-import]').forEach((b) => b.addEventListener('click', () => {
    kind = b.dataset.import;
    fileInput.accept = TRANSFERS.find((t) => t.id === kind).accept;
    fileInput.value = '';
    fileInput.click();
  }));
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    let found;
    try {
      found = detect(await file.text(), file.name);
    } catch (err) {
      alert(`No se pudo leer el archivo: ${err.message}`);
      return;
    }
    sheet.close();
    openImportSheet(kind, found, () => { refreshAll(); onChange?.(); });
  });
}

// ---------- Importar ----------

// Qué tipo de archivo es (para avisar si no es el que se esperaba).
function detect(text, name) {
  const t = text.replace(/^﻿/, '');
  if (/^\s*[[{]/.test(t)) {
    const j = JSON.parse(t);
    if (j.kind === 'voley-app/club' && j.club) return { type: 'club', data: j };
    if (j.kind === 'voley-app/rivales') return { type: 'rivales', data: j };
    if (Array.isArray(j.clubs) || (Array.isArray(j.players) && Array.isArray(j.matches))) return { type: 'todo', data: j };
    throw new Error('el archivo no es una copia de la app.');
  }
  const first = t.split(/\r?\n/)[0].toLowerCase();
  if (first.includes('fundamento')) return { type: 'csv-acciones' };
  if (/dorsal|nombre|name/.test(first) || /\.csv$/i.test(name)) return { type: 'equipo', data: parsePlayersCsv(t) };
  throw new Error('formato no reconocido.');
}

const TYPE_LABEL = { club: 'una liga', equipo: 'una plantilla', rivales: 'equipos rivales', todo: 'una copia completa' };

function openImportSheet(expected, found, done) {
  if (found.type === 'csv-acciones') {
    alert('Ese archivo es el informe de acciones para Excel: sirve para analizar, pero no se puede importar. Para pasar partidos, usa «Esta liga → Exportar».');
    return;
  }
  const note = expected !== found.type ? html`<p class="small sync-error">Esperaba ${TYPE_LABEL[expected]}, pero el archivo es ${TYPE_LABEL[found.type]}. Se importará como ${TYPE_LABEL[found.type]}.</p>` : '';
  const d = getData();
  let body;
  if (found.type === 'club') {
    const c = found.data.club;
    body = html`
      <p>Liga <b>${c.name}</b> · ${c.team?.name ?? ''}: ${plural((c.players || []).length, 'jugador', 'jugadores')}, ${plural((c.matches || []).length, 'partido', 'partidos')}, ${plural(Object.keys(c.rivals || {}).length, 'rival', 'rivales')}.</p>
      <div class="stack">
        <button class="btn btn-primary btn-block" data-do="new">${clubs().some((x) => x.id === c.id) ? 'Completar la liga que ya tienes' : 'Añadir como liga nueva'}</button>
        <button class="btn btn-block" data-do="merge">Juntar con «${d.name}»</button>
      </div>
      <p class="small muted">Nunca se borra nada: solo se añade lo que falte.</p>`;
  } else if (found.type === 'equipo') {
    const list = found.data;
    if (!list.length) { alert('El archivo no tiene jugadores (columnas: dorsal; nombre; posición).'); return; }
    body = html`
      <p>Plantilla con ${plural(list.length, 'jugador', 'jugadores')}: ${list.slice(0, 6).map((p) => `${p.number} ${p.name}`).join(', ')}${list.length > 6 ? '…' : ''}</p>
      <div class="stack">
        <button class="btn btn-primary btn-block" data-do="merge">Añadir y actualizar en «${d.team.name}»</button>
        <button class="btn btn-block" data-do="replace">Sustituir la plantilla</button>
      </div>
      <p class="small muted">Se casan por dorsal. «Sustituir» retira a los que no vienen en el archivo (los que ya tienen estadísticas se archivan, no se borran).</p>`;
  } else if (found.type === 'rivales') {
    const teams = Object.values(found.data.rivals || {});
    body = html`
      <p>${plural(teams.length, 'equipo rival', 'equipos rivales')}: ${teams.map((r) => r.name).slice(0, 6).join(', ')}${teams.length > 6 ? '…' : ''}</p>
      <div class="stack"><button class="btn btn-primary btn-block" data-do="merge">Añadir a «${d.name}»</button></div>
      <p class="small muted">Si un rival ya existe, se actualiza su plantilla.</p>`;
  } else {
    const n = found.data.clubs?.length ?? 1;
    body = html`
      <p>Copia completa con ${plural(n, 'liga', 'ligas')}.</p>
      <div class="stack">
        <button class="btn btn-primary btn-block" data-do="merge">Combinar con lo que hay</button>
        <button class="btn btn-danger btn-block" data-do="replace">Reemplazar todo este dispositivo</button>
      </div>
      <p class="small muted">«Combinar» añade ligas, jugadores y partidos que falten. «Reemplazar» borra lo de este dispositivo (el servidor de la liga no se toca).</p>`;
  }
  const sheet = openSheet(html`
    <div class="sheet-title"><h2 class="grow">Importar</h2><button class="btn btn-ghost" data-close aria-label="Cerrar">✕</button></div>
    ${note}${body}
  `.toString());
  sheet.root.querySelectorAll('[data-do]').forEach((b) => b.addEventListener('click', () => {
    const how = b.dataset.do;
    let msg;
    if (found.type === 'club') {
      const c = importClub(found.data, how);
      msg = how === 'merge' ? `Juntado con «${c.name}»` : `Liga «${c.name}» importada`;
    } else if (found.type === 'equipo') {
      if (how === 'replace' && !confirm('¿Sustituir la plantilla por la del archivo?')) return;
      const r = importPlayers(found.data, how);
      msg = `Plantilla: ${r.added} nuevos, ${r.updated} actualizados${r.archived ? `, ${r.archived} retirados` : ''}`;
    } else if (found.type === 'rivales') {
      msg = plural(importRivals(found.data), 'rival importado', 'rivales importados');
    } else {
      if (how === 'replace' && !confirm('Se borrarán los datos de este dispositivo y se sustituirán por los del archivo. ¿Continuar?')) return;
      importData(found.data, how);
      msg = 'Copia importada';
    }
    sheet.close();
    toast(msg);
    done();
  }));
}

// ---------- Plantilla en CSV (Excel) ----------

function playersCsv() {
  const rows = [['dorsal', 'nombre', 'posicion'], ...activePlayers().map((p) => [p.number, p.name, positionById(p.position)?.label ?? ''])];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export function parsePlayersCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = [';', '\t', ','].find((c) => lines[0].includes(c)) ?? ';';
  const split = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };
  let rows = lines.map(split);
  let iNum = 0;
  let iName = 1;
  let iPos = 2;
  const head = rows[0].map(plain);
  if (head.some((h) => /dorsal|nombre|name|numero|posicion|jugador/.test(h))) {
    iNum = head.findIndex((h) => /dorsal|numero|number/.test(h));
    iName = head.findIndex((h) => /nombre|name|jugador/.test(h));
    iPos = head.findIndex((h) => /posicion|position|puesto/.test(h));
    rows = rows.slice(1);
  }
  const posOf = (v) => {
    const x = plain(v);
    if (!x) return null;
    return POSITIONS.find((p) => plain(p.label) === x || p.id === x || plain(p.short) === x)?.id
      ?? (x.startsWith('col') ? 'colocador' : x.startsWith('op') ? 'opuesto' : x.startsWith('cen') ? 'central' : x.startsWith('lib') ? 'libero' : 'receptor');
  };
  return rows
    .map((r) => ({ number: iNum >= 0 ? r[iNum] ?? '' : '', name: iName >= 0 ? r[iName] ?? '' : '', position: iPos >= 0 ? posOf(r[iPos]) : null }))
    .filter((p) => p.name);
}

// ---------- Registro por voz ----------

function openVoiceSheet(onChange) {
  const sheet = openSheet(html`
    <div class="sheet-title"><h2 class="grow">Registro por voz</h2><button class="btn btn-ghost" data-close aria-label="Cerrar">✕</button></div>
    <p class="small muted">La transcripción usa <b>Groq</b> (Whisper), gratis hasta unas 8 horas de audio al día.
      Crea una clave gratuita en <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a> y pégala aquí.
      Se guarda <b>solo en este dispositivo</b> y no se incluye en las copias.</p>
    <form id="voice-form" class="stack">
      <label class="field"><span>Clave de Groq</span>
        <input name="groqKey" type="password" autocomplete="off" placeholder="gsk_…" value="${voiceSettings().groqKey ?? ''}" /></label>
      <div class="form-actions">
        <button type="button" class="btn" id="voice-test">Probar conexión</button>
        <button type="submit" class="btn btn-primary">Guardar</button>
      </div>
      <p class="small muted" id="voice-info"></p>
    </form>
  `.toString());
  sheet.root.querySelector('#voice-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveVoiceSettings({ groqKey: e.target.groqKey.value.trim() });
    kickQueue();
    sheet.close();
    toast('Clave guardada');
    onChange?.();
  });
  sheet.root.querySelector('#voice-test').addEventListener('click', async () => {
    const info = sheet.root.querySelector('#voice-info');
    saveVoiceSettings({ groqKey: sheet.root.querySelector('[name=groqKey]').value.trim() });
    info.textContent = 'Probando…';
    info.textContent = (await testConnection()).message;
  });
}

// ---------- Informe de acciones para Excel ----------

function toCsv(d) {
  const header = ['fecha', 'rival', 'set', 'dorsal', 'jugador', 'posicion', 'fundamento', 'resultado', 'punto_para'];
  const rows = [header];
  for (const m of d.matches) {
    for (const e of m.events) {
      const p = e.playerId ? playerById(e.playerId) : null;
      rows.push([
        m.date, m.opponent, e.set,
        p?.number ?? '', p?.name ?? '', p ? positionById(p.position)?.label ?? '' : '',
        e.skill === 'rival' ? 'Rival' : skillById(e.skill)?.label ?? e.skill,
        resultDef(e.skill, e.result)?.label ?? e.result,
        e.point === 'us' ? d.team.name : e.point === 'them' ? m.opponent : '',
      ]);
    }
  }
  const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
  // BOM para que Excel detecte UTF-8; «;» como separador (Excel en español).
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

// ---------- Herramientas avanzadas (#/avanzado) ----------
// Sin enlace desde la app: análisis de vídeo (pruebas) y borrar este dispositivo.
export function renderAdvanced(el) {
  el.innerHTML = html`
    <header class="page-head"><h1>Herramientas avanzadas</h1>
      <p class="muted small">Página sin enlace desde la app.</p></header>

    <h2 class="settings-title">Análisis de vídeo (pruebas)</h2>
    <section class="settings-group">
      <a class="settings-row" href="video/etiquetar/" target="_blank" rel="noopener">
        <span class="grow">Etiquetar puntos de un vídeo<span class="s-sub">Se abre en este dispositivo; el vídeo no se sube</span></span><span class="s-chev" aria-hidden="true">›</span></a>
      <a class="settings-row" href="https://colab.research.google.com/github/carero2/voley-app/blob/claude/volleyball-stats-github-pages-cf7xwk/video/notebooks/prueba_colab.ipynb" target="_blank" rel="noopener">
        <span class="grow">Cuaderno de análisis en Google Colab</span><span class="s-chev" aria-hidden="true">›</span></a>
    </section>

    <h2 class="settings-title">Borrar este dispositivo</h2>
    <section class="settings-group">
      <div class="settings-row">
        <span class="grow">Borrar todas las ligas de este dispositivo<span class="s-sub">El servidor de la liga no se toca</span></span>
        <button class="btn btn-small btn-danger" id="reset">Borrar</button>
      </div>
    </section>
  `;
  el.querySelector('#reset').addEventListener('click', () => {
    if (prompt('Se borrarán TODAS las ligas de este dispositivo (el servidor no se toca). Escribe BORRAR para confirmar:') !== 'BORRAR') return;
    resetAll();
    toast('Datos borrados');
    location.hash = '#/';
  });
}
