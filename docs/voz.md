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

## Dos métodos de dictado (se elige en la pantalla del partido; Groq por defecto en cada partido nuevo)

- **Grabar (Groq):** se graba el audio de cada punto y se transcribe en segundo plano. Guarda el audio
  (se puede escuchar y reprocesar) y usa el vocabulario y los nombres de la plantilla. Necesita conexión
  para transcribir (los audios esperan si no la hay).
- **Teclado del móvil:** se dicta con el micrófono del teclado (Gboard, dictado de iOS) en un cuadro de
  texto; al cerrar el punto se analiza al momento, sin Groq ni internet si el teclado tiene el
  reconocimiento sin conexión activado. No guarda audio.

La revisión muestra el % de acciones completas de cada método para compararlos con datos reales.

## Cómo hablar

No hace falta un orden fijo. El analizador reconoce por palabras clave:

| Qué | Ejemplos |
|---|---|
| Jugador por nombre | «Carlos», «Simón» (tolera un error de transcripción en nombres de 5+ letras) |
| Jugador por dorsal | «el 10», «diez» |
| Jugador por puesto | «el punta», «la central», «el opuesto», «el líbero», «el colocador», «el punta zaguero/delantero» |
| Acción | saque/saca, recibe/recepción, coloca, ataca/remata/tira, bloqueo/bloquea, defensa/defiende, apoyo/cubre |
| FREE | «free», «fri», «bola fácil»; «nos pasan free» / «pasan free» (rival), «pasamos free», «free del opuesto» (nuestra) |
| Equipo por el verbo | «atacan», «rematan», «sacan», «pasan» = rival; «atacamos», «rematamos», «recibimos», «pasamos» = nosotros |
| Resultado | bien/buena, mal/mala, error/fuera/red, punto/gana, blockout, bloqueado/tapado, toque |
| Zona | «por 4», «zona 2», «por la 3», «desde 1», «pipe» |
| Rival | «rival», «ellos», «contrario», o un dorsal de la plantilla rival |

Reglas de interpretación:

- Un jugador dicho de dos formas seguidas es el mismo: «el punta 11», «Carlos el 23».
- El jugador puede ir antes o después del verbo: «Carlos remata», «remata Carlos», «remata el opuesto».
- «coloca a X» / «para X»: X es el atacante siguiente; el colocador es el que está en pista.
  «Coloca Simón a 2»: Simón coloca y «a 2» es la zona (lo que va tras «a» nunca se une al sujeto).
- Atacante por zona según la rotación de ese punto (posiciones de juego): 4 punta delantero, 3 central
  delantero, 2 opuesto… El colocador nunca remata su propia colocación: si está delante (zona 2), «a 2» es
  el opuesto. Así, «coloca a 2… remata» asigna el ataque sin decir quién.
- Nuestro ataque seguido de una acción del rival («ellos defienden y atacan») queda «en juego».
- Los puestos se buscan en la alineación de ese set (el hueco que ocupa cada jugador), no en su ficha.
- Si no se dice la acción, se deduce del momento del punto (p. ej. primer toque cuando saca el rival = recepción).
- «Recibe» solo es recepción en el primer toque tras el saque rival; en cualquier otro momento (tras un ataque,
  un toque de bloqueo o una FREE rival) es defensa.
- Una calidad dicha aparte («Buena recepción») completa la acción anterior del mismo tipo.
- La colocación es buena por defecto y la hace el colocador en pista, salvo que se diga otra cosa.
- «Colocación a X y fuera»: el resultado es del ataque de X.
- Del rival solo se registran ataque (con zona), saque y FREE; «defienden», «colocan»… se reconocen y se ignoran.
- El botón que cerró el punto completa la última acción si no se dijo su resultado:
  - Punto propio: nuestro ataque o bloqueo = punto; ataque rival = error del rival.
  - Punto rival: ataque rival = punto del rival; nuestra recepción/defensa/apoyo/colocación = error.
  - «block» sin decir de quién justo tras nuestro ataque (o «coloca a …») con punto rival = nos bloquean
    (ataque «bloqueado»); tras un ataque rival con punto propio = nuestro block.
- Tipos de colocación o ataque («rápida», «alta», «tensa», «finta»…) se reconocen y se ignoran.
- Calidades deducidas (marcadas «(deducido)» en la revisión): recepción/defensa/apoyo/colocación seguidas
  de nuestro ataque = buenas; seguidas de una FREE nuestra = malas; si el punto fue nuestro y lo último es
  nuestro ataque o bloqueo sin resultado = punto.
- Lo que no se entiende se deja vacío. Nunca se inventa.

Tras mejorar el analizador, «Reanalizar todos» en la revisión vuelve a aplicar las reglas a los textos ya
transcritos (sin volver a llamar a Groq); los puntos corregidos a mano no se tocan.

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
