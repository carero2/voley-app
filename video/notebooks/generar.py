"""Genera prueba_colab.ipynb (python video/notebooks/generar.py). Editar aquí y volver a generar."""

import json
from pathlib import Path

cells = []


def md(src):
    cells.append({"cell_type": "markdown", "metadata": {}, "source": src})


def code(src):
    cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": src})


md("""# 🏐 Análisis de vídeo de voleibol — pruebas

Este cuaderno usa el mismo código que funcionará después en el MacBook (`video/voley_cv` del repositorio).

**Antes de empezar**
1. Menú **Entorno de ejecución → Cambiar tipo de entorno de ejecución → T4 GPU**.
2. Ten el vídeo original (H.264/H.265, no el proxy) en **OneDrive** (compartido con enlace) o en **Google Drive**.
3. Ejecuta las celdas en orden con ▶. Cada una explica qué hace.

El vídeo se procesa en la máquina de Colab. Los resultados se guardan en la carpeta que elijas y la última
celda los descarga en un `.zip`.""")

code("""#@title 1. Preparar: GPU y código
import os, subprocess, sys
try:
    gpu = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader'],
                         capture_output=True, text=True).stdout.strip()
except FileNotFoundError:  # máquina sin GPU
    gpu = ''
print('GPU:', gpu or 'NINGUNA (vale para reanalizar con la celda 9; para detectar o entrenar: Entorno de ejecución → Cambiar tipo → T4 GPU)')

BRANCH = 'claude/volleyball-stats-github-pages-cf7xwk'
if not os.path.exists('/content/voley-app'):
    !git clone -q -b {BRANCH} https://github.com/carero2/voley-app.git /content/voley-app
else:
    !git -C /content/voley-app pull -q
%cd /content/voley-app/video
!pip install -q -r requirements.txt
sys.path.insert(0, '/content/voley-app/video')
# Si el código se ha actualizado, olvida la versión cargada antes (si no, seguiría usándose la antigua).
for m in [m for m in sys.modules if m.startswith('voley_cv')]:
    del sys.modules[m]
print('Listo')""")

md("""## Tu vídeo
- **OneDrive**: en OneDrive, clic derecho sobre el vídeo → **Compartir** → «Cualquier persona con el vínculo
  puede ver» → **Copiar vínculo** y pégalo en ENLACE_ONEDRIVE. Se descarga a Colab (unos minutos para 3 GB;
  hay que repetirlo en cada sesión nueva). Cuando acabes puedes dejar de compartirlo.
- **Google Drive**: pon la ruta en RUTA_DRIVE (se pedirá permiso para montar Drive).

Los resultados van a CARPETA. Con OneDrive se guardan en Colab (se pierden al cerrar la sesión: descárgalos
con la última celda); con Google Drive, en tu Drive.""")

code("""#@title 2. Tu vídeo
FUENTE = 'OneDrive'  #@param ["OneDrive", "Google Drive"]
ENLACE_ONEDRIVE = ''  #@param {type:"string"}
RUTA_DRIVE = '/content/drive/MyDrive/voley/partido.mov'  #@param {type:"string"}
VISTA = 'lateral'  #@param ["lateral", "fondo"]

from voley_cv.video_io import video_info
if FUENTE == 'OneDrive':
    from voley_cv.remote import download
    VIDEO = str(download(ENLACE_ONEDRIVE, '/content/partido.mov'))
    CARPETA = '/content/resultados'
else:
    from google.colab import drive
    drive.mount('/content/drive')
    VIDEO = RUTA_DRIVE
    CARPETA = os.path.join(os.path.dirname(RUTA_DRIVE), 'resultados')
os.makedirs(CARPETA, exist_ok=True)
info = video_info(VIDEO)
print(f"{info['width']}x{info['height']} · {info['fps']:.2f} fps · {info['duration'] / 60:.1f} min")
print('Resultados en', CARPETA)""")

md("""## Calibrar el campo
Marca con clics puntos del **campo de voley** (en tu pabellón, las **líneas naranjas**). La imagen va pidiendo
los puntos uno a uno y el **esquema de la derecha** muestra en amarillo dónde está el punto que toca:
las 4 esquinas y luego los extremos de la línea central (bajo la red) y de las dos líneas de 3 metros.

- **Si el punto que pide no se ve** (fuera de la imagen o tapado), pulsa **«No se ve: siguiente punto»**.
  No hagas clic en otro sitio: cada clic se guarda como el punto que se está pidiendo.
- Para corregir uno, elígelo en la lista y vuelve a hacer clic (o «Borrar este punto»).
- Hacen falta al menos 4 puntos; cuantos más, mejor. Termina con **Listo**.

Elige un segundo en el que las líneas no estén tapadas por jugadores.""")

code("""#@title 3. Calibrar el campo (clics sobre la imagen)
SEGUNDO = 30  #@param {type:"number"}
import cv2
from google.colab.patches import cv2_imshow
from voley_cv.video_io import read_frame
from voley_cv.calibrate_ui import pick_points_colab
from voley_cv.court import Court

frame = read_frame(VIDEO, SEGUNDO)
clicked = pick_points_colab(frame, VISTA)
court = Court.from_points(VISTA, clicked, (frame.shape[1], frame.shape[0]))
CAMPO = f'{CARPETA}/campo.json'
court.save(CAMPO)
preview = court.draw_overlay(frame)
cv2.imwrite(f'{CARPETA}/campo_comprobacion.jpg', preview)
print(f'{len(court.image_points)} puntos · error de reproyección: {court.reprojection_error():.1f} px (con más de 4 puntos, menos de ~5 px está bien)')
print('Las líneas amarillas deben coincidir con las del campo. Si no, repite esta celda.')
cv2_imshow(cv2.resize(preview, (1280, 720)))""")

md("""## Analizar un tramo
Detecta jugadores y balón, sigue el balón, busca toques, pasos de red y posesiones, y hace un vídeo anotado.

- **CADA = 2** analiza uno de cada dos fotogramas (el doble de rápido; suficiente para una primera prueba).
- **MOSAICOS**: el balón es pequeño; la imagen se divide en trozos para verlo mejor. 3x2 es un buen punto de
  partida; 1x1 = sin mosaicos (más rápido, casi no verá el balón).
- **ETIQUETAS** (opcional): ruta del `.json` de la herramienta de etiquetar puntos (súbelo con el icono de
  carpeta de la izquierda) para comparar punto a punto.
- **PESOS** (más adelante): el modelo reentrenado con tus etiquetas.

En una T4, un minuto de vídeo con CADA = 2 tarda unos minutos.""")

code("""#@title 4. Analizar un tramo
INICIO = 60  #@param {type:"number"}
FIN = 120  #@param {type:"number"}
CADA = 2  #@param {type:"integer"}
MODELO = 'small'  #@param ["nano", "small", "medium"]
MOSAICOS = '3x2'  #@param ["1x1", "2x1", "3x2", "4x3"]
ETIQUETAS = ''  #@param {type:"string"}
PESOS = ''  #@param {type:"string"}

CAMPO = f'{CARPETA}/campo.json'
if not os.path.exists(CAMPO):
    raise SystemExit('Falta calibrar el campo en esta sesión: ejecuta la celda 3 y marca puntos hasta pulsar «Listo».')
from voley_cv.pipeline import run_all
c, r = map(int, MOSAICOS.split('x'))
result, text, files = run_all(VIDEO, CAMPO, CARPETA, INICIO, FIN, CADA, MODELO, PESOS or None, (c, r), ETIQUETAS or None)
print(text)""")

code("""#@title 5. Ver el resultado (muestra y vídeo anotado)
from IPython.display import Image, HTML, display
from base64 import b64encode
display(Image(files['muestra'], width=1100))
if 'video' in files:
    data = b64encode(open(files['video'], 'rb').read()).decode()
    display(HTML(f'<video width="1000" controls src="data:video/mp4;base64,{data}"></video>'))""")

md("""## Volver a analizar sin detectar otra vez
Si el código del análisis se ha actualizado (seguimiento del balón, toques…), esta celda reutiliza las
detecciones ya guardadas del último tramo: tarda segundos en vez de minutos. Ejecuta antes la celda 1 para
bajar el código nuevo (y la 2 para saber dónde está el vídeo).""")

code("""#@title 4b. Reanalizar el último tramo (sin volver a detectar)
import glob
from voley_cv.pipeline import analyze_file
from voley_cv.court import Court
from voley_cv.render import render, contact_sheet
CAMPO = f'{CARPETA}/campo.json'
det = max((p for p in glob.glob(f'{CARPETA}/detecciones_*.jsonl') if 'muestreo' not in p), key=os.path.getmtime)
tag = os.path.basename(det)[len('detecciones_'):-len('.jsonl')]
result, text = analyze_file(det, CAMPO, f'{CARPETA}/analisis_{tag}.json', ETIQUETAS or None if 'ETIQUETAS' in dir() else None)
print(text)
court = Court.load(CAMPO)
files = {'detecciones': det, 'muestra': contact_sheet(VIDEO, result, court, f'{CARPETA}/muestra_{tag}.jpg'),
         'video': render(VIDEO, result, court, f'{CARPETA}/anotado_{tag}.mp4')}
print('Listo: ejecuta la celda 5 para verlo.')""")

md("""## Fotogramas para etiquetar (entrenar el modelo)
Recorre todo el vídeo (un fotograma cada 2 s), detecta, y guarda **N fotogramas variados con las cajas que ya
ve el modelo** (mitad repartidos, mitad donde no vio el balón). Crea `para_etiquetar.zip` para subir a
**Roboflow** y corregir: clases `balon` y `jugador`.""")

code("""#@title 6. Exportar fotogramas para Roboflow
N = 300  #@param {type:"integer"}
from voley_cv.pipeline import frames_for_labeling
n, zip_path = frames_for_labeling(VIDEO, CAMPO, CARPETA, N, 2.0, MODELO)
print(f'{n} fotogramas → {zip_path}')""")

md("""## Reentrenar con tus etiquetas
**En Roboflow** (una vez etiquetadas las imágenes):
1. **Generate / Versions → Create new version**.
2. **Train/Test split**: 70 % Train · 20 % Valid · 10 % Test (hacen falta las tres).
3. **Preprocessing**: *Auto-Orient* y **Tile 3 × 2** (divide cada fotograma en 6 trozos, igual que cuando el
   programa busca el balón). Quita *Resize* si aparece.
4. **Augmentation** (opcional): *Flip horizontal* y *Brightness ±15 %*.
5. **Create**, luego **Download Dataset → formato «COCO» → Show download code → pestaña Terminal** y copia la
   línea que empieza por `curl -L "https://app.roboflow.com/ds/…`. Pégala entera en ENLACE_ROBOFLOW.

**Aquí**: la celda descarga el conjunto, lo comprueba y entrena. En una T4 pueden ser **30-90 minutos**: deja
la pestaña abierta. Con **GUARDAR_EN_DRIVE** el modelo se va guardando en tu Google Drive (pide permiso al
empezar): si la sesión se corta no se pierde, y repitiendo la celda sigue donde se quedó. Para sola si deja de
mejorar. La celda 7b descarga el mejor modelo, también si paraste el entrenamiento a mano (botón ⏹).""")

code("""#@title 7. Reentrenar
ENLACE_ROBOFLOW = ''  #@param {type:"string"}
EPOCAS = 40  #@param {type:"integer"}
MODELO = 'small'  #@param ["nano", "small", "medium"]
GUARDAR_EN_DRIVE = True  #@param {type:"boolean"}
!pip install -q "rfdetr[train,loggers]"
from voley_cv.train import fetch_dataset, describe_dataset, train
if GUARDAR_EN_DRIVE:
    # El modelo se va guardando en tu Google Drive mientras entrena (unos 0,5-1 GB): si la sesión se corta,
    # no se pierde, y al repetir esta celda sigue donde se quedó.
    from google.colab import drive
    drive.mount('/content/drive')
    CARPETA_MODELO = '/content/drive/MyDrive/voley/modelo'
else:
    CARPETA_MODELO = f'{CARPETA}/modelo'
DATASET = fetch_dataset(ENLACE_ROBOFLOW, '/content/dataset')
print(describe_dataset(DATASET))
MODELO_PROPIO = train(DATASET, CARPETA_MODELO, MODELO, EPOCAS)
print('Modelo entrenado:', MODELO_PROPIO)
print('Para usarlo: en la celda 4 o 9 pon PESOS =', MODELO_PROPIO)""")

code("""#@title 7b. Descargar el modelo entrenado (también si el entrenamiento se paró a medias)
from voley_cv.train import best_checkpoint
from google.colab import files as colab_files
try:
    CARPETA_MODELO
except NameError:
    CARPETA_MODELO = f'{CARPETA}/modelo'
MODELO_PROPIO = best_checkpoint(CARPETA_MODELO)
print('Descargando', MODELO_PROPIO)
colab_files.download(str(MODELO_PROPIO))""")

md("""## Puntos: solo vídeo frente a tus etiquetas
Saca del vídeo, sin la app, dónde empieza y acaba cada punto, quién saca, quién gana y cómo, y lo compara con
lo que marcaste en la herramienta de etiquetar. Así se ve qué parte del registro en directo puede hacer el vídeo.

- **ETIQUETAS**: ruta del `.json` de la herramienta (vacío = la celda te pide que lo subas).
- **PESOS**: ruta del modelo reentrenado (vacío = modelo sin entrenar). Si lo subes una vez a tu Google Drive
  (carpeta `voley/modelo`), la ruta es `/content/drive/MyDrive/voley/modelo/checkpoint_best_ema.pth` y no hay
  que volver a subirlo en cada sesión.
- **GUARDAR_EN_DRIVE**: el trabajo se guarda en tu Drive (`voley/resultados`) minuto a minuto. Si la sesión se
  corta, al repetir la celda sigue donde se quedó. También guarda allí la calibración del campo.
- Con CADA = 2, en una T4 tarda unos 30-40 min para 14 min de vídeo. Sin GPU no es viable (muchas horas).
- **Repetir el análisis** (p. ej. tras mejorar las reglas) no necesita GPU ni el vídeo: basta con las celdas 1 y 9
  y GUARDAR_EN_DRIVE marcado; usa lo detectado que hay en tu Drive y tarda un par de minutos.""")

code("""#@title 9. Puntos: solo vídeo frente a tus etiquetas
ETIQUETAS = ''  #@param {type:"string"}
PESOS = ''  #@param {type:"string"}
MODELO = 'small'  #@param ["nano", "small", "medium"]
CADA = 2  #@param {type:"integer"}
MOSAICOS = '3x2'  #@param ["1x1", "2x1", "3x2", "4x3"]
GUARDAR_EN_DRIVE = True  #@param {type:"boolean"}

import os, shutil
VIDEO = globals().get('VIDEO', '/content/partido.mov')  # sin la celda 2 se reanaliza lo ya detectado
CARPETA = globals().get('CARPETA', '/content/resultados')
os.makedirs(CARPETA, exist_ok=True)
SALIDA = CARPETA
if GUARDAR_EN_DRIVE:
    from google.colab import drive
    drive.mount('/content/drive')
    SALIDA = '/content/drive/MyDrive/voley/resultados'
    os.makedirs(SALIDA, exist_ok=True)
CAMPO = f'{CARPETA}/campo.json'
if os.path.exists(CAMPO):
    if SALIDA != CARPETA:
        shutil.copy(CAMPO, f'{SALIDA}/campo.json')  # para la próxima sesión
elif os.path.exists(f'{SALIDA}/campo.json'):
    CAMPO = f'{SALIDA}/campo.json'
    print('Uso la calibración guardada en', CAMPO, '(si moviste la cámara, repite la celda 3)')
else:
    raise SystemExit('Falta calibrar el campo: ejecuta la celda 3 y marca puntos hasta pulsar «Listo».')
import torch
if not torch.cuda.is_available():
    print('Sin GPU: vale para reanalizar lo ya detectado; detectar de cero tardaría muchas horas.')
from voley_cv.pipeline import rallies_vs_labels
if not ETIQUETAS:
    from google.colab import files as colab_files
    ETIQUETAS = os.path.abspath(next(iter(colab_files.upload())))
c, r = map(int, MOSAICOS.split('x'))
puntos, comparacion, texto = rallies_vs_labels(VIDEO, CAMPO, SALIDA, ETIQUETAS, CADA, MODELO, PESOS or None, (c, r))
print(texto)""")

code("""#@title 8. Descargar los resultados (.zip)
import shutil
from google.colab import files as colab_files
zip_path = shutil.make_archive('/content/resultados_voley', 'zip', CARPETA)
print(f'{os.path.getsize(zip_path) / 1e6:.1f} MB')
colab_files.download(zip_path)""")

nb = {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"gpuType": "T4", "provenance": []},
                                   "kernelspec": {"display_name": "Python 3", "name": "python3"},
                                   "language_info": {"name": "python"}},
      "nbformat": 4, "nbformat_minor": 0}
for c in nb["cells"]:
    lines = c["source"].split("\n")
    c["source"] = [line + "\n" for line in lines[:-1]] + [lines[-1]]
out = Path(__file__).with_name("prueba_colab.ipynb")
out.write_text(json.dumps(nb, ensure_ascii=False, indent=1))
print(out)
