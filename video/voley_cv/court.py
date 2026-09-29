"""Calibración del campo: de píxeles de la imagen a metros sobre el suelo, y zonas de juego.

Sistema de coordenadas del campo (metros, visto desde arriba, dextrógiro):
  x: a lo largo del campo, de 0 a 18; la red está en x = 9.
  y: a lo ancho, de 0 a 9.
Campo «A» = x < 9, campo «B» = x > 9. Qué equipo está en cada campo lo dice el set (la app o las etiquetas).

Las esquinas se marcan siempre en el mismo orden, tal como se ven desde la cámara:
  1 cerca-izquierda, 2 cerca-derecha, 3 lejos-derecha, 4 lejos-izquierda.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import cv2
import numpy as np

LENGTH = 18.0
WIDTH = 9.0
NET_X = 9.0
ATTACK = 3.0  # distancia de la línea de ataque a la red

# Puntos que se pueden marcar, en orden: primero las 4 esquinas y luego puntos opcionales.
# Cualquiera se puede saltar (p. ej. una esquina que queda fuera de la imagen): bastan 4 puntos que no
# estén en línea. Cuantos más, mejor se compensa la distorsión del gran angular.
POINTS = {
    # Cámara en un lateral (grada), centrada en la red: el campo se ve de izquierda a derecha.
    "lateral": [
        ("esquina_1", "1 esquina cerca-izquierda", (0.0, 0.0)),
        ("esquina_2", "2 esquina cerca-derecha", (18.0, 0.0)),
        ("esquina_3", "3 esquina lejos-derecha", (18.0, 9.0)),
        ("esquina_4", "4 esquina lejos-izquierda", (0.0, 9.0)),
        ("centro_cerca", "línea central (bajo la red), extremo cercano", (9.0, 0.0)),
        ("centro_lejos", "línea central (bajo la red), extremo lejano", (9.0, 9.0)),
        ("ataque_izq_cerca", "línea de ataque izquierda, extremo cercano", (6.0, 0.0)),
        ("ataque_izq_lejos", "línea de ataque izquierda, extremo lejano", (6.0, 9.0)),
        ("ataque_der_cerca", "línea de ataque derecha, extremo cercano", (12.0, 0.0)),
        ("ataque_der_lejos", "línea de ataque derecha, extremo lejano", (12.0, 9.0)),
    ],
    # Cámara detrás de una línea de fondo: el campo se aleja de la cámara.
    "fondo": [
        ("esquina_1", "1 esquina cerca-izquierda", (0.0, 9.0)),
        ("esquina_2", "2 esquina cerca-derecha", (0.0, 0.0)),
        ("esquina_3", "3 esquina lejos-derecha", (18.0, 0.0)),
        ("esquina_4", "4 esquina lejos-izquierda", (18.0, 9.0)),
        ("centro_izquierda", "línea central (bajo la red), extremo izquierdo", (9.0, 9.0)),
        ("centro_derecha", "línea central (bajo la red), extremo derecho", (9.0, 0.0)),
        ("ataque_cerca_izquierda", "línea de ataque cercana, extremo izquierdo", (6.0, 9.0)),
        ("ataque_cerca_derecha", "línea de ataque cercana, extremo derecho", (6.0, 0.0)),
        ("ataque_lejos_izquierda", "línea de ataque lejana, extremo izquierdo", (12.0, 9.0)),
        ("ataque_lejos_derecha", "línea de ataque lejana, extremo derecho", (12.0, 0.0)),
    ],
}
CORNERS = {view: [p[2] for p in pts[:4]] for view, pts in POINTS.items()}
EXTRA = {view: {p[0]: p[2] for p in pts[4:]} for view, pts in POINTS.items()}
CORNER_LABELS = [p[1] for p in POINTS["lateral"][:4]]


def zone_of(x: float, y: float, margin: float = 0.0):
    """Campo ('A'/'B') y zona 1-6 de un punto del suelo, desde el punto de vista del equipo de ese campo
    (mirando a la red: 4-3-2 delante de izquierda a derecha, 5-6-1 detrás). Fuera del campo → (lado, None)."""
    side = "A" if x < NET_X else "B"
    inside = -margin <= x <= LENGTH + margin and -margin <= y <= WIDTH + margin
    if not inside:
        return side, None
    dist_net = NET_X - x if side == "A" else x - NET_X
    # Distancia desde la izquierda del equipo mirando a la red (el campo A mira hacia +x: su izquierda es +y).
    u = WIDTH - y if side == "A" else y
    col = 0 if u < 3 else 1 if u < 6 else 2
    front = dist_net < ATTACK
    return side, ([4, 3, 2] if front else [5, 6, 1])[col]


@dataclass
class Court:
    view: str
    image_points: list  # [[u, v], ...] en píxeles
    court_points: list  # [[x, y], ...] en metros
    image_size: tuple  # (ancho, alto)
    H: np.ndarray = field(init=False, repr=False)  # imagen → campo
    Hinv: np.ndarray = field(init=False, repr=False)  # campo → imagen

    def __post_init__(self):
        src = np.asarray(self.image_points, dtype=np.float64)
        dst = np.asarray(self.court_points, dtype=np.float64)
        if len(src) < 4:
            raise ValueError("Hacen falta al menos las 4 esquinas del campo.")
        # Con más de 4 puntos se ajusta por mínimos cuadrados (compensa algo la distorsión del gran angular).
        H, _ = cv2.findHomography(src, dst, 0)
        if H is None:
            raise ValueError("No se pudo calcular la calibración: revisa el orden de las esquinas.")
        self.H = H
        self.Hinv = np.linalg.inv(H)

    # ---------- Construcción y guardado ----------

    @classmethod
    def from_points(cls, view: str, clicked, image_size):
        """`clicked`: lista en el orden de POINTS[view] con [u, v] o None (punto saltado)."""
        if view not in POINTS:
            raise ValueError(f"Vista desconocida: {view} (usa 'lateral' o 'fondo').")
        img, court = [], []
        for (name, _, xy), pt in zip(POINTS[view], clicked):
            if pt is not None:
                img.append([float(pt[0]), float(pt[1])])
                court.append(list(xy))
        if len(img) < 4:
            raise ValueError("Hacen falta al menos 4 puntos del campo (esquinas o extremos de líneas).")
        return cls(view, img, court, tuple(image_size))

    @classmethod
    def from_clicks(cls, view: str, corners, image_size, extra: dict | None = None):
        """4 esquinas (alguna puede ser None si queda fuera de la imagen) y puntos extra por nombre."""
        if view not in POINTS:
            raise ValueError(f"Vista desconocida: {view} (usa 'lateral' o 'fondo').")
        extra = extra or {}
        unknown = set(extra) - set(EXTRA[view])
        if unknown:
            raise ValueError(f"Puntos extra desconocidos: {', '.join(sorted(unknown))}")
        clicked = list(corners) + [extra.get(name) for name in EXTRA[view]]
        return cls.from_points(view, clicked, image_size)

    def to_json(self) -> dict:
        return {"view": self.view, "image_points": self.image_points, "court_points": self.court_points,
                "image_size": list(self.image_size)}

    def save(self, path):
        with open(path, "w") as f:
            json.dump(self.to_json(), f, indent=2)

    @classmethod
    def load(cls, path):
        with open(path) as f:
            d = json.load(f)
        return cls(d["view"], d["image_points"], d["court_points"], tuple(d["image_size"]))

    # ---------- Proyecciones ----------

    def to_court(self, pts) -> np.ndarray:
        pts = np.asarray(pts, dtype=np.float64).reshape(-1, 1, 2)
        return cv2.perspectiveTransform(pts, self.H).reshape(-1, 2)

    def to_image(self, pts) -> np.ndarray:
        pts = np.asarray(pts, dtype=np.float64).reshape(-1, 1, 2)
        return cv2.perspectiveTransform(pts, self.Hinv).reshape(-1, 2)

    def reprojection_error(self) -> float:
        """Error medio (en píxeles) al volver a proyectar los puntos marcados: debería ser de pocos píxeles."""
        back = self.to_image(self.court_points)
        return float(np.mean(np.linalg.norm(back - np.asarray(self.image_points), axis=1)))

    def px_per_meter(self) -> float:
        """Escala aproximada en el centro del campo (para pasar umbrales de m/s a píxeles)."""
        a, b = self.to_image([(NET_X, WIDTH / 2), (NET_X + 1, WIDTH / 2)])
        c, d = self.to_image([(NET_X, WIDTH / 2), (NET_X, WIDTH / 2 + 1)])
        return float((np.linalg.norm(b - a) + np.linalg.norm(d - c)) / 2)

    # ---------- Red y lados ----------

    def net_line_image(self) -> np.ndarray:
        return self.to_image([(NET_X, 0.0), (NET_X, WIDTH)])

    def image_side(self, u: float, v: float) -> str:
        """Lado de la red en el que está un punto de la imagen (sirve para el balón en el aire:
        la red es un plano vertical que en la imagen se ve cerca de la línea central)."""
        (x1, y1), (x2, y2) = self.net_line_image()
        ref = self.to_image([(NET_X / 2, WIDTH / 2)])[0]  # un punto del campo A

        def cross(px, py):
            return (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)

        return "A" if np.sign(cross(u, v)) == np.sign(cross(*ref)) else "B"

    def feet_position(self, box) -> tuple[float, float]:
        """Posición en el suelo de una persona: centro del borde inferior de su caja."""
        x1, y1, x2, y2 = box[:4]
        x, y = self.to_court([((x1 + x2) / 2, y2)])[0]
        return float(x), float(y)

    def in_play_area(self, x: float, y: float) -> bool:
        """Zona donde se mueven los jugadores: el campo más un margen (saque y defensas lejanas).
        Deja fuera banquillos y a los árbitros, que están junto a los postes de la red."""
        if not (-4.0 <= x <= LENGTH + 4.0 and -1.5 <= y <= WIDTH + 1.5):
            return False
        near_post = abs(x - NET_X) < 1.2 and (y < -0.4 or y > WIDTH + 0.4)
        return not near_post

    # ---------- Dibujo ----------

    def court_lines(self):
        """Segmentos del campo en metros: contorno, línea central y líneas de ataque."""
        L, W = LENGTH, WIDTH
        return [
            ((0, 0), (L, 0)), ((L, 0), (L, W)), ((L, W), (0, W)), ((0, W), (0, 0)),
            ((NET_X, 0), (NET_X, W)),
            ((NET_X - ATTACK, 0), (NET_X - ATTACK, W)), ((NET_X + ATTACK, 0), (NET_X + ATTACK, W)),
        ]

    def draw_overlay(self, frame, color=(0, 255, 255), thickness=2):
        """Dibuja el campo calibrado sobre un fotograma para comprobar que encaja con las líneas reales."""
        out = frame.copy()
        for a, b in self.court_lines():
            pts = self.to_image(np.linspace(a, b, 30))  # por tramos: se ve si la lente curva las líneas
            cv2.polylines(out, [pts.astype(np.int32)], False, color, thickness, cv2.LINE_AA)
        for i, (u, v) in enumerate(self.image_points):
            cv2.circle(out, (int(u), int(v)), 7, (0, 0, 255), -1, cv2.LINE_AA)
            cv2.putText(out, str(i + 1), (int(u) + 8, int(v) - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        return out
