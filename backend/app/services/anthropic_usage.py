"""Registro central del uso de la API de Anthropic por funciones internas.

Toda función que pega a api.anthropic.com con la key directa (Especialista Negocio,
diagnóstico de costos, intake, clasificación, asistente de ayuda…) llama a
`registrar(funcion, modelo, usage)` después de cada respuesta. Acá se calcula el
costo (precio OFICIAL de Anthropic, sin el 10% off de MyClaw) y se guarda.

`resumen()` agrega por función + por día para mostrarlo en Monitoreo → Tokens,
separado del costo de Camila (que es MyClaw)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

_BA = timezone(timedelta(hours=-3))

# Precio OFICIAL Anthropic USD/token [input, output, cacheRead, cacheWrite] / 1e6.
_PRICES = {
    "sonnet": (3.00e-6, 15.00e-6, 0.30e-6, 3.75e-6),
    "opus":   (5.00e-6, 25.00e-6, 0.50e-6, 6.25e-6),
    "haiku":  (1.00e-6,  5.00e-6, 0.10e-6, 1.25e-6),
}
_DEFAULT = _PRICES["sonnet"]


def _price_for(modelo: str):
    m = (modelo or "").lower()
    if "opus" in m:
        return _PRICES["opus"]
    if "haiku" in m:
        return _PRICES["haiku"]
    return _PRICES["sonnet"] if "sonnet" in m else _DEFAULT


def _costo(modelo: str, u: dict) -> float:
    pi, po, pcr, pcw = _price_for(modelo)
    return (u.get("input_tokens", 0) * pi
            + u.get("output_tokens", 0) * po
            + u.get("cache_read_input_tokens", 0) * pcr
            + u.get("cache_creation_input_tokens", 0) * pcw)


def registrar(funcion: str, modelo: str, usage: dict | None) -> None:
    """Guarda un llamado a Anthropic. Best-effort: nunca rompe al llamador."""
    if not usage:
        return
    try:
        from app.database import SessionLocal
        from app.models.anthropic_usage import AnthropicUsage
        db = SessionLocal()
        try:
            db.add(AnthropicUsage(
                funcion=funcion[:80], modelo=(modelo or "")[:60],
                fecha=datetime.now(_BA).strftime("%Y-%m-%d"),
                input_tokens=usage.get("input_tokens", 0),
                output_tokens=usage.get("output_tokens", 0),
                cache_read=usage.get("cache_read_input_tokens", 0),
                cache_write=usage.get("cache_creation_input_tokens", 0),
                costo_usd=round(_costo(modelo, usage), 6),
            ))
            db.commit()
        finally:
            db.close()
    except Exception as e:
        print(f"[ANTHROPIC-USAGE] registrar: {type(e).__name__}: {e}")


def resumen(dias: int = 30) -> dict:
    """Agrega el uso de los últimos `dias`: por función y por día, + total."""
    from app.database import SessionLocal
    from app.models.anthropic_usage import AnthropicUsage
    desde = (datetime.now(_BA) - timedelta(days=max(1, dias))).strftime("%Y-%m-%d")
    db = SessionLocal()
    try:
        rows = (db.query(AnthropicUsage)
                .filter(AnthropicUsage.fecha >= desde)
                .all())
        por_funcion: dict[str, dict] = {}
        por_dia: dict[str, float] = {}
        total = 0.0
        tokens_total = 0
        for r in rows:
            f = por_funcion.setdefault(r.funcion, {
                "funcion": r.funcion, "llamadas": 0, "tokens": 0,
                "costo_usd": 0.0, "modelos": set()})
            toks = r.input_tokens + r.output_tokens + r.cache_read + r.cache_write
            f["llamadas"] += 1
            f["tokens"] += toks
            f["costo_usd"] += r.costo_usd
            f["modelos"].add(r.modelo)
            por_dia[r.fecha] = por_dia.get(r.fecha, 0.0) + r.costo_usd
            total += r.costo_usd
            tokens_total += toks
        funciones = sorted(por_funcion.values(), key=lambda x: x["costo_usd"], reverse=True)
        for f in funciones:
            f["costo_usd"] = round(f["costo_usd"], 4)
            f["modelos"] = sorted(m for m in f["modelos"] if m)
        return {
            "dias": dias,
            "total_usd": round(total, 4),
            "tokens_total": tokens_total,
            "llamadas_total": len(rows),
            "por_funcion": funciones,
            "por_dia": [{"fecha": k, "costo_usd": round(v, 4)} for k, v in sorted(por_dia.items())],
        }
    finally:
        db.close()
