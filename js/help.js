// Explicaciones de las métricas. `help('clave')` pinta el botón «?»; al pulsarlo se abre la explicación.
import { html, raw, openSheet } from './ui.js';

export const HELP = {
  puntos: ['Puntos', 'Puntos que gana el jugador con su acción: aces + ataques que acaban en punto (incluidos los blockouts) + blocks.'],
  cedidos: ['Puntos cedidos', 'Puntos que el jugador regala al rival con un error: saque, recepción, ataque (fuera o bloqueado), blockout en bloqueo, defensa o colocación.'],
  balance: ['Balance', 'Puntos ganados menos puntos cedidos (o perdidos). Positivo = aporta más de lo que regala.'],
  ganados: ['Puntos ganados', 'Todos los puntos que ha ganado el equipo: los conseguidos por acciones propias (ace, ataque, block) más los errores del rival.'],
  perdidos: ['Puntos cedidos', 'Todos los puntos que ha ganado el rival: los que regalamos con errores propios más los que consigue el rival por sí mismo.'],
  recPos: ['Recepción positiva', '(Recepciones perfectas + buenas) / total de recepciones. Mide cuántas recepciones permiten construir un ataque en condiciones.'],
  recPerf: ['Recepción perfecta', 'Recepciones perfectas / total. Una recepción perfecta deja al colocador jugar con todas las opciones de ataque.'],
  saque: ['Saque A/E/T', 'Aces / errores / total de saques.'],
  efSaque: ['Eficacia de saque', '(Aces + saques positivos − errores) / total de saques. Un saque positivo es el que hace que el rival reciba mal.'],
  ataque: ['Ataque P/T', 'Ataques que acaban en punto (incluidos blockouts) / total de ataques.'],
  efAtaque: ['Eficacia de ataque', '(Puntos + blockouts − errores − ataques bloqueados) / total de ataques. Por encima del 30 % es muy buena; por debajo del 10 %, baja.'],
  killAtaque: ['% punto de ataque', 'Ataques que acaban en punto / total de ataques, sin descontar errores.'],
  sideOut: ['Side-out', 'Porcentaje de puntos que ganamos cuando saca el rival, es decir, cuando estamos en recepción. Mide lo bien que salimos de recepción. Ganar un side-out hace rotar al equipo.'],
  breakPt: ['Break', 'Porcentaje de puntos que ganamos con nuestro saque. Mide la capacidad de sumar puntos seguidos desde el saque, la defensa y el contraataque.'],
  rotacion: ['Rotación (R1–R6)', 'La rotación se nombra por la zona en la que está el colocador: R1 = colocador en zona 1, R6 = en zona 6, etc. El equipo cambia de rotación en cada side-out.'],
  balanceRot: ['Balance por rotación', 'Puntos ganados menos puntos perdidos mientras el equipo estaba en esa rotación.'],
  zonas: ['Mapas de zonas', 'Cada casilla es una zona del campo (1–6). El número grande es el total de acciones; debajo, cuántas salieron bien y su porcentaje. Cuanto más intenso el color, más acciones.'],
  ataqueRival: ['Ataque rival por zona', 'Zona desde la que atacó el rival (se marca al defender o bloquear). Debajo, cuántos de esos puntos acabó ganando el rival.'],
  free: ['Bola FREE', 'Balón que se pasa al campo contrario sin atacar (un toque fácil de recibir). Registramos quién la pasa, en qué toque (recepción, defensa, colocación o ataque) y en qué rotación, y quién ganó ese punto.'],
  freeDirecto: ['Punto directo tras FREE', 'Veces en que, después de pasar nosotros una FREE, lo siguiente que ocurre es un punto del rival sin que volvamos a tocar el balón.'],
  freeRival: ['Aprovechamiento de FREE rival', 'Resultado de nuestro primer ataque después de recibir una FREE del rival. Una FREE bien aprovechada debería acabar en punto; «Sin llegar a atacar» son las que perdimos antes de poder atacar.'],
  rivalJugadores: ['Jugadores rivales', 'Solo cuenta las acciones en las que se marcó qué jugador rival sacaba o atacaba. Puntos = puntos que consiguió; errores = puntos que nos regaló.'],
};

export function help(key) {
  return raw(`<button type="button" class="help-btn" data-help="${key}" aria-label="¿Qué significa ${HELP[key]?.[0] ?? ''}?">?</button>`);
}

export function showHelp(key) {
  const [title, text] = HELP[key] ?? ['Ayuda', 'Sin explicación disponible.'];
  openSheet(html`
    <div class="sheet-title">
      <h2 class="grow">${title}</h2>
      <button class="btn btn-ghost" data-close aria-label="Cerrar">✕</button>
    </div>
    <p class="help-text">${text}</p>
    <button class="btn btn-block" data-close>Entendido</button>
  `.toString());
}
