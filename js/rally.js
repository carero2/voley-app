// Lógica de la secuencia del partido: alineación, rotaciones, líbero y fases de cada punto.
// El estado de un set no se guarda: se reconstruye a partir de su alineación inicial y
// de sus eventos, así que "deshacer" siempre deja todo coherente.

// Cada sistema define los roles en orden de rotación (slot 0..5).
// El slot k empieza en la zona ((rotación - 1 + k) % 6) + 1: con R1 el slot 0 (colocador) está en zona 1.
export const SYSTEMS = {
  '5-1': {
    label: '5-1',
    roles: [
      { label: 'Colocador', pos: 'colocador' },
      { label: 'Receptor 1', pos: 'receptor' },
      { label: 'Central 1', pos: 'central' },
      { label: 'Opuesto', pos: 'opuesto' },
      { label: 'Receptor 2', pos: 'receptor' },
      { label: 'Central 2', pos: 'central' },
    ],
    setterSlots: [0],
    liberoSlots: [2, 5],
  },
  '4-2': {
    label: '4-2',
    roles: [
      { label: 'Colocador 1', pos: 'colocador' },
      { label: 'Receptor 1', pos: 'receptor' },
      { label: 'Central 1', pos: 'central' },
      { label: 'Colocador 2', pos: 'colocador' },
      { label: 'Receptor 2', pos: 'receptor' },
      { label: 'Central 2', pos: 'central' },
    ],
    setterSlots: [0, 3],
    setterRow: 'front',
    liberoSlots: [2, 5],
  },
  '6-2': {
    label: '6-2',
    roles: null, // mismos roles que 4-2 (se copian abajo)
    setterSlots: [0, 3],
    setterRow: 'back',
    liberoSlots: [2, 5],
  },
  manual: {
    label: 'Manual',
    roles: [1, 2, 3, 4, 5, 6].map((z) => ({ label: `Zona ${z}`, pos: null })),
    setterSlots: [],
    liberoSlots: [],
  },
};
SYSTEMS['6-2'].roles = SYSTEMS['4-2'].roles;

export const FRONT_ZONES = [2, 3, 4];
export const isFront = (zone) => FRONT_ZONES.includes(zone);

// Construye la alineación de un set.
// slots: jugadores en orden de roles (o de zona 1..6 en manual).
export function buildSetup({ system, slots, rotation, libero, liberoSlots, serveFirst, refSlot }) {
  const manual = system === 'manual';
  const startZones = slots.map((_, k) => (manual ? k + 1 : ((rotation - 1 + k) % 6) + 1));
  return {
    system,
    slots,
    rotation: manual ? startZones[refSlot ?? 0] : rotation,
    startZones,
    refSlot: manual ? refSlot ?? 0 : 0,
    libero: libero || null,
    liberoSlots: libero ? liberoSlots ?? SYSTEMS[system].liberoSlots : [],
    serveFirst,
  };
}

// Recorre los eventos del set y devuelve el estado actual.
export function setState(match, setNum) {
  const setup = match.sets?.[setNum] ?? null;
  const st = {
    setup,
    us: 0,
    them: 0,
    rotations: 0,
    serving: setup?.serveFirst ?? 'us',
    rally: 1,
    slots: setup ? [...setup.slots] : [],
    rallyEvents: [],
  };
  for (const e of match.events) {
    if (e.set !== setNum) continue;
    if (e.skill === 'cambio') {
      st.slots[e.slot] = e.playerId;
      continue;
    }
    st.rallyEvents.push(e);
    if (e.point === 'us') {
      st.us++;
      if (st.serving === 'them') st.rotations++; // side-out: rotamos y sacamos
      st.serving = 'us';
    } else if (e.point === 'them') {
      st.them++;
      st.serving = 'them';
    }
    if (e.point) {
      st.rally++;
      st.rallyEvents = [];
    }
  }
  return st;
}

export function zoneOfSlot(st, slot) {
  return ((((st.setup.startZones[slot] - 1 - st.rotations) % 6) + 6) % 6) + 1;
}

// Rotación actual = zona en la que está el jugador de referencia (colocador).
export const rotationOf = (st) => (st.setup ? zoneOfSlot(st, st.setup.refSlot) : null);

// Jugadores en pista por zona (índice 0 = zona 1). El líbero entra por los centrales en zaguero
// y sale cuando al central le toca sacar.
export function courtLayout(st) {
  const zones = new Array(6);
  st.slots.forEach((playerId, slot) => {
    const zone = zoneOfSlot(st, slot);
    const back = zone === 5 || zone === 6 || (zone === 1 && st.serving !== 'us');
    const libero = Boolean(st.setup.libero && st.setup.liberoSlots.includes(slot) && back);
    zones[zone - 1] = { slot, zone, playerId: libero ? st.setup.libero : playerId, libero };
  });
  return zones;
}

export function zoneOfPlayer(st, playerId) {
  return courtLayout(st).find((c) => c.playerId === playerId)?.zone ?? null;
}

// Colocador que se propone por defecto en la fase de colocación.
export function suggestedSetter(st, positionOf) {
  const sys = SYSTEMS[st.setup.system];
  const court = courtLayout(st);
  if (sys.setterSlots.length === 1) return st.slots[sys.setterSlots[0]];
  if (sys.setterSlots.length === 2) {
    const wantFront = sys.setterRow === 'front';
    const slot = sys.setterSlots.find((s) => isFront(zoneOfSlot(st, s)) === wantFront);
    return st.slots[slot];
  }
  return court.find((c) => positionOf(c.playerId) === 'colocador')?.playerId ?? null;
}

// Fase del punto en juego según la última acción registrada.
const NEXT = {
  saque: { positivo: 'defense', enjuego: 'defense' },
  recepcion: { perfecta: 'set', buena: 'set', mala: 'set' },
  colocacion: { buena: 'attack', mala: 'attack' },
  ataque: { enjuego: 'defense' },
  bloqueo: { toque: 'defense' },
  defensa: { buena: 'set', mala: 'set' },
  equipo: { free: 'defense' },
};

export function currentPhase(st) {
  const last = st.rallyEvents.at(-1);
  if (!last) return st.serving === 'us' ? 'serve' : 'reception';
  return NEXT[last.skill]?.[last.result] ?? 'defense';
}

export const PHASES = {
  serve: { label: 'Saque', skill: 'saque' },
  reception: { label: 'Recepción', skill: 'recepcion' },
  set: { label: 'Colocación', skill: 'colocacion' },
  attack: { label: 'Ataque', skill: 'ataque' },
  defense: { label: 'Defensa / bloqueo', skill: null },
};
