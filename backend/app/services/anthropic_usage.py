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


def registrar(funcion: str, modelo: str, usage: dict | None, source: str | None = None) -> None:
    """Guarda un llamado a Anthropic. Best-effort: nunca rompe al llamador.
    `source` = cliente al que se atribuye ('etiguel' / slug del tenant), o None si es global."""
    if not usage:
        return
    try:
        from app.database import SessionLocal
        from app.models.anthropic_usage import AnthropicUsage
        db = SessionLocal()
        try:
            db.add(AnthropicUsage(
                source=(source or None), funcion=funcion[:80], modelo=(modelo or "")[:60],
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


_MES_ABBR = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
             "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
_MES_NOMBRE = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
               "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]


def resumen(meses: int = 12, source: str | None = None) -> dict:
    """Estadísticas de costo (solo plata) de las funciones internas:
      - mes_actual: costo por función del mes corriente + total + delta vs anterior.
      - meses: serie mensual con desglose por función (para el gráfico apilado).
    Si `source` viene, filtra SOLO ese cliente; si es None, todos (vista General)."""
    from app.database import SessionLocal
    from app.models.anthropic_usage import AnthropicUsage
    ahora = datetime.now(_BA)
    db = SessionLocal()
    try:
        q = db.query(AnthropicUsage)
        if source:
            q = q.filter(AnthropicUsage.source == source)
        rows = q.all()
        por_mes: dict[str, dict[str, float]] = {}  # 'YYYY-MM' -> funcion -> costo
        por_dia: dict[str, float] = {}  # 'YYYY-MM-DD' -> costo total interno del día
        for r in rows:
            mes = (r.fecha or "")[:7]
            if not mes:
                continue
            por_mes.setdefault(mes, {})
            por_mes[mes][r.funcion] = por_mes[mes].get(r.funcion, 0.0) + r.costo_usd
            if r.fecha:
                por_dia[r.fecha] = por_dia.get(r.fecha, 0.0) + r.costo_usd

        meses_ord = sorted(por_mes)[-max(1, meses):]
        serie = []
        for m in meses_ord:
            pf = {k: round(v, 4) for k, v in por_mes[m].items()}
            try:
                mm = int(m[5:7])
            except ValueError:
                mm = 0
            serie.append({"mes": m, "nombre": _MES_ABBR[mm] if 0 < mm < 13 else m,
                          "por_funcion": pf, "total": round(sum(pf.values()), 4)})

        mes_actual = ahora.strftime("%Y-%m")
        mm = int(mes_actual[5:7])
        actual = por_mes.get(mes_actual, {})
        por_funcion = sorted(
            ({"funcion": k, "costo_usd": round(v, 4)} for k, v in actual.items()),
            key=lambda x: x["costo_usd"], reverse=True)
        total_mes = round(sum(actual.values()), 4)

        anteriores = [m for m in sorted(por_mes) if m < mes_actual]
        prev_total = round(sum(por_mes[anteriores[-1]].values()), 4) if anteriores else 0.0
        delta = round((total_mes - prev_total) / prev_total * 100, 0) if prev_total > 0 else None

        return {
            "mes_actual": mes_actual,
            "mes_nombre": f"{_MES_NOMBRE[mm]} {mes_actual[:4]}" if 0 < mm < 13 else mes_actual,
            "dias_transcurridos": ahora.day,
            "total_mes": total_mes,
            "prev_total": prev_total,
            "delta_pct": delta,
            "por_funcion": por_funcion,
            "meses": serie,
            "por_dia": {k: round(v, 4) for k, v in por_dia.items()},
        }
    finally:
        db.close()
