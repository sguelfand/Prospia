"""Pantalla Precios: parámetros comerciales por cliente + catálogo de servicios
con costo + margen de ganancia contra los costos REALES del monitor de Tokens.

Fuentes de datos:
- ClientePricing (lo que Sebi quiere cobrar + estimación $/conversación y motores).
- ServicioCosto (catálogo de todo lo que gasta plata; None = dato faltante).
- CamilaAuditMensual (costo y conversaciones reales del mes → $/conv MEDIDO).
- anthropic_usage (gastos internos de IA por mes).

Regla comercial acordada (22/7): los fijos COMPARTIDOS (Hetzner, dominio) van
APARTE como "costo de estructura" (con prorrateo informativo); el margen por
cliente usa solo sus costos directos.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

# Días laborales por mes: Sebi cuenta 22 (sin fines de semana — el bot casi no
# tiene movimiento sábado/domingo), no 30,4 corridos.
DIAS_MES = 22
# Umbral de la alerta: desvío del $/conv medido vs el cotizado que dispara
# oportunidad + push (pedido de Sebi 22/7: "si el promedio está cambiando a lo
# cotizado, avisame con una notificación").
DESVIO_ALERTA = 0.30
MIN_CONV_ALERTA = 15  # conversaciones mínimas del mes para que el promedio sea creíble

# Estimación de referencia de Etiguel (GLM 5.2 por MyClaw, medida/validada 22/7:
# cache automático 76% de hit, cached input a $0 — memoria project_prospia_costos).
COSTO_CONV_ETIGUEL_USD = 0.052

# Fallback de modelo UNIVERSAL para todo cliente: cuando el primario (MyClaw/
# OpenRouter) se cae, el guardián del bot cae a Anthropic directo con la MISMA key
# de Sebi (cuenta única para todos — baseline implementador punto 22). Por eso el
# fallback es conocido de antemano en cualquier cliente.
MOTOR_FALLBACK_DEFAULT = "anthropic/claude-sonnet-4-6"


def _db():
    from app.database import SessionLocal
    return SessionLocal()


# ── seed ──────────────────────────────────────────────────────────────────────

_SEED_SERVICIOS = [
    # (nombre, tipo, costo_mensual_usd | None = falta el dato, detalle)
    ("Tokens del bot (motor LLM)", "variable", None,
     "Costo de las conversaciones del agente (GLM/MyClaw/OpenRouter según motor). "
     "Se calcula solo: conversaciones/día × 22 (días laborales) × costo por conversación. No se carga a mano."),
    ("Tokens internos Anthropic", "variable", None,
     "Especialistas de Calidad y Negocio (1×/día), diagnóstico IA de costos, asistentes "
     "Haiku (ayuda web + relevamiento). Se toma del gasto real del mes (monitor Tokens → Anthropic)."),
    ("Scraping Apify", "variable", None,
     "Corridas de scraping para encontrar prospectos. Cargar el gasto mensual aproximado "
     "del plan/consumo de Apify."),
    ("Corridas Test LLM", "variable", 0.0,
     "Simulaciones de conversaciones para comparar motores. Puntuales y de centavos; "
     "solo se corren a demanda (gate + botón manual)."),
    ("Hosting OpenClaw (container MyClaw)", "fijo_cliente", None,
     "Cada cliente necesita su instancia OpenClaw. Cargar cuánto cuesta el container "
     "de MyClaw por mes (dato faltante — ver factura MyClaw)."),
    ("Número de WhatsApp", "fijo_cliente", None,
     "Línea/chip del bot. Definir si lo pone el cliente ($0 para Prospia) o nosotros."),
    ("Servidor Hetzner (Coolify)", "fijo_compartido", None,
     "Corre backend + web + DB de Prospia para TODOS los clientes. Cargar la factura "
     "mensual de Hetzner (dato faltante)."),
    ("Dominio prospia.app", "fijo_compartido", None,
     "Renovación anual prorrateada por mes. Cargar el monto (dato faltante)."),
    ("Resend (mails)", "fijo_compartido", 0.0, "Tier libre hoy. Si se supera, actualizar acá."),
    ("Expo EAS + push", "fijo_compartido", 0.0, "Tier libre hoy (OTA + push de la app admin)."),
    ("GitHub Actions (tests diarios)", "fijo_compartido", 0.0, "Dentro del tier libre."),
]


def seed() -> None:
    """Carga inicial idempotente: pricing de etiguel + catálogo de servicios."""
    from app.models.pricing import ClientePricing, ServicioCosto
    db = _db()
    try:
        if not db.query(ClientePricing).filter(ClientePricing.source == "etiguel").first():
            db.add(ClientePricing(
                source="etiguel",
                costo_conv_usd=COSTO_CONV_ETIGUEL_USD,
                costo_conv_origen="medido",
                motor_primario="myclaw/GLM 5.2",
                motor_fallback=MOTOR_FALLBACK_DEFAULT,
                notas="Costo/conv = GLM 5.2 por MyClaw con cache automático (medición 22/7)."))
        for nombre, tipo, costo, detalle in _SEED_SERVICIOS:
            if not (db.query(ServicioCosto)
                    .filter(ServicioCosto.nombre == nombre, ServicioCosto.source.is_(None))
                    .first()):
                db.add(ServicioCosto(nombre=nombre, tipo=tipo, source=None,
                                     costo_mensual_usd=costo, detalle=detalle))
        db.commit()
    finally:
        db.close()


# ── datos medidos ─────────────────────────────────────────────────────────────

def _mes_actual() -> str:
    return datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=-3))).strftime("%Y-%m")


def costo_conv_medido(source: str) -> dict | None:
    """$/conversación REAL del monitor (rollup mensual). Usa el mes actual si tiene
    muestra suficiente; si no, el anterior. None si no hay datos creíbles."""
    from app.models.camila_audit import CamilaAuditMensual
    db = _db()
    try:
        rows = (db.query(CamilaAuditMensual)
                .filter(CamilaAuditMensual.source == source)
                .order_by(CamilaAuditMensual.mes.desc()).limit(3).all())
        for r in rows:
            if r.conversaciones and r.conversaciones >= MIN_CONV_ALERTA and r.costo_usd:
                return {"valor": round(r.costo_usd / r.conversaciones, 4),
                        "mes": r.mes, "conversaciones": r.conversaciones,
                        "costo_mes": round(r.costo_usd, 2)}
        return None
    finally:
        db.close()


def _anthropic_mes(source: str) -> float | None:
    """Gasto interno de Anthropic del mes actual (best effort)."""
    try:
        from app.services import anthropic_usage
        r = anthropic_usage.resumen(meses=1, source=source)
        return round(float(r.get("total_mes") or 0.0), 2)
    except Exception:
        return None


# ── resumen por cliente ───────────────────────────────────────────────────────

def _pricing_dict(p) -> dict:
    return {"source": p.source, "abono_mensual_usd": p.abono_mensual_usd,
            "conversaciones_dia": p.conversaciones_dia,
            "costo_conv_usd": p.costo_conv_usd, "costo_conv_origen": p.costo_conv_origen,
            "motor_primario": p.motor_primario, "motor_fallback": p.motor_fallback,
            "notas": p.notas or "",
            "updated_at": p.updated_at.isoformat() if p.updated_at else None}


def _servicio_dict(s) -> dict:
    return {"id": s.id, "nombre": s.nombre, "tipo": s.tipo, "source": s.source,
            "costo_mensual_usd": s.costo_mensual_usd, "detalle": s.detalle or ""}


def _servicios_para(db, source: str, tipo: str) -> list[dict]:
    """Servicios de un tipo: instancia del cliente si existe, si no la plantilla."""
    from app.models.pricing import ServicioCosto
    plantillas = (db.query(ServicioCosto)
                  .filter(ServicioCosto.tipo == tipo, ServicioCosto.source.is_(None)).all())
    propios = {s.nombre: s for s in db.query(ServicioCosto)
               .filter(ServicioCosto.tipo == tipo, ServicioCosto.source == source).all()}
    out = []
    for p in plantillas:
        s = propios.get(p.nombre, p)
        d = _servicio_dict(s)
        d["es_plantilla"] = s.source is None
        out.append(d)
    # instancias del cliente sin plantilla (servicios ad-hoc)
    for nombre, s in propios.items():
        if not any(o["nombre"] == nombre for o in out):
            d = _servicio_dict(s); d["es_plantilla"] = False; out.append(d)
    return out


def _motores_registrados(db) -> list[dict]:
    from app.models.test_llm import TestLlmMotor
    return [{"id": m.id, "nombre": m.nombre, "provider": m.provider,
             "model_id": m.model_id, "es_actual": bool(m.es_actual),
             "precio_in": m.precio_in, "precio_out": m.precio_out,
             "precio_cache_read": m.precio_cache_read,
             "precio_cache_write": m.precio_cache_write}
            for m in db.query(TestLlmMotor).filter(TestLlmMotor.activo.is_(True)).all()]


def get_resumen(source: str) -> dict:
    """Todo lo que muestra la pantalla Precios para un cliente."""
    from app.models.pricing import ClientePricing
    from app.services import camila_audit
    seed()
    db = _db()
    try:
        p = db.query(ClientePricing).filter(ClientePricing.source == source).first()
        if not p:
            # cliente nuevo: arranca con la estimación de Etiguel + leyenda y el
            # fallback universal ya cargado (mismo para todos, ver punto 22 baseline)
            p = ClientePricing(source=source, costo_conv_usd=COSTO_CONV_ETIGUEL_USD,
                               costo_conv_origen="estimado_etiguel",
                               motor_fallback=MOTOR_FALLBACK_DEFAULT)
            db.add(p); db.commit(); db.refresh(p)
        pricing = _pricing_dict(p)
        medido = costo_conv_medido(source)
        anthropic = _anthropic_mes(source)

        conv_dia = p.conversaciones_dia or 0.0
        costo_conv = p.costo_conv_usd or 0.0
        tokens_bot_mes = round(conv_dia * DIAS_MES * costo_conv, 2)

        fijos_cliente = _servicios_para(db, source, "fijo_cliente")
        variables = _servicios_para(db, source, "variable")
        # Apify u otros variables cargados a mano
        variables_cargados = sum(s["costo_mensual_usd"] or 0.0 for s in variables
                                 if s["nombre"] not in ("Tokens del bot (motor LLM)",
                                                        "Tokens internos Anthropic"))
        fijos_cliente_total = sum(s["costo_mensual_usd"] or 0.0 for s in fijos_cliente)
        costo_total = round(tokens_bot_mes + (anthropic or 0.0)
                            + variables_cargados + fijos_cliente_total, 2)

        abono = p.abono_mensual_usd
        margen = None
        if abono is not None:
            ganancia = round(abono - costo_total, 2)
            margen = {"abono": abono, "costo_total": costo_total, "ganancia": ganancia,
                      "pct": round(ganancia / abono * 100, 1) if abono else None}

        # estructura (fijos compartidos) — APARTE del margen por cliente
        from app.models.pricing import ServicioCosto as _SC
        compartidos = [_servicio_dict(s) | {"es_plantilla": True}
                       for s in db.query(_SC).filter(_SC.tipo == "fijo_compartido",
                                                     _SC.source.is_(None)).all()]
        estructura_total = sum(s["costo_mensual_usd"] or 0.0 for s in compartidos)
        n_clientes = max(len(camila_audit.SOURCES), 1)
        estructura = {"servicios": compartidos, "total": round(estructura_total, 2),
                      "n_clientes": n_clientes,
                      "prorrateo_por_cliente": round(estructura_total / n_clientes, 2)}

        # datos faltantes (la pantalla se los pide a Sebi)
        faltantes = []
        if p.abono_mensual_usd is None:
            faltantes.append("Cargar el abono mensual que se le cobra a este cliente.")
        if p.conversaciones_dia is None:
            faltantes.append("Cargar las conversaciones diarias estimadas (para proyectar el costo de tokens).")
        if p.costo_conv_origen == "estimado_etiguel":
            faltantes.append("El costo por conversación es la estimación de Etiguel — correr una "
                             "simulación en Testing → Motores LLM para valores reales de este cliente.")
        if not p.motor_primario:
            faltantes.append("Definir el motor LLM primario del bot.")
        if not p.motor_fallback:
            faltantes.append("Confirmar el motor fallback contra la config viva del bot.")
        for s in fijos_cliente + compartidos + variables:
            if s["costo_mensual_usd"] is None and s["nombre"] not in (
                    "Tokens del bot (motor LLM)", "Tokens internos Anthropic"):
                faltantes.append(f"Completar el costo mensual de: {s['nombre']}.")

        return {
            "source": source,
            "pricing": pricing,
            "medido": medido,  # $/conv real del monitor (None si sin muestra)
            "motores_registrados": _motores_registrados(db),
            "costos": {
                "tokens_bot_mes": tokens_bot_mes,
                "anthropic_mes": anthropic,
                "variables": variables,
                "fijos_cliente": fijos_cliente,
                "fijos_cliente_total": round(fijos_cliente_total, 2),
                "total": costo_total,
            },
            "margen": margen,
            "estructura": estructura,
            "datos_faltantes": faltantes,
            "desvio_alerta_pct": int(DESVIO_ALERTA * 100),
        }
    finally:
        db.close()


def get_general() -> dict:
    """Comparativa de margen entre todos los clientes (vista General)."""
    from app.services import camila_audit
    clientes = []
    for src in camila_audit.SOURCES:
        r = get_resumen(src)
        clientes.append({
            "source": src,
            "nombre": camila_audit.SOURCES[src]["nombre"],
            "abono": r["pricing"]["abono_mensual_usd"],
            "costo_total": r["costos"]["total"],
            "margen": r["margen"],
            "faltantes": len(r["datos_faltantes"]),
        })
    est = get_resumen(list(camila_audit.SOURCES)[0])["estructura"] if camila_audit.SOURCES else None
    return {"clientes": clientes, "estructura": est}


# ── updates ───────────────────────────────────────────────────────────────────

_CAMPOS_PRICING = {"abono_mensual_usd", "conversaciones_dia", "costo_conv_usd",
                   "costo_conv_origen", "motor_primario", "motor_fallback", "notas"}


def actualizar_pricing(source: str, campos: dict) -> dict:
    from app.models.pricing import ClientePricing
    db = _db()
    try:
        p = db.query(ClientePricing).filter(ClientePricing.source == source).first()
        if not p:
            p = ClientePricing(source=source); db.add(p)
        for k, v in campos.items():
            if k in _CAMPOS_PRICING:
                setattr(p, k, v)
        # si Sebi carga a mano un costo distinto al de Etiguel, ya no es "estimado_etiguel"
        if "costo_conv_usd" in campos and "costo_conv_origen" not in campos:
            if campos["costo_conv_usd"] != COSTO_CONV_ETIGUEL_USD:
                p.costo_conv_origen = "manual"
        db.commit(); db.refresh(p)
        return _pricing_dict(p)
    finally:
        db.close()


def guardar_servicio(datos: dict, servicio_id: int | None = None) -> dict:
    from app.models.pricing import ServicioCosto
    db = _db()
    try:
        if servicio_id:
            s = db.query(ServicioCosto).filter(ServicioCosto.id == servicio_id).first()
            if not s:
                raise ValueError("servicio inexistente")
        else:
            s = ServicioCosto(nombre=datos.get("nombre", ""), tipo=datos.get("tipo", "fijo_compartido"))
            db.add(s)
        for k in ("nombre", "tipo", "source", "costo_mensual_usd", "detalle"):
            if k in datos:
                setattr(s, k, datos[k])
        db.commit(); db.refresh(s)
        return _servicio_dict(s)
    finally:
        db.close()


def borrar_servicio(servicio_id: int) -> bool:
    from app.models.pricing import ServicioCosto
    db = _db()
    try:
        s = db.query(ServicioCosto).filter(ServicioCosto.id == servicio_id).first()
        if not s:
            return False
        db.delete(s); db.commit()
        return True
    finally:
        db.close()


def set_costo_cliente(source: str, nombre: str, costo: float | None, tipo: str, detalle: str = "") -> dict:
    """Override por cliente de un servicio de la plantilla (o alta ad-hoc)."""
    from app.models.pricing import ServicioCosto
    db = _db()
    try:
        s = (db.query(ServicioCosto)
             .filter(ServicioCosto.nombre == nombre, ServicioCosto.source == source).first())
        if not s:
            s = ServicioCosto(nombre=nombre, tipo=tipo, source=source, detalle=detalle)
            db.add(s)
        s.costo_mensual_usd = costo
        if detalle:
            s.detalle = detalle
        db.commit(); db.refresh(s)
        return _servicio_dict(s)
    finally:
        db.close()


# ── simulación (botón manual) ─────────────────────────────────────────────────

def crear_simulacion(source: str) -> dict:
    """Crea una corrida del Test LLM (estado 'estimada', NO gasta tokens todavía)
    con los motores activos y todos los escenarios. Se corre desde Testing →
    Motores LLM (gate + confirmación, como siempre)."""
    from app.models.test_llm import TestLlmMotor, TestLlmEscenario
    from app.services import test_llm as test_llm_svc
    db = _db()
    try:
        motores = [m.id for m in db.query(TestLlmMotor).filter(TestLlmMotor.activo.is_(True)).all()]
        escenarios = [e.id for e in db.query(TestLlmEscenario).all()]
    finally:
        db.close()
    if not motores or not escenarios:
        raise ValueError("no hay motores/escenarios cargados para simular")
    return test_llm_svc.crear_corrida(source, motores, escenarios,
                                      nombre=f"Simulación de costos ({source})")


# ── alerta de desvío (la consume camila_audit.run_audit) ─────────────────────

def check_desvio(source: str) -> dict | None:
    """Si el $/conversación MEDIDO del mes se desvía más de DESVIO_ALERTA del
    cotizado en Precios → oportunidad (que dispara el push del monitor)."""
    from app.models.pricing import ClientePricing
    db = _db()
    try:
        p = db.query(ClientePricing).filter(ClientePricing.source == source).first()
    finally:
        db.close()
    if not p or not p.costo_conv_usd:
        return None
    m = costo_conv_medido(source)
    if not m:
        return None
    cotizado, medido = p.costo_conv_usd, m["valor"]
    desvio = (medido - cotizado) / cotizado
    if abs(desvio) < DESVIO_ALERTA:
        return None
    direccion = "MÁS caro" if desvio > 0 else "más barato"
    return {"tipo": "desvio_cotizacion", "clave": "",
            "severidad": "alta" if desvio > 1.0 else "media",
            "titulo": f"Costo/conversación real ${medido:.3f} vs cotizado ${cotizado:.3f} "
                      f"({desvio*100:+.0f}%)",
            "detalle": f"El promedio del mes {m['mes']} ({m['conversaciones']} conversaciones) está "
                       f"{abs(desvio)*100:.0f}% {direccion} que lo cargado en Precios. Revisar el motor/"
                       f"conversaciones y actualizar la cotización o el abono del cliente."}
