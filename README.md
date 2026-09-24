# 🏐 Voley Stats

Aplicación web para registrar partidos de voleibol **jugada a jugada** y consultar estadísticas por jugador, posición, partido y set. Pensada sobre todo para móvil y tablet.

Es una web estática (HTML + CSS + JavaScript, sin dependencias ni compilación), lista para publicarse en **GitHub Pages**.

## Funcionalidades

- **Plantilla**: jugadores con dorsal, nombre y posición (colocador, opuesto, receptor, central, líbero).
- **Alineación al inicio de cada set**:
  - Sistema de juego: **5-1** (por defecto), 4-2, 6-2 o colocación manual por zonas.
  - Jugador para cada rol (colocador, opuesto, receptores, centrales y líbero), rotación de salida (R1–R6 = zona del colocador) y equipo que saca.
  - Vista previa del campo antes de empezar. En el set siguiente se propone la misma alineación con el saque alternado.
- **Partido en directo, siguiendo la secuencia del juego**:
  - Los jugadores aparecen sobre un campo de voley en su **posición real de juego**: rotación principal al sacar, posiciones de recepción (reciben los dos receptores y el líbero; p. ej. en R2 el receptor de zona 3 baja a cubrir la zona 5) y posiciones de ataque/defensa (delante: receptor en 4, central en 3, colocador/opuesto en 2; detrás: receptor en 6, líbero en 5, colocador/opuesto en 1). El botón *Mostrar rotación principal* enseña dónde están según la rotación.
  - El líbero entra y sale solo por los centrales. Solo los delanteros pueden bloquear.
  - La app propone la siguiente acción: saque → defensa… o recepción → colocación → ataque → defensa… Se pueden saltar pasos y cerrar el punto en cualquier momento (*Error rival* / *Punto rival*).
  - Se guarda la zona en la que juega cada jugador y, tocando el campo rival, el destino del saque y del ataque, o desde dónde ataca el rival.
  - Bolas **FREE** en cualquier toque (recepción, defensa, colocación o ataque) indicando quién la pasa, y FREE del rival con su zona de origen; tras una FREE rival la app pasa a «recepción de la FREE».
  - En ataque se puede anotar punto por **Blockout**.
  - Plantilla del rival opcional (se guarda por equipo) para anotar quién saca o ataca.
  - Rotación automática en cada side-out; el marcador muestra quién saca y la rotación actual.
  - Cambios de jugador, *Otra acción…* para jugadas fuera de la secuencia, deshacer (también reabre un set cerrado por error) y aviso de fin de set (25, o 15 en el tie-break, con 2 de diferencia).
- **Estadísticas** (filtrables por partido y set):
  - Por jugador: puntos, puntos cedidos, saque (aces/errores), recepción positiva y perfecta, eficacia de ataque, bloqueos y defensas. Toca un jugador para ver su ficha completa.
  - Por posición.
  - Por rotación: side-out (puntos ganados recibiendo) y break (puntos ganados sacando) en R1–R6.
  - Por zonas: mapas de ataque (origen y destino), recepción y destino del saque, filtrables por jugador.
  - FREE: cuántas pasamos, quién, en qué toque y en qué rotación, cómo terminan esos puntos (y cuántas acaban en punto directo del rival); de las FREE del rival, cómo las aprovechamos (resultado de nuestro primer ataque) y desde dónde llegan.
  - Rival: zonas de ataque rival y estadísticas por jugador rival.
  - Por partido: resultado por sets, puntos propios, errores rivales y propios.
- **Datos**: exportación e importación JSON (copia de seguridad), exportación CSV para Excel.
- Funciona **sin conexión** (service worker) y se puede instalar en la pantalla de inicio.
- Modo oscuro automático.

## Cómo se calculan las estadísticas

| Métrica | Fórmula |
|---|---|
| Puntos | aces + ataques punto (incluido blockout) + blocks |
| Cedidos | errores que dan punto al rival (saque, recepción, ataque, bloqueado, bloqueo, defensa, colocación) |
| Recepción positiva | (perfectas + buenas) / total |
| Eficacia de ataque | (puntos + blockouts − errores − bloqueados) / total |
| Eficacia de saque | (aces + positivos − errores) / total |

## Publicar en GitHub Pages

1. Sube el código a la rama `main`.
2. En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Elige la rama `main` y la carpeta `/ (root)` y guarda.
4. En un par de minutos estará en `https://<usuario>.github.io/voley-app/`.

Para probarla en local: `python3 -m http.server 8000` y abre <http://localhost:8000>.

## Dónde se guardan los datos

Por ahora los datos se guardan en el **navegador del dispositivo** (`localStorage`). Borrar los datos del navegador los elimina, así que **exporta una copia JSON después de cada partido** (pestaña *Datos*).

Toda la persistencia está en `js/store.js`. Para añadir más adelante una API de sincronización (p. ej. un Cloudflare Worker con D1/KV), basta con enviar `exportData()` al servidor y cargar la respuesta con `importData(datos, 'merge')`: todos los registros tienen un `id` único, así que la combinación es segura.

## Estructura

```
index.html            Estructura base y barra de navegación
css/styles.css        Estilos (móvil primero, tablet a partir de 700px)
js/app.js             Enrutado por hash
js/actions.js         Posiciones, fundamentos y resultados
js/store.js           Estado y persistencia
js/rally.js           Sistemas, rotaciones, líbero y fases de cada punto
js/stats.js           Cálculo de estadísticas
js/ui.js              Utilidades (plantillas HTML, hojas, avisos)
js/views/*.js         Pantallas: inicio, plantilla, partido, estadísticas, datos
sw.js                 Service worker (uso sin conexión)
```

Para añadir o cambiar acciones basta con editar `SKILLS` en `js/actions.js`.
