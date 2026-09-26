import { getData, exportData, importData, resetAll, playerById, clubs } from '../store.js';
import { positionById, skillById, resultDef } from '../actions.js';
import { html, download, toast, today } from '../ui.js';
import { voiceSettings, saveVoiceSettings, testConnection } from '../voice/transcribe.js';
import { audioUsage } from '../voice/db.js';
import { kickQueue } from '../voice/queue.js';

export function renderData(el) {
  const d = getData();
  const events = d.matches.reduce((n, m) => n + m.events.length, 0);

  el.innerHTML = html`
    <header class="page-head"><h1>Datos</h1></header>

    <section class="card">
      <p>Los datos se guardan <b>solo en este dispositivo</b>. Exporta una copia después de cada partido.</p>
      <p class="muted small">Club «${d.name}»: ${d.players.length} jugadores · ${d.matches.length} partidos · ${events} acciones</p>
      <p class="muted small">${clubs().length} ${clubs().length === 1 ? 'club' : 'clubes'} en este dispositivo.</p>
    </section>

    <section class="card stack">
      <h2>Exportar</h2>
      <button class="btn btn-primary btn-block" id="export-json">Descargar copia de todos los clubes (JSON)</button>
      <button class="btn btn-block" id="export-csv">Descargar acciones de este club (CSV para Excel)</button>
    </section>

    <section class="card stack">
      <h2>Registro por voz</h2>
      <p class="small muted">La transcripción usa <b>Groq</b> (Whisper), gratis hasta unas 8 horas de audio al día.
        Crea una clave gratuita en <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a> y pégala aquí.
        Se guarda <b>solo en este dispositivo</b> y no se incluye en las copias.</p>
      <form id="voice-form" class="form-inline">
        <label class="field grow">
          <span>Clave de Groq</span>
          <input name="groqKey" type="password" autocomplete="off" placeholder="gsk_…" value="${voiceSettings().groqKey ?? ''}" />
        </label>
        <button class="btn" type="submit">Guardar</button>
      </form>
      <div class="form-actions">
        <button class="btn" id="voice-test">Probar conexión</button>
      </div>
      <p class="small muted" id="voice-info"></p>
    </section>

    <section class="card stack">
      <h2>Importar</h2>
      <p class="muted small">Carga una copia JSON. «Combinar» añade los clubes, jugadores y partidos que no tengas; «Reemplazar» borra todo lo actual. Una copia antigua (de antes de los clubes) se carga en el club activo.</p>
      <input type="file" id="file" accept="application/json,.json" hidden />
      <div class="form-actions">
        <button class="btn" data-import="merge">Combinar</button>
        <button class="btn btn-danger" data-import="replace">Reemplazar</button>
      </div>
    </section>

    <section class="card stack">
      <h2>Zona peligrosa</h2>
      <button class="btn btn-danger btn-block" id="reset">Borrar todos los datos (todos los clubes)</button>
    </section>
  `;

  el.querySelector('#voice-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveVoiceSettings({ groqKey: e.target.groqKey.value.trim() });
    toast('Clave guardada');
    kickQueue();
  });
  el.querySelector('#voice-test').addEventListener('click', async () => {
    const info = el.querySelector('#voice-info');
    info.textContent = 'Probando…';
    const r = await testConnection();
    info.textContent = r.message;
  });
  audioUsage().then(({ bytes, count }) => {
    const info = el.querySelector('#voice-info');
    if (info && !info.textContent) info.textContent = `Audios guardados: ${count} (${(bytes / 1048576).toFixed(1)} MB).`;
  }).catch(() => {});

  el.querySelector('#export-json').addEventListener('click', () => {
    download(`voley-${today()}.json`, JSON.stringify(exportData(), null, 2), 'application/json');
  });
  el.querySelector('#export-csv').addEventListener('click', () => {
    download(`voley-acciones-${today()}.csv`, toCsv(d), 'text/csv;charset=utf-8');
  });

  const fileInput = el.querySelector('#file');
  let mode = 'merge';
  el.querySelectorAll('[data-import]').forEach((b) =>
    b.addEventListener('click', () => {
      mode = b.dataset.import;
      fileInput.value = '';
      fileInput.click();
    }),
  );
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (mode === 'replace' && !confirm('Se borrarán los datos actuales y se sustituirán por los del archivo. ¿Continuar?')) return;
    try {
      importData(JSON.parse(await file.text()), mode);
      toast('Datos importados');
      window.dispatchEvent(new HashChangeEvent('hashchange')); // refresca también la barra del club
    } catch (err) {
      alert(`No se pudo importar: ${err.message}`);
    }
  });

  el.querySelector('#reset').addEventListener('click', () => {
    if (!confirm('¿Seguro que quieres borrar TODOS los datos de TODOS los clubes? Exporta antes una copia.')) return;
    resetAll();
    toast('Datos borrados');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

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
