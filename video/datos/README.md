# Datos de prueba

Una carpeta por grabación, con lo necesario para repetir el análisis **sin vídeo ni GPU**
(solo números: cajas de jugadores y balón por fotograma, sin imágenes).

| Archivo | Qué es |
|---|---|
| `campo.json` | Calibración del campo (celda 3 del cuaderno) |
| `detecciones_<modelo>_cada<N>.jsonl.gz` | Lo que detectó el modelo en cada fotograma analizado |
| `etiquetas.json` | Puntos marcados a mano con `etiquetar/` (hora, ganador, motivo, quién saca primero) |

Reanalizar y comparar con las etiquetas:

```bash
cd video
python -m voley_cv evaluar datos/2026-09-29_A001_C004
```

## Grabaciones

- `2026-09-29_A001_C004`: iPhone 12 desde la grada, vista lateral, 14 min, 1080p 60 fps, obturación 1/120.
  Modelo `small` reentrenado con 293 fotogramas (época ~30), CADA = 2. 28 puntos etiquetados (1 set).
  Las reglas de `voley_cv/rallies.py` se ajustaron con esta grabación: hay que comprobarlas con otra.
