// Editor de equipos rivales del club activo (nombre y plantilla opcional).
import { rivalPlayers, saveRivalPlayers, saveRivalTeam, deleteRivalTeam, rivalTeams } from '../store.js';
import { html, openSheet, toast } from '../ui.js';

// `name` null = nuevo equipo rival. `fixedName` impide renombrar (desde un partido).
export function openRivalEditor(name, done, { fixedName = false } = {}) {
  let teamName = name ?? '';
  let rows = name ? rivalPlayers(name).map((p) => ({ ...p })) : [];
  if (rows.length === 0) rows = [{ number: '', name: '' }];

  const draw = () => {
    const sheet = openSheet(html`
      <div class="sheet-title">
        <h2 class="grow">${name ? `Equipo rival: ${name}` : 'Nuevo equipo rival'}</h2>
        <button class="btn btn-ghost" data-close aria-label="Cerrar">✕</button>
      </div>
      <form id="rival-form" class="stack">
        ${fixedName ? '' : html`
          <label class="field">
            <span>Nombre del equipo rival</span>
            <input name="teamName" value="${teamName}" required autocomplete="off" />
          </label>`}
        <p class="muted small">Plantilla opcional: sirve para anotar qué jugador rival saca o ataca.</p>
        ${rows.map((r, i) => html`
          <div class="form-row rival-row">
            <input class="dorsal-field" name="number" data-i="${i}" inputmode="numeric" placeholder="Dorsal" value="${r.number}" />
            <input class="grow" name="name" data-i="${i}" placeholder="Nombre (opcional)" value="${r.name}" autocomplete="off" />
            <button type="button" class="btn btn-ghost" data-remove="${i}" aria-label="Quitar">✕</button>
          </div>`)}
        <button type="button" class="btn" id="add-rival">＋ Añadir jugador</button>
        <div class="form-actions">
          ${name && !fixedName ? html`<button type="button" class="btn btn-danger" id="del-rival">Eliminar</button>` : ''}
          <button type="button" class="btn" data-close>Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `.toString());
    const form = sheet.root.querySelector('#rival-form');
    const read = () => {
      if (form.teamName) teamName = form.teamName.value;
      form.querySelectorAll('input[data-i]').forEach((inp) => { rows[Number(inp.dataset.i)][inp.name] = inp.value; });
    };
    const redraw = () => { read(); sheet.close(); draw(); };
    sheet.root.querySelector('#add-rival').addEventListener('click', () => {
      read();
      rows.push({ number: '', name: '' });
      sheet.close();
      draw();
      [...document.querySelectorAll('.sheet .rival-row input[name=number]')].at(-1)?.focus();
    });
    sheet.root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      rows.splice(Number(b.dataset.remove), 1);
      redraw();
    }));
    sheet.root.querySelector('#del-rival')?.addEventListener('click', () => {
      if (!confirm(`¿Eliminar el equipo rival «${name}»? Los partidos jugados contra él se conservan.`)) return;
      deleteRivalTeam(name);
      sheet.close();
      done?.();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      read();
      const finalName = fixedName ? name : teamName.trim();
      if (!finalName) return;
      if (!fixedName && finalName.toLowerCase() !== (name ?? '').toLowerCase()
        && rivalTeams().some((t) => t.name.toLowerCase() === finalName.toLowerCase())) {
        toast('Ya existe un rival con ese nombre');
        return;
      }
      if (!fixedName) saveRivalTeam(name ?? '', finalName);
      saveRivalPlayers(finalName, rows.filter((r) => String(r.number).trim()));
      sheet.close();
      toast('Equipo rival guardado');
      done?.();
    });
  };
  draw();
}
