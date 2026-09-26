// Revisión del registro por voz: audio, texto, plantilla y corrección de cada punto.
import { matchById, playerById, rivalPlayerById, setVoice, applyVoice } from '../store.js';
import { SKILLS, activeResults, skillById } from '../actions.js';
import { missingFields, deriveCause } from '../voice/parser.js';
import { processText, onVoiceChange, kickQueue } from '../voice/queue.js';
import { getAudio, audioId } from '../voice/db.js';
import { hasTranscriber } from '../voice/transcribe.js';
import { html, openSheet, toast, download, today } from '../ui.js';

const STATUS = {
  recording: 'Grabando', recorded: 'En cola', transcribing: 'Transcribiendo', parsed: 'Analizado',
  applied: 'Listo', error: 'Error', noaudio: 'Sin audio',
};
const SKILL_LABEL = { ...Object.fromEntries(SKILLS.map((s) => [s.id, s.label])), free: 'FREE', apoyo: 'Apoyo' };
const EDIT_SKILLS = ['saque', 'recepcion', 'colocacion', 'ataque', 'bloqueo', 'defensa', 'apoyo', 'free'];

let unsub = null;

export function renderVoiceReview(el, { id }) {
  unsub?.();
  const match = matchById(id);
  if (!match) {
    el.innerHTML = html`<p class="center muted">Partido no encontrado. <a href="#/">Volver</a></p>`;
    return;
  }
  const rerender = () => renderVoiceReview(el, { id });
  const rallies = Object.entries(match.voice || {}).sort((a, b) => a[1].set - b[1].set || a[1].rally - b[1].rally);
  const stats = lossStats(rallies.map(([, m]) => m));

  el.innerHTML = html`
    <header class="page-head with-back">
      <a class="back" href="#/partido/${match.id}" aria-label="Volver">‹</a>
      <h1>Revisión de voz</h1>
    </header>

    <section class="card">
      <p><b>${rallies.length}</b> puntos con registro de voz · <b>${stats.actions}</b> acciones entendidas</p>
      <p class="small muted">Acciones completas (acción + jugador + resultado): <b>${stats.pctComplete}</b> ·
        palabras no reconocidas: <b>${stats.unknown}</b></p>
      ${hasTranscriber() ? '' : html`<p class="small">Para transcribir los audios configura la clave en <a href="#/datos">Datos → Registro por voz</a>. Mientras, puedes escribir el texto de cada punto.</p>`}
      <div class="form-actions">
        <button class="btn" id="retry">Reintentar pendientes</button>
        <button class="btn" id="export">Exportar plantillas (JSON)</button>
      </div>
    </section>

    ${rallies.length === 0 ? html`<p class="center muted">Todavía no hay puntos dictados en este partido.</p>` : ''}

    <section class="list">
      ${rallies.slice().reverse().map(([key, m]) => rallyCard(match, key, m))}
    </section>
  `;

  el.querySelector('#retry').addEventListener('click', () => {
    Object.entries(match.voice || {}).forEach(([key, m]) => {
      if (m.status === 'error') setVoice(match.id, key, { status: 'recorded', attempts: 0, retryAt: 0 });
    });
    kickQueue();
    toast('Reintentando…');
    rerender();
  });
  el.querySelector('#export').addEventListener('click', () => {
    const out = rallies.map(([key, m]) => ({ key, ...m, actions: (m.actions || []).map((a) => ({ ...a, missing: missingFields(a) })) }));
    download(`voz-${match.opponent}-${today()}.json`, JSON.stringify(out, null, 2), 'application/json');
  });

  el.querySelectorAll('[data-listen]').forEach((b) => b.addEventListener('click', async () => {
    const blob = await getAudio(audioId(match.id, b.dataset.listen)).catch(() => null);
    if (!blob) return toast('No hay audio guardado para este punto');
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = URL.createObjectURL(blob);
    b.replaceWith(audio);
    audio.play().catch(() => {});
  }));
  el.querySelectorAll('[data-analyze]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.analyze;
    const text = el.querySelector(`textarea[data-key="${key}"]`).value;
    processText(match.id, key, text);
    toast('Punto analizado');
    rerender();
  }));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editActions(match, b.dataset.edit, rerender)));

  unsub = onVoiceChange(() => {
    if (!location.hash.endsWith('/voz')) return unsub?.();
    // Solo se refresca si no se está escribiendo en un texto.
    if (!el.contains(document.activeElement) || document.activeElement.tagName !== 'TEXTAREA') rerender();
  });
}

function rallyCard(match, key, m) {
  const closing = match.events.find((e) => e.set === m.set && e.rally === m.rally && e.point);
  return html`
    <article class="card voice-card">
      <div class="voice-head">
        <b>Set ${m.set} · Punto ${m.rally}</b>
        <span class="muted small">${closing ? (closing.point === 'us' ? 'Punto propio' : 'Punto rival') : ''}</span>
        <span class="voice-chip st-${m.status}">${STATUS[m.status] ?? m.status}</span>
      </div>
      ${m.error ? html`<p class="small error-text">${m.error}</p>` : ''}
      ${m.size ? html`<button class="btn btn-small" data-listen="${key}">▶ Escuchar</button>` : ''}
      <textarea data-key="${key}" rows="2" placeholder="Texto del punto (se rellena al transcribir o puedes escribirlo)">${m.transcript ?? ''}</textarea>
      <div class="template">
        ${(m.actions || []).length === 0 ? html`<p class="muted small">Sin acciones todavía.</p>` : ''}
        ${(m.actions || []).map((a) => templateLine(match, a))}
      </div>
      ${m.unknown?.length ? html`<p class="small muted">No reconocido: ${m.unknown.join(', ')}</p>` : ''}
      <div class="form-actions">
        <button class="btn btn-small" data-analyze="${key}">Analizar texto</button>
        <button class="btn btn-small btn-primary" data-edit="${key}">Corregir</button>
      </div>
    </article>
  `;
}

function who(match, a) {
  if (a.team === 'them') {
    const r = a.rivalPlayerId ? rivalPlayerById(match.opponent, a.rivalPlayerId) : null;
    return r ? `Rival ${r.number}` : 'Rival';
  }
  const p = a.playerId ? playerById(a.playerId) : null;
  return p ? `${p.name} (${p.number})` : null;
}

function templateLine(match, a) {
  const miss = missingFields(a);
  const resultLabel = a.result ? (skillById(a.skill === 'apoyo' ? 'defensa' : a.skill)?.results.find((r) => r.id === a.result)?.label ?? a.result) : null;
  const name = who(match, a);
  return html`
    <div class="template-line ${miss.length ? 'incomplete' : ''}">
      <span class="t-skill">${a.team === 'them' ? `${SKILL_LABEL[a.skill] ?? a.skill} rival` : SKILL_LABEL[a.skill] ?? '¿Acción?'}${a.auto ? ' (auto)' : ''}:</span>
      <span>${name ?? html`<i class="muted">¿jugador?</i>`}${a.zone ? ` · zona ${a.zone}` : ''}${resultLabel ? ` · ${resultLabel}` : a.team === 'us' && a.skill !== 'free' ? html` · <i class="muted">¿resultado?</i>` : ''}</span>
    </div>
  `;
}

// Métrica de información perdida (para mejorar el analizador y la forma de dictar).
function lossStats(metas) {
  let actions = 0;
  let complete = 0;
  let unknown = 0;
  for (const m of metas) {
    for (const a of m.actions || []) {
      if (a.auto) continue;
      actions++;
      if (!missingFields(a).length) complete++;
    }
    unknown += m.unknown?.length ?? 0;
  }
  return { actions, unknown, pctComplete: actions ? `${Math.round((complete / actions) * 100)}%` : '–' };
}

// Editor de las acciones de un punto.
function editActions(match, key, done) {
  const meta = match.voice[key];
  let rows = (meta.actions || []).map((a) => ({ ...a }));
  const players = match.roster.map(playerById).filter(Boolean);

  const draw = () => {
    const sheet = openSheet(html`
      <div class="sheet-title">
        <h2 class="grow">Set ${meta.set} · Punto ${meta.rally}</h2>
        <button class="btn btn-ghost" data-close aria-label="Cerrar">✕</button>
      </div>
      ${meta.transcript ? html`<p class="small muted">«${meta.transcript}»</p>` : ''}
      <form id="actions-form" class="stack">
        ${rows.map((a, i) => {
          const skillDef = skillById(a.skill === 'apoyo' ? 'defensa' : a.skill);
          const results = a.team === 'them' ? [{ id: 'punto', label: 'Punto' }, { id: 'error', label: 'Error' }] : skillDef ? activeResults(skillDef) : [];
          return html`
            <div class="action-row">
              <select data-i="${i}" data-f="team">
                <option value="us" ${a.team !== 'them' ? 'selected' : ''}>Nosotros</option>
                <option value="them" ${a.team === 'them' ? 'selected' : ''}>Rival</option>
              </select>
              <select data-i="${i}" data-f="skill">
                ${EDIT_SKILLS.map((sk) => html`<option value="${sk}" ${sk === a.skill ? 'selected' : ''}>${SKILL_LABEL[sk]}</option>`)}
              </select>
              ${a.team === 'them' ? '' : html`
                <select data-i="${i}" data-f="playerId">
                  <option value="">¿Jugador?</option>
                  ${players.map((p) => html`<option value="${p.id}" ${p.id === a.playerId ? 'selected' : ''}>${p.number} ${p.name}</option>`)}
                </select>`}
              <select data-i="${i}" data-f="result">
                <option value="">¿Resultado?</option>
                ${results.map((r) => html`<option value="${r.id}" ${r.id === a.result ? 'selected' : ''}>${r.label}</option>`)}
              </select>
              <select data-i="${i}" data-f="zone">
                <option value="">Zona</option>
                ${[1, 2, 3, 4, 5, 6].map((z) => html`<option value="${z}" ${z === a.zone ? 'selected' : ''}>Z${z}</option>`)}
              </select>
              <button type="button" class="btn btn-ghost" data-remove="${i}" aria-label="Quitar">✕</button>
            </div>`;
        })}
        <button type="button" class="btn" id="add-action">＋ Añadir acción</button>
        <div class="form-actions">
          <button type="button" class="btn" data-close>Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `.toString());
    const form = sheet.root.querySelector('#actions-form');
    const read = () => form.querySelectorAll('select[data-i]').forEach((s) => {
      const row = rows[Number(s.dataset.i)];
      const v = s.value || null;
      row[s.dataset.f] = s.dataset.f === 'zone' && v ? Number(v) : v;
    });
    const redraw = () => { read(); sheet.close(); draw(); };
    // Al cambiar equipo o acción, las opciones de resultado cambian.
    form.querySelectorAll('select[data-f="team"], select[data-f="skill"]').forEach((s) => s.addEventListener('change', redraw));
    form.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => { read(); rows.splice(Number(b.dataset.remove), 1); sheet.close(); draw(); }));
    sheet.root.querySelector('#add-action').addEventListener('click', () => {
      read();
      rows.push({ skill: 'ataque', team: 'us', playerId: null, result: null, zone: null });
      sheet.close();
      draw();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      read();
      const actions = rows.map((a) => ({ ...a, auto: false, edited: true }));
      const closing = match.events.find((ev) => ev.set === meta.set && ev.rally === meta.rally && ev.point);
      setVoice(match.id, key, { actions, cause: deriveCause(actions, closing?.point ?? null), status: 'parsed' });
      applyVoice(match.id, key);
      sheet.close();
      toast('Punto corregido');
      done();
    });
  };
  draw();
}
