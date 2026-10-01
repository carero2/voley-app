"""Métricas de juego de un partido, de dos formas:

- **Solo vídeo**: ganador, saque y motivo de cada punto los deduce el vídeo (rallies.infer_rallies).
- **Vídeo + app**: ganador, saque y motivo vienen de la app (modo sencillo); el vídeo añade duración, pasos de red
  y zonas de recepción y de ataque.

Así se ve qué parte de las estadísticas puede dar el vídeo solo y qué gana con la app.
"""

from __future__ import annotations

from collections import Counter

from .rallies import OTHER, norm_how, with_app

TEAMS = ("A", "B")
OWN_POINT = {"ace", "ataque", "bloqueo"}
FIRST_BALL_SECONDS = 8.5  # del saque al final del punto: recepción + colocación + remate
LONG_POINT_SECONDS = 15.0


def points_video_only(analysis: dict, pred: list) -> list:
    """Puntos tal como los ve el vídeo (sin la app)."""
    app_like = [{"end": p["end"], "winner": p["winner"], "how": p["how"], "server": p["server"]} for p in pred if p.get("winner")]
    return with_app(analysis, pred, app_like)["rows"]


def points_with_app(analysis: dict, pred: list, app_points: list) -> list:
    """Puntos de la app, completados con lo que mide el vídeo."""
    return with_app(analysis, pred, app_points)["rows"]


def team_metrics(rows: list) -> dict:
    """Métricas por equipo (A = campo izquierdo, B = derecho) a partir de los puntos."""
    out = {}
    for team in TEAMS:
        other = OTHER[team]
        won = [r for r in rows if r["gana"] == team]
        serving = [r for r in rows if r["saca"] == team]
        receiving = [r for r in rows if r["saca"] == other]
        how = Counter(norm_how(r["como"]) for r in won)
        so = [r for r in receiving if r["gana"] == team]
        # Side-out al primer ataque: recibe y gana con su ataque en poco tiempo desde el saque (recepción,
        # colocación y remate). Se mide por la duración: los pasos de red se pierden cuando el balón no se ve.
        first_ball = [r for r in so if r["duracion"] is not None and r["duracion"] <= FIRST_BALL_SECONDS
                      and norm_how(r["como"]) in ("ataque", "bloqueo")]
        attack_zones = Counter(r["zona_ataque"] for r in won if r["zona_ataque"] and norm_how(r["como"]) == "ataque")
        rec_zones = Counter(r["zona_recepcion"] for r in receiving if r["zona_recepcion"])
        out[team] = {
            "puntos": len(won),
            "ace": how["ace"], "ataque": how["ataque"], "bloqueo": how["bloqueo"],
            "error_rival": how["error"] + how["error_saque"],
            "saques": len(serving),
            "errores_saque": sum(1 for r in serving if r["gana"] == other and norm_how(r["como"]) == "error_saque"),
            "recibe": len(receiving),
            "side_out": len(so),
            "side_out_pct": _pct(len(so), len(receiving)),
            "break": sum(1 for r in serving if r["gana"] == team),
            "break_pct": _pct(sum(1 for r in serving if r["gana"] == team), len(serving)),
            "primer_ataque": len(first_ball),
            "primer_ataque_pct": _pct(len(first_ball), len(receiving)),
            "zonas_ataque": dict(sorted(attack_zones.items())),
            "zonas_recepcion": dict(sorted(rec_zones.items())),
        }
    durations = [r["duracion"] for r in rows if r["duracion"] is not None]
    long_pts = [r for r in rows if r["duracion"] is not None and r["duracion"] >= LONG_POINT_SECONDS]
    return {
        "equipos": out,
        "puntos": len(rows),
        "duracion_media": round(sum(durations) / len(durations), 1) if durations else None,
        "puntos_largos": {t: sum(1 for r in long_pts if r["gana"] == t) for t in TEAMS},
        "marcador": _score_line(rows),
    }


def _pct(a, b):
    return round(100 * a / b) if b else None


def _score_line(rows):
    a = b = 0
    line = []
    for r in rows:
        if r["gana"] == "A":
            a += 1
        elif r["gana"] == "B":
            b += 1
        line.append([a, b])
    return line


def match_report(analysis: dict, pred: list, app_points: list, comparison: dict) -> dict:
    """Todo junto: métricas solo vídeo, métricas vídeo + app y la fiabilidad del vídeo frente a la app."""
    return {
        "solo_video": team_metrics(points_video_only(analysis, pred)),
        "video_app": team_metrics(points_with_app(analysis, pred, app_points)),
        "fiabilidad_video": {k: comparison.get(k) for k in (
            "labels", "found", "extra_video", "server_pct", "winner_pct", "how_pct", "how_group_pct", "how_both_pct")},
        "puntos": points_with_app(analysis, pred, app_points),
    }
