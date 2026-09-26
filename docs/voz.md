# Registro por voz

## Cómo funciona

1. **En directo (sin depender de internet):** botones de *Iniciar punto*, *Punto propio*, *Punto rival*,
   *Ace* y *Error de saque* (o *Ace rival* / *Error de saque rival* cuando saca el rival).
   El marcador y la rotación se actualizan al instante.
2. **Grabación por punto:** *Iniciar punto* graba; el botón que cierra el punto para la grabación
   2,5 s después (para no cortar la última palabra). Ace y error de saque no necesitan audio.
   El audio se guarda en el móvil (IndexedDB, ~30–45 KB por punto).
3. **Cola en segundo plano** (`js/voice/queue.js`): cuando hay conexión, envía cada audio a
   **Groq** (Whisper large v3 turbo) directamente desde el móvil con la clave gratuita del usuario
   (*Datos → Registro por voz*). Si falla, reintenta con espera creciente.
4. **Analizador** (`js/voice/parser.js`): convierte el texto en acciones usando el contexto del punto
   (quién estaba en pista, en qué puesto, quién sacaba y quién ganó el punto).
5. **Aplicación automática:** las acciones se convierten en eventos normales del partido, así que las
   estadísticas se actualizan en cuanto se procesa cada punto.
6. **Revisión** (`#/partido/<id>/voz`): audio, texto editable, plantilla, corrección manual y
   porcentaje de acciones completas.

## Cómo hablar

No hace falta un orden fijo. El analizador reconoce por palabras clave:

| Qué | Ejemplos |
|---|---|
| Jugador por nombre | «Carlos», «Simón» (tolera un error de transcripción en nombres de 5+ letras) |
| Jugador por dorsal | «el 10», «diez» |
| Jugador por puesto | «el punta», «la central», «el opuesto», «el líbero», «el colocador», «el punta zaguero/delantero» |
| Acción | saque/saca, recibe/recepción, coloca, ataca/remata/tira, bloqueo/bloquea, defensa/defiende, free, apoyo/cubre |
| Resultado | bien/buena, mal/mala, error/fuera/red, punto/gana, blockout, bloqueado/tapado, toque |
| Zona | «por 4», «zona 2», «por la 3», «desde 1», «pipe» |
| Rival | «rival», «ellos», «contrario», o un dorsal de la plantilla rival |

Si no se dice la acción, se deduce del momento del punto (p. ej. primer toque cuando saca el rival = recepción).
Lo que no se entiende se deja vacío. Nunca se inventa.

Ejemplos: «Carlos recibe bien, el punta ataca por 4, punto» · «ataque rival por la 2, defensa buena del líbero, el opuesto tira fuera».

## Formato de la plantilla (por punto)

Guardado en `match.voice["<set>-<punto>"]` y exportable desde la revisión:

```json
{
  "set": 1, "rally": 14, "status": "applied",
  "transcript": "recibe bien el 7, el punta ataca por 4, punto",
  "actions": [
    { "skill": "recepcion", "team": "us", "playerId": "…", "zone": null, "result": "buena" },
    { "skill": "ataque", "team": "us", "playerId": "…", "zone": 4, "result": "punto" }
  ],
  "unknown": [],
  "cause": "own"
}
```

- `skill`: saque, recepcion, colocacion, ataque, bloqueo, defensa, apoyo, free.
- `team`: `us` / `them`. `result`: los de `SKILLS` en `js/actions.js` (o `null` si no se entendió).
- `cause`: cómo terminó el punto (`own`, `ownError`, `rivalError`, `rivalPoint` o `null`).

Este mismo formato sirve para futuras fuentes (vídeo, API): basta con rellenar `actions`.

## Probar y mejorar el analizador

```bash
node tests/parser.test.mjs
```

Para añadir palabras, edita los vocabularios `SKILL_WORDS`, `RESULT_WORDS` y `ROLE_WORDS` de
`js/voice/parser.js` y añade casos a `tests/parser.test.mjs`. En la revisión también puedes escribir
un texto a mano y pulsar «Analizar texto» para probarlo sin audio.
