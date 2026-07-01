"""Diagnóstico de costos por IA (#1-opcional).

El motor de costos (`camila_audit`) ya detecta por REGLAS fijas las oportunidades
conocidas (timeouts, fallback a modelo caro, cache ineficiente, compactaciones,
conversación cara). Este módulo agrega ENCIMA una capa de criterio: 1×/día le pasa
a Claude el resumen del día + las conversaciones más caras y le pide que encuentre
oportunidades de ahorro DISTINTAS a esas reglas (patrones nuevos que nadie anticipó).

Sus hallazgos entran a la MISMA tabla `CamilaOportunidad` con `tipo="ia"` (dedup por
una clave-slug estable que devuelve el modelo) → se ven en la misma página Tokens,
con un chip "IA" para distinguirlas. NO auto-aplica nada: avisa, Sebi decide.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone

from app.services.camila_quality import _post, _parse_json

_BA = timezone(timedelta(hours=-3))
MAX_CONV_CONTEXTO = 12

# Lo que YA detectan las reglas (para pedirle al modelo que NO repita esto).
_REGLAS_CONOCIDAS = (
    "timeouts/errores de llamadas, uso de modelo caro (opus) como fallback, "
    "cacheWrite alto vs cacheRead (cache ineficiente), muchas compactaciones de "
    "contexto, y la conversación más cara del día"
)

# Contexto fijo del análisis de costo de Camila (ver memoria de costos).
_CONTEXTO_COSTO = (
    "Datos clave del costo de Camila (agente de WhatsApp sobre el gateway MyClaw, "
    "precios = 10% bajo lista de Anthropic):\n"
    "- El driver del costo es el CACHE (cacheRead + cacheWrite), no el modelo ni el "
    "input. La sesión por chat re-lee/re-escribe el contexto cada turno.\n"
    "- sonnet es el modelo correcto; haiku NO conviene (su cacheRead no tiene "
    "descuento, sale más caro); opus es ~1.67× sonnet, solo fallback.\n"
    "- El TTL del cache (5 min default) vence entre turnos porque los clientes "
    "contestan a las horas → se re-escribe todo el contexto (ya hay un experimento "
    "cacheRetention=long en curso).\n"
    "Buscá oportunidades de ahorro CONCRETAS y ACCIONABLES que NO sean las que ya "
    "detectan las reglas automáticas (" + _REGLAS_CONOCIDAS + ")."
)


def _resumen_compacto(data: dict) -> str:
    t = data.get("totales", {})
    pm = data.get("por_modelo", {})
    convs = (data.get("conversaciones") or data.get("top_conversaciones") or [])[:MAX_CONV_CONTEXTO]
    lin = [
        f"Totales del día: costo ${t.get('costo_usd', 0):.3f}, {t.get('llamadas', 0)} llamadas, "
        f"input={t.get('input', 0):,} output={t.get('output', 0):,} "
        f"cacheRead={t.get('cacheRead', 0):,} cacheWrite={t.get('cacheWrite', 0):,}, "
        f"errores={t.get('errores', 0)} timeouts={t.get('timeouts', 0)} "
        f"compactaciones={t.get('compactaciones', 0)}.",
        "Por modelo: " + ", ".join(
            f"{m}: {v.get('llamadas', 0)} llamadas ${v.get('costo_usd', 0):.3f}"
            for m, v in pm.items()) + ".",
        "Conversaciones (más caras primero):",
    ]
    for c in convs:
        if c.get("es_sistema"):
            continue
        modelos = ",".join(c.get("por_modelo", {}).keys())
        lin.append(
            f"- {c.get('nombre') or c.get('telefono')}: ${c.get('costo_usd', 0):.3f}, "
            f"{c.get('llamadas', 0)} llamadas, cacheRead={c.get('cacheRead', 0):,} "
            f"cacheWrite={c.get('cacheWrite', 0):,}, modelos: {modelos}")
    return "\n".join(lin)


def diagnosticar(source: str = "etiguel", fecha: str | None = None, notify: bool = True) -> dict:
    """Corre el diagnóstico IA sobre el día y acumula oportunidades tipo='ia'."""
    from app.services import camila_audit
    if source not in camila_audit.SOURCES:
        raise ValueError(f"source desconocido: {source}")
    fecha = fecha or _ayer_ba()
    data = camila_audit.get_dia(source, fecha)
    if not data or not (data.get("conversaciones") or data.get("top_conversaciones")):
        return {"source": source, "fecha": fecha, "oportunidades_ia": 0, "vacio": True}

    system = (
        "Sos un especialista en optimización de costos de agentes de IA (LLMs sobre "
        "API con prompt caching). Te paso el consumo de un día de Camila y tenés que "
        "encontrar oportunidades de bajar el costo que sean NUEVAS, distintas de las "
        "reglas automáticas. Sé concreto: nada de generalidades. Si no encontrás nada "
        "nuevo que valga la pena, devolvé lista vacía.\n\n"
        + _CONTEXTO_COSTO + "\n\n"
        "Respondé SOLO con JSON válido (sin texto alrededor, sin ```):\n"
        '{"oportunidades": [{"clave": "<slug-corto-estable-kebab>", '
        '"severidad": "alta"|"media"|"baja", "titulo": "<máx 110 car>", '
        '"detalle": "<qué viste y qué hacer, 1-3 oraciones>"}]}'
    )
    # Dedup semántico: el modelo inventa una `clave` distinta cada corrida para el
    # MISMO hallazgo, así que el dedup por (source,tipo,clave) nunca matchea y se
    # acumulan casi-duplicados. Le pasamos las oportunidades YA abiertas (de reglas y
    # de IA) y le pedimos que no las repita ni reformule → solo devuelve lo nuevo.
    abiertas = camila_audit.get_oportunidades(source, incluir_resueltas=False)
    ya_track = "\n".join(f"- {o['titulo']}" for o in abiertas)
    bloque_track = (
        "\n\nYA HAY oportunidades abiertas registradas (NO las repitas ni reformules; "
        "solo devolvé hallazgos GENUINAMENTE nuevos y distintos a estos):\n" + ya_track
    ) if ya_track else ""

    user = (f"Consumo del {fecha} de {camila_audit.SOURCES[source]['nombre']}:\n\n"
            f"{_resumen_compacto(data)}{bloque_track}")
    parsed = _parse_json(_post(system, user, max_tokens=1200, funcion="Diagnóstico de costos (IA)", source=source))
    ops_raw = (parsed or {}).get("oportunidades") or []

    ops = []
    for o in ops_raw:
        clave = (o.get("clave") or "").strip()[:80]
        titulo = (o.get("titulo") or "").strip()
        if not clave or not titulo:
            continue
        sev = (o.get("severidad") or "media").strip()
        if sev not in ("alta", "media", "baja"):
            sev = "media"
        ops.append({"tipo": "ia", "clave": clave, "severidad": sev,
                    "titulo": titulo[:200], "detalle": (o.get("detalle") or "")[:2000]})

    # Mismo cap por monto absoluto que las reglas: una oportunidad de costo 'alta' en
    # un día barato es ruido (los $/día acá son chicos → casi todo cae a media/baja).
    camila_audit._cap_severidad_por_monto(ops, (data.get("totales") or {}).get("costo_usd", 0.0))

    nuevas = camila_audit._upsert_oportunidades(source, ops) if ops else 0

    if notify and nuevas > 0:
        try:
            from app.services import push
            push.notificar_global(
                "tokens_oportunidad",
                f"💡 {camila_audit.SOURCES[source]['nombre']}: {nuevas} oportunidad(es) de costo (IA)",
                "El analista de costos encontró algo nuevo. Entrá a Monitoreo → Tokens.",
                {"tipo": "tokens", "source": source, "nav": "tokens"},
            )
        except Exception as e:
            print(f"[CAMILA-COST-AI] push: {type(e).__name__}: {e}")
    return {"source": source, "fecha": fecha, "oportunidades_ia": len(ops), "nuevas": nuevas}


def _ayer_ba() -> str:
    return (datetime.now(_BA) - timedelta(days=1)).strftime("%Y-%m-%d")


def _hoy_ba() -> str:
    return datetime.now(_BA).strftime("%Y-%m-%d")


def start():
    def loop():
        # Más tarde que camila_audit (que computa el día) para leer get_dia ya poblado.
        time.sleep(300)
        from app.services import camila_audit
        last_day = None
        while True:
            hoy = _hoy_ba()
            if last_day != hoy:  # 1×/día sobre el día anterior (ya cerrado)
                for source in camila_audit.SOURCES:
                    try:
                        diagnosticar(source, _ayer_ba(), notify=True)
                    except Exception as e:
                        print(f"[CAMILA-COST-AI] {source}: {type(e).__name__}: {e}")
                last_day = hoy
            time.sleep(3 * 3600)

    threading.Thread(target=loop, daemon=True, name="camila-cost-ai").start()
