"""Resumen legible de un análisis (y por puntos, si hay etiquetas)."""

from __future__ import annotations


def summary_text(analysis: dict) -> str:
    m = analysis["metrics"]
    h = analysis["header"]
    lines = [
        f"Tramo analizado: {m['seconds']} s ({m['frames']} fotogramas, {h['fps'] / h.get('stride', 1):.0f} por segundo)",
        f"Modelo: {h.get('model')} · balón por mosaicos {h.get('ball_tiles')}",
        "",
        "JUGADORES (dentro de la zona de juego)",
        f"  Media por campo: A {m['players_mean']['A']} · B {m['players_mean']['B']}  (lo esperado es 6)",
        f"  Fotogramas con 5-7 jugadores: A {m['players_5to7_pct']['A']}% · B {m['players_5to7_pct']['B']}%",
        "",
        "BALÓN",
        f"  Detectado por el modelo: {m['ball_detected_pct']}% de los fotogramas",
        f"  Con seguimiento (detectado + huecos cortos rellenados): {m['ball_tracked_pct']}%",
        f"  Fotogramas con balón en cada campo: A {m['ball_frames_by_side']['A']} · B {m['ball_frames_by_side']['B']}",
        f"  Sitios quietos ignorados (falsos balones: luces, conos, balones parados…): {m.get('ball_static_spots', 0)} casillas",
        "",
        "JUEGO (experimental)",
        f"  Toques detectados: {m['touches']} ({m['touches_with_player_pct']}% con jugador asignado)",
        f"  Pasos de red: {m['net_crossings']} · posesiones: {m['possessions']}",
        f"  Toques por posesión: {m['touches_per_possession']}  (lo normal es 1-3)",
    ]
    return "\n".join(lines)


def rally_report(analysis: dict, rallies: list) -> tuple[str, list]:
    """Por cada punto etiquetado: balón visto, toques, pasos de red y quién tocó el último."""
    frames = analysis["frames"]
    touches = analysis["touches"]
    crossings = analysis["crossings"]
    t0, t1 = frames[0]["t"], frames[-1]["t"]
    rows = []
    for n, r in enumerate(rallies, 1):
        if r["end"] < t0 or r["start"] > t1:
            continue
        fr = [x for x in frames if r["start"] <= x["t"] <= r["end"] + 0.5]
        if not fr:
            continue
        ts = [t for t in touches if r["start"] <= t["f"] / analysis["header"]["fps"] <= r["end"] + 0.5]
        cr = [c for c in crossings if r["start"] <= c["f"] / analysis["header"]["fps"] <= r["end"] + 0.5]
        rows.append({
            "punto": n, "set": r["set"], "inicio": round(r["start"], 1), "fin": round(r["end"], 1),
            "ganador": r["winner"],
            "balon_visto_pct": round(100 * sum(1 for x in fr if x["ball"]) / len(fr), 1),
            "toques": len(ts), "pasos_red": len(cr),
            "ultimo_toque": ts[-1]["side"] if ts else None,
        })
    if not rows:
        return "Ningún punto etiquetado cae dentro del tramo analizado.", rows
    lines = ["punto  set  inicio   fin    ganador  balón%  toques  red  último toque"]
    for r in rows:
        lines.append(f"{r['punto']:>5}  {r['set']:>3}  {r['inicio']:>6}  {r['fin']:>6}  {r['ganador'] or '?':>7}  "
                     f"{r['balon_visto_pct']:>6}  {r['toques']:>6}  {r['pasos_red']:>3}  {r['ultimo_toque'] or '?':>12}")
    return "\n".join(lines), rows
