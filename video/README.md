# Análisis de vídeo (pruebas)

Código para analizar vídeos de partidos: detecta jugadores y balón con **RF-DETR** (red neuronal), calibra el
campo, sigue el balón y, con reglas de voleibol, busca toques, pasos de red y posesiones (1-2-3). La idea es
la misma que el proyecto de Selçuk Görgülü (RF-DETR + reglas), adaptada a nuestra app.

El mismo código funciona en **Google Colab** (ahora) y en el **Mac** (después): solo cambia dónde se ejecuta.

## Qué hay

| Parte | Para qué |
|---|---|
| `notebooks/prueba_colab.ipynb` | Cuaderno de Colab con todos los pasos (abrir con el enlace de abajo) |
| `etiquetar/index.html` | Herramienta web para marcar **cuándo acaba cada punto, qué campo lo gana y cómo** (el vídeo no se sube a ningún sitio) |
| `voley_cv/court.py` | Calibración: esquinas del campo → metros sobre el suelo, zonas 1-6 de cada campo |
| `voley_cv/detect.py` | Detección con RF-DETR (COCO: «person» y «sports ball»); el balón se busca también por mosaicos |
| `voley_cv/analyze.py` | Seguimiento del balón, jugadores sobre el campo, toques, pasos de red, posesiones y métricas |
| `voley_cv/render.py` | Vídeo anotado con minimapa del punto |
| `voley_cv/labels.py` | Fotogramas con etiquetas previas para corregir en Roboflow; lectura de las etiquetas de puntos |
| `voley_cv/rallies.py` | Puntos sacados **solo del vídeo** (inicio, fin, quién saca, quién gana y cómo) y comparación con los marcados a mano |
| `voley_cv/train.py` | Reentrenar RF-DETR con vuestros fotogramas (formato COCO exportado de Roboflow) |
| `tests/` | Pruebas con datos sintéticos (sin red neuronal) |

## Colab

Abrir: <https://colab.research.google.com/github/carero2/voley-app/blob/claude/volleyball-stats-github-pages-cf7xwk/video/notebooks/prueba_colab.ipynb>

1. **Entorno de ejecución → Cambiar tipo → T4 GPU**.
2. El vídeo original puede estar en **OneDrive** (compártelo como «cualquier persona con el vínculo» y pega el
   enlace; se descarga a Colab) o en **Google Drive**.
3. Ejecuta las celdas en orden: preparar → vídeo → calibrar (clics) → analizar un tramo → ver resultado →
   exportar fotogramas para etiquetar → reentrenar → puntos solo vídeo frente a tus etiquetas (celda 9) →
   descargar resultados (.zip).

Calibración: se marcan las esquinas y los extremos de la línea central y de las líneas de ataque; cualquier
punto se puede saltar (p. ej. una esquina fuera de la imagen). Bastan 4 que no estén en línea.

## Etiquetar puntos

<https://carero2.github.io/voley-app/video/etiquetar/> — abre el vídeo desde el móvil u ordenador, pulsa
**Punto A / Punto B** al acabar cada punto (A = campo izquierdo en vista lateral, o el cercano en vista de
fondo) y elige el motivo, marca quién saca primero en cada set, **Fin de set** entre sets, y **Descargar
etiquetas**. «Inicio punto» es opcional (solo sirve para medir si el vídeo corta bien los puntos). A es siempre
el mismo lado del vídeo, aunque los equipos cambien de campo.

El `.json` se usa en la **celda 9**: el vídeo saca los puntos por su cuenta (sin mirar las etiquetas) y se
mide cuántos encuentra y si acierta quién saca, quién gana y el motivo. Reglas que usa (`voley_cv/rallies.py`):
- **Saque**: antes de sacar, los jugadores esperan quietos y en cuanto sale el saque se mueven. Se busca ese
  «quietos → en movimiento» y un paso de red justo después.
- **Quién saca**: el campo del que sale ese paso de red; si no se vio el balón, el campo con un jugador detrás
  de su línea de fondo.
- **Ganador**: el que saca el punto siguiente; en el último del set, el que mandó el último balón al otro campo.
- **Motivo**: con el último paso de red de verdad (no cuentan los pases por debajo de la red al acabar):
  si fue el saque → ace o error de saque; si gana el que lo recibió → error de ataque; si vuelve enseguida tras
  un ataque → bloqueo; si el que pierde casi no la toca → ataque; si la toca 2-3 veces → error suyo.

Después compara **con los datos de la app** (hora, ganador y motivo de cada punto): el reloj de la app y el del
vídeo se sincronizan solos (`align_app`), y el vídeo añade el inicio y la duración de cada punto, los pasos de
red, la zona de la recepción y la zona desde la que se atacó.

La carpeta `datos/` guarda grabaciones ya detectadas para repetir el análisis sin vídeo ni GPU
(`python -m voley_cv evaluar datos/<carpeta>`).

## Etiquetar para entrenar (Roboflow)

1. La celda 6 crea `para_etiquetar.zip` (imágenes + cajas que ya ve el modelo, formato YOLO).
2. En Roboflow: nuevo proyecto de detección de objetos, sube el zip, corrige las cajas. Clase `balon`: todos
   los balones reales (no cabezas, luces…). Clase `jugador`: en realidad «persona», **todas** las que se vean
   bien (también banquillo y árbitros); quién juega lo decide la calibración del campo. Cajas ajustadas y con
   el borde inferior en los pies.
3. Genera una versión y expórtala en formato **COCO** a Drive; celda 7 para reentrenar.
4. Usa el modelo resultante en la celda 4 (campo PESOS).

## En el Mac (cuando llegue)

```bash
git clone -b claude/volleyball-stats-github-pages-cf7xwk https://github.com/carero2/voley-app.git
cd voley-app/video
python3 -m venv .venv && source .venv/bin/activate
pip install torch torchvision && pip install -r requirements.txt && pip install opencv-python
python -m voley_cv calibrate partido.mov --t 30 --view lateral            # ventana para marcar esquinas
python -m voley_cv run partido.mov --court campo.json --start 60 --end 120 --stride 2
```

Usa la GPU del chip M automáticamente. Otras órdenes: `info`, `frame`, `detect`, `analyze`, `render`,
`export-frames`, `puntos`, `evaluar`, `train` (`python -m voley_cv --help`).

## Cómo leer el resumen

- **Jugadores por campo**: debería rondar 6 en cada campo; menos = jugadores no detectados (lejos, tapados).
- **Balón detectado / con seguimiento**: porcentaje de fotogramas en los que se sabe dónde está el balón.
  Es la cifra clave: con el modelo sin reentrenar será baja; el reentrenamiento debería subirla mucho.
- **Toques, pasos de red y posesiones**: experimentales; dependen de que el balón se siga bien. Lo normal es
  1-3 toques por posesión.
- **Por puntos** (con etiquetas): cuánto balón se vio en cada punto, cuántos toques y pasos de red, y de qué
  campo fue el último toque.

## Ajustes de grabación recomendados (Blackmagic Camera, iPhone)

1080p · 50 fps · obturador 1/500 o más rápido (sin «obturación sin parpadeo») · ISO manual · balance de
blancos y enfoque fijos · estabilización desactivada · **sin grabación proxy** (duplica el trabajo del móvil y
lo calienta).

Espacio: con H.264 a bitrate alto son unos 12 GB por hora. Con **H.265** y bitrate medio, a 50 fps, se queda
en una fracción (unos 4-6 GB por hora, según el ajuste); parar la grabación entre sets también ahorra espacio y
deja enfriar el móvil. Después, pasar el vídeo a OneDrive con wifi y borrarlo del móvil.
