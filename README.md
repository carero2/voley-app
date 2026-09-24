# 🏐 Voley Stats

Aplicación web para registrar partidos de voleibol **jugada a jugada** y consultar estadísticas por jugador, posición, partido y set. Pensada sobre todo para móvil y tablet.

Es una web estática (HTML + CSS + JavaScript, sin dependencias ni compilación), lista para publicarse en **GitHub Pages**.

## Funcionalidades

- **Plantilla**: jugadores con dorsal, nombre y posición (colocador, opuesto, receptor, central, líbero).
- **Partido en directo**:
  - Marcador automático, cambio de set al llegar a 25 (15 en el tie-break) con 2 de diferencia.
  - Toca un jugador → elige la acción: saque, recepción, ataque, bloqueo, defensa o colocación, cada una con su resultado.
  - Botones de equipo: *Error rival* (punto para nosotros) y *Punto rival*.
  - Botón de deshacer (también reabre un set cerrado por error).
  - Convocados por partido, partidos al mejor de 3 o de 5.
- **Estadísticas** (filtrables por partido y set):
  - Por jugador: puntos, puntos cedidos, saque (aces/errores), recepción positiva y perfecta, eficacia de ataque, bloqueos y defensas. Toca un jugador para ver su ficha completa.
  - Por posición.
  - Por partido: resultado por sets, puntos propios, errores rivales y propios.
- **Datos**: exportación e importación JSON (copia de seguridad), exportación CSV para Excel.
- Funciona **sin conexión** (service worker) y se puede instalar en la pantalla de inicio.
- Modo oscuro automático.

## Cómo se calculan las estadísticas

| Métrica | Fórmula |
|---|---|
| Puntos | aces + ataques punto + bloqueos punto |
| Cedidos | errores que dan punto al rival (saque, recepción, ataque, bloqueado, bloqueo, defensa, colocación) |
| Recepción positiva | (perfectas + buenas) / total |
| Eficacia de ataque | (puntos − errores − bloqueados) / total |
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
js/stats.js           Cálculo de estadísticas
js/ui.js              Utilidades (plantillas HTML, hojas, avisos)
js/views/*.js         Pantallas: inicio, plantilla, partido, estadísticas, datos
sw.js                 Service worker (uso sin conexión)
```

Para añadir o cambiar acciones basta con editar `SKILLS` en `js/actions.js`.
