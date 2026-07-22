import os
import random
import time
from datetime import datetime, timedelta, timezone

import requests

# Reintentos del envío de WhatsApp ante fallo transitorio del gateway. Sin esto,
# un fallo puntual del gateway (HTTP 5xx/429, ok=false por colisión de sesión)
# dejaba al prospect clavado en su estado actual, sin reintento ni aviso.
WA_SEND_MAX_INTENTOS  = int(os.environ.get("WA_SEND_MAX_INTENTOS", "3"))
WA_SEND_RETRY_DELAY_S = float(os.environ.get("WA_SEND_RETRY_DELAY_S", "5"))

# Anti-ráfaga (Parte A, paridad Etiguel): la cola ya espacia los envíos masivos,
# pero el botón "Contactar" inmediato podría disparar varios a la vez. Serializamos
# los envíos al gateway con un gap mínimo reservando "slots" → la sesión del agente
# no se satura. import threading local para no tocar imports de arriba.
import threading
WA_SEND_GAP_S = float(os.environ.get("WA_SEND_GAP_S", "8"))
_wa_send_gate_lock = threading.Lock()
_wa_send_next_ts = 0.0

# Reintentos automáticos cuando un envío no se confirma (Parte B): tras la ventana
# sin 'out', re-inyecta el mensaje hasta N veces antes de avisar. 1 = un reintento.
WA_CONFIRM_MAX_REINTENTOS = int(os.environ.get("WA_CONFIRM_MAX_REINTENTOS", "1"))


def _wa_send_throttle():
    """Reserva atómicamente el próximo slot (WA_SEND_GAP_S después del anterior) y
    duerme hasta ahí FUERA del lock. Convierte una ráfaga en una fila espaciada."""
    global _wa_send_next_ts
    if WA_SEND_GAP_S <= 0:
        return
    with _wa_send_gate_lock:
        ahora = time.time()
        slot = max(ahora, _wa_send_next_ts)
        _wa_send_next_ts = slot + WA_SEND_GAP_S
    espera = slot - time.time()
    if espera > 0:
        time.sleep(espera)

# Templates de prospección genéricos (5 variantes, rotación anti-ban)
WA_TEMPLATES = [
    "Hola buen día! Mi nombre es {agente}, te contacto de parte de {empresa}. "
    "Estuve viendo su página web y creo que podrían estar interesados en lo que hacemos. "
    "¿Me podrías pasar el contacto de la persona que se ocupe de compras? Muchas gracias!",

    "Hola! Soy {agente} de {empresa}. Vi su empresa y me parece que podemos trabajar juntos. "
    "¿Hay alguien de compras con quien pueda hablar? Gracias!",

    "Buenas! Te escribo de {empresa}, soy {agente}. "
    "Revisé su web y creemos que nuestros productos/servicios les pueden ser útiles. "
    "¿Con quién puedo hablar sobre compras o proveedores? Saludos!",

    "Hola buen día, soy {agente} de {empresa}. "
    "Quería presentarles brevemente lo que hacemos, creo que puede interesarles. "
    "¿Me pueden indicar con quién hablar del área de compras? Muchas gracias!",

    "Hola! Mi nombre es {agente}, trabajo en {empresa}. "
    "Vi su empresa y me gustaría presentarles una propuesta. "
    "¿Podrían pasarme el contacto del responsable de compras? Gracias y buen día!",
]

# Templates de RECONTACTO (2°+ contacto: el prospect no respondió el mensaje
# anterior). Se mandan con el prefijo ENVIAR_RECONTACTO para que el bot del tenant
# NO los dedupee como duplicado del 1er contacto (mismo fix que el webhook Etiguel).
WA_TEMPLATES_RECONTACTO = [
    "Hola! Soy {agente} de {empresa}, quería saber si pudiste ver el mensaje que te mandé.",
    "Hola, te escribo de nuevo de {empresa} (soy {agente}), llegaste a ver mi mensaje anterior?",
    "Hola! Soy {agente} de {empresa}. Te había escrito hace unos días, pudiste verlo?",
]


def _get_template(
    agente: str = "Camila",
    empresa: str = "nuestra empresa",
    templates: list[str] | None = None,
    recontacto: bool = False,
) -> str:
    """Elige un template al azar (rotación anti-ban). Reemplazo tolerante de
    {agente}/{empresa}. `recontacto=True` (2°+ contacto sin respuesta) usa el set
    de recontacto ("viste mi último mensaje?") en vez del de presentación. Para
    recontacto se ignoran los templates de presentación del tenant (son intro)."""
    if recontacto:
        pool = WA_TEMPLATES_RECONTACTO
    else:
        pool = templates if templates else WA_TEMPLATES
    template = random.choice(pool)
    return template.replace("{agente}", agente).replace("{empresa}", empresa)


def _send_whatsapp(numero: str, mensaje: str, gateway_url: str, gateway_token: str,
                   session_key: str, recontacto: bool = False, prefijo: str | None = None) -> tuple[bool, str]:
    target = numero.lstrip('+').replace(' ', '').replace('-', '')
    # recontacto=True → prefijo ENVIAR_RECONTACTO: señal explícita al bot del tenant
    # de que es un recontacto intencional (mandarlo aunque ya haya contactado el
    # número, NO dedupear). 1er contacto → ENVIAR_PROSPECCION como siempre.
    # `prefijo` explícito (ej. ENVIAR_SEGUIMIENTO) tiene prioridad sobre `recontacto`.
    if prefijo is None:
        prefijo = "ENVIAR_RECONTACTO" if recontacto else "ENVIAR_PROSPECCION"
    payload_message = f"{prefijo}|{target}|{mensaje}"

    # Anti-ráfaga: espaciar envíos para no saturar la sesión del agente del tenant.
    _wa_send_throttle()

    try:
        resp = requests.post(
            gateway_url,
            headers={
                "Authorization": f"Bearer {gateway_token}",
                "Content-Type":  "application/json",
            },
            json={
                "tool": "sessions_send",
                "args": {
                    "sessionKey": session_key,
                    "message":    payload_message,
                },
            },
            timeout=10,
        )
    except requests.exceptions.Timeout:
        return True, "entregado (timeout esperando respuesta del agente, esperado)"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"

    if resp.status_code == 200:
        try:
            data = resp.json()
        except Exception:
            return True, "entregado (respuesta no es JSON)"
        if data.get("ok"):
            return True, "enviado"
        return False, f"gateway respondio ok=false: {data.get('error', data)}"

    return False, f"HTTP {resp.status_code}: {resp.text[:200]}"


def _send_whatsapp_con_retry(numero: str, mensaje: str, gateway_url: str, gateway_token: str, session_key: str, recontacto: bool = False, prefijo: str | None = None) -> tuple[bool, str]:
    """_send_whatsapp con reintentos + backoff ante fallo transitorio del gateway.

    Reintenta hasta WA_SEND_MAX_INTENTOS veces con WA_SEND_RETRY_DELAY_S de espera
    entre intentos. Corta apenas un intento sale OK. Corre en thread daemon: la
    espera no bloquea el response. Si se agotan los intentos retorna (False, motivo)."""
    ultimo_info = ""
    for intento in range(1, WA_SEND_MAX_INTENTOS + 1):
        ok, info = _send_whatsapp(numero, mensaje, gateway_url, gateway_token, session_key, recontacto=recontacto, prefijo=prefijo)
        if ok:
            if intento > 1:
                return True, f"{info} (OK en intento {intento}/{WA_SEND_MAX_INTENTOS})"
            return True, info
        ultimo_info = info
        print(f"[CONTACT] WA intento {intento}/{WA_SEND_MAX_INTENTOS} falló para {numero}: {info}")
        if intento < WA_SEND_MAX_INTENTOS:
            time.sleep(WA_SEND_RETRY_DELAY_S)
    return False, f"falló tras {WA_SEND_MAX_INTENTOS} intentos; último error: {ultimo_info}"


def _registrar_historial(db, prospect_id: int, tenant_id: int, tipo: str, detalle: str | None = None):
    from app.models.historial import ProspectHistorial
    entry = ProspectHistorial(
        prospect_id=prospect_id,
        tenant_id=tenant_id,
        tipo=tipo,
        detalle=detalle,
    )
    db.add(entry)


# Estados en los que un recontacto de cadencia YA no corresponde: el cliente
# respondió ('en_conversacion') o el prospect llegó a un estado terminal. Si un
# recontacto encolado llega a enviarse con el prospect en uno de estos, se aborta.
_ESTADOS_FRENA_RECONTACTO = {"en_conversacion", "interesado", "no_le_interesa", "cancelado"}


def contactar_prospect(prospect_id: int):
    """Corre en un thread daemon. Lee el prospect y la config del tenant.
    Lógica:
      - 1° contacto: solo WA si existe; si no, cae al email.
      - 2° en adelante: WA + email en paralelo (si hay mail cargado).
    El envío dual cuenta como 1 contacto (un intento, varios canales)."""
    from app.database import SessionLocal
    from app.models.prospect import Prospect
    from app.models.tenant import TenantConfig

    db = SessionLocal()
    try:
        prospect = db.get(Prospect, prospect_id)
        if not prospect:
            return

        config = db.query(TenantConfig).filter(
            TenantConfig.tenant_id == prospect.tenant_id
        ).first()

        gateway_url   = config.openclaw_gateway_url if config else ""
        session_key   = config.openclaw_session_id  if config else ""
        # Token del gateway POR tenant; fallback al env global por compatibilidad.
        import os
        gateway_token = (config.openclaw_gateway_token if config else None) \
            or os.environ.get("OPENCLAW_GATEWAY_TOKEN", "")

        wa = (prospect.whatsapp or "").strip()
        email = (prospect.email or "").strip()
        ahora = datetime.now(timezone.utc)
        contacto_n = (prospect.cant_contactos or 0) + 1   # número de este intento
        es_segundo_o_mas = contacto_n >= 2

        # Race guard (paridad con el webhook de Etiguel): un recontacto pudo quedar
        # encolado (estado 'en_cola') ANTES de que el cliente respondiera; la cola
        # drena lento (horario, delay, tope diario). Si al momento de ENVIAR el
        # prospect ya salió de cadencia (respondió → 'en_conversacion', o pasó a un
        # estado terminal), abortamos el recontacto para no mandarlo ENCIMA de su
        # respuesta. Solo aplica a recontactos (2°+); el 1er contacto sale igual.
        if es_segundo_o_mas and (prospect.estado or "") in _ESTADOS_FRENA_RECONTACTO:
            print(f"[CONTACT] recontacto ABORTADO prospect {prospect_id}: "
                  f"estado={prospect.estado!r} (cliente respondió / fuera de cadencia)")
            return

        wa_enviado    = False
        wa_info       = ""
        email_enviado = False

        # WhatsApp (prioridad siempre)
        if wa and gateway_url and gateway_token and session_key:
            agente  = (config.agente_nombre if config else None) or "Camila"
            empresa = (config.empresa_nombre_msg if config else None) or "nuestra empresa"
            templates = (config.wa_templates if config else None) or None
            # 2°+ contacto sin respuesta → recontacto (template "viste mi mensaje?"
            # + prefijo ENVIAR_RECONTACTO para que el bot no lo dedupee).
            mensaje = _get_template(agente=agente, empresa=empresa, templates=templates,
                                    recontacto=es_segundo_o_mas)
            wa_enviado, wa_info = _send_whatsapp_con_retry(wa, mensaje, gateway_url, gateway_token,
                                                          session_key, recontacto=es_segundo_o_mas)
            print(f"[CONTACT] WA {wa} → ok={wa_enviado} {wa_info} (recontacto={es_segundo_o_mas})")

        # Email: 1° contacto solo si WA no se mandó (cascada). 2°+ siempre que haya mail.
        debe_mandar_email = bool(email) and (es_segundo_o_mas or not wa_enviado)

        if debe_mandar_email:
            # TODO: envío SMTP real (no implementado). Por ahora solo registra historial.
            print(f"[CONTACT] Email {email} — envío real pendiente (placeholder)")
            email_enviado = True

        if wa_enviado or email_enviado:
            prospect.estado = "contactado"
            prospect.cant_contactos = contacto_n
            prospect.ult_contacto = ahora
            # Dejar agendado el próximo contacto = ahora + ventana de cadencia de
            # este contacto, para verlo en web/app. En el 4°+ no hay ventana → se
            # deja en None para que la cadencia lo cancele (no se recontacta).
            cadencia = (config.cadencia_dias if config and config.cadencia_dias
                        else {"1": 7, "2": 14, "3": 90})
            dias = cadencia.get(str(contacto_n))
            prospect.prox_contacto = (ahora + timedelta(days=int(dias))) if dias else None

            if wa_enviado:
                _registrar_historial(db, prospect.id, prospect.tenant_id, "contactado_wa",
                                     f"WA enviado a {wa} (contacto #{contacto_n}): {wa_info}")
                # Verificación de envío real: el "ok" del gateway no garantiza que
                # el WhatsApp haya salido. Quedamos esperando el 'out' real (chat-log);
                # si no llega en la ventana, el barrido avisa. Reset del flag previo.
                prospect.envio_pendiente_desde = ahora
                prospect.envio_no_confirmado = False
                prospect.envio_reintentos = 0
            if email_enviado:
                _registrar_historial(db, prospect.id, prospect.tenant_id, "contactado_email",
                                     f"Email a {email} (contacto #{contacto_n}, envío real pendiente)")
            db.commit()
            return

        # No se logró contactar por ningún canal. Si había WhatsApp y el envío
        # falló incluso tras reintentos, NO dejar el prospect mudo en su estado
        # actual: marcarlo visible (cancelado) para seguimiento manual, igual
        # que el webhook de Etiguel.
        wa_intentado = bool(wa and gateway_url and gateway_token and session_key)
        if wa_intentado and not email_enviado:
            prospect.estado = "cancelado"
            _registrar_historial(
                db, prospect.id, prospect.tenant_id, "cancelado_auto",
                f"No se pudo contactar por WhatsApp a {wa}: {wa_info}. "
                "Envío al gateway falló tras reintentos. Cancelado para seguimiento manual.",
            )
            db.commit()
            print(f"[CONTACT] Prospect {prospect_id} → cancelado por fallo de envío WA: {wa_info}")
            return

        print(f"[CONTACT] Prospect {prospect_id} sin WA ni email válido")

    except Exception as e:
        print(f"[CONTACT ERROR] {e}")
    finally:
        db.close()


# ── Reactivación de conversaciones abandonadas (#100) ─────────────────────────
# Paridad con el webhook de Etiguel. La cadencia normal corre sobre quien NUNCA
# respondió y se frena apenas el cliente contesta (pasa a 'en_conversacion', sale
# de la cola). Acá cubrimos el hueco opuesto: el cliente venía HABLANDO y dejó de
# contestar → lo reactivamos "¿viste mi mensaje?" a los +1/+3 días de su última
# respuesta (2 intentos). Si igual no contesta → cancelado + aviso a Sebi. Se frena
# solo apenas el cliente vuelve a escribir (revival). NO toca cant/ult_contacto (el
# estado lo llevan reactivacion_intentos/_base) → la cadencia normal no se entera.
REACT_DIAS = [1, 3]          # umbral de silencio (días) para el intento 1 y el 2
REACT_MAX_INTENTOS = 2


def _react_enabled() -> bool:
    return os.environ.get("REACTIVACION_ENABLED", "true").strip().lower() in ("1", "true", "yes", "on")


def reactivacion_decidir(estado, dias_silencio, intentos, tiene_prox_contacto, cliente_escribio_ultimo):
    """Decisión PURA de reactivación (sin DB ni red). Retorna (accion, motivo) con
    accion in {'reactivar', 'cerrar', 'nada'}. `dias_silencio` = días desde el
    último mensaje del cliente; `intentos` = reactivaciones ya mandadas."""
    if estado != "en_conversacion":
        return ("nada", f"estado no es en_conversacion: {estado!r}")
    if tiene_prox_contacto:
        return ("nada", "callback agendado: reactivación en pausa")
    if cliente_escribio_ultimo:
        return ("nada", "el cliente escribió último: la pelota es nuestra")
    if dias_silencio < REACT_DIAS[0]:
        return ("nada", f"conversación aún fresca ({dias_silencio}d de silencio)")
    if intentos >= REACT_MAX_INTENTOS:
        return ("cerrar", f"{intentos} reactivaciones sin respuesta")
    umbral = REACT_DIAS[intentos]
    if dias_silencio >= umbral:
        return ("reactivar", f"{dias_silencio}d de silencio → intento {intentos + 1}/{REACT_MAX_INTENTOS}")
    return ("nada", f"esperando intento {intentos + 1} ({dias_silencio}/{umbral}d)")


def _dentro_horario_cfg(cfg) -> bool:
    """True si estamos dentro de la ventana horaria de envío del tenant."""
    try:
        from zoneinfo import ZoneInfo
        ahora = datetime.now(ZoneInfo(cfg.timezone or "America/Argentina/Buenos_Aires"))
    except Exception:
        from zoneinfo import ZoneInfo
        ahora = datetime.now(ZoneInfo("America/Argentina/Buenos_Aires"))
    return cfg.envio_hora_inicio <= ahora.hour < cfg.envio_hora_fin


def reactivar_abandonadas():
    """Una pasada de reactivación (la llama el cadence job, cada hora). Solo tenants
    con envío automático habilitado y dentro de su ventana horaria. Manda la
    reactivación DIRECTO por el gateway (ENVIAR_RECONTACTO) sin tocar los contadores
    de Monday/estado; los intentos viven en el prospect. Best-effort."""
    if not _react_enabled():
        return
    from sqlalchemy import func

    from app.database import SessionLocal
    from app.models.mensaje import ProspectMensaje
    from app.models.prospect import Prospect
    from app.models.tenant import Tenant, TenantConfig
    from app.services import push

    db = SessionLocal()
    envios = []   # (wa, mensaje, gw_url, gw_token, sess, etiqueta)
    avisos = []
    try:
        ahora = datetime.now(timezone.utc)
        cfgs = {c.tenant_id: c for c in
                db.query(TenantConfig).filter(TenantConfig.envio_auto_habilitado.is_(True)).all()}
        if not cfgs:
            return
        prospects = (
            db.query(Prospect)
            .filter(
                Prospect.estado == "en_conversacion",
                Prospect.prox_contacto.is_(None),
                Prospect.seguimiento_proxima.is_(None),  # en escalera de seguimiento → exento
                Prospect.bloqueado.is_(False),
                Prospect.tenant_id.in_(list(cfgs.keys())),
            )
            .all()
        )
        for p in prospects:
            cfg = cfgs.get(p.tenant_id)
            if not cfg or not _dentro_horario_cfg(cfg):
                continue
            wa = (p.whatsapp or "").strip()
            gateway_url = cfg.openclaw_gateway_url or ""
            session_key = cfg.openclaw_session_id or ""
            gateway_token = (cfg.openclaw_gateway_token or os.environ.get("OPENCLAW_GATEWAY_TOKEN", ""))
            if not (wa and gateway_url and gateway_token and session_key):
                continue

            # Última respuesta del cliente (último 'in') + dirección del último mensaje.
            last_in = (
                db.query(func.max(ProspectMensaje.fecha))
                .filter(ProspectMensaje.prospect_id == p.id, ProspectMensaje.direccion == "in")
                .scalar()
            )
            if last_in is None:
                continue
            ultimo = (
                db.query(ProspectMensaje.direccion)
                .filter(ProspectMensaje.prospect_id == p.id)
                .order_by(ProspectMensaje.fecha.desc())
                .first()
            )
            cliente_escribio_ultimo = bool(ultimo and ultimo[0] == "in")

            # Revival: respondió algo más nuevo que la base → conversación reactivada.
            if p.reactivacion_base is not None and last_in > p.reactivacion_base:
                p.reactivacion_intentos = 0
                p.reactivacion_base = None

            dias = (ahora - last_in).days
            intentos = p.reactivacion_intentos or 0
            accion, motivo = reactivacion_decidir(
                p.estado, dias, intentos, p.prox_contacto is not None, cliente_escribio_ultimo)

            if accion == "reactivar":
                agente = cfg.agente_nombre or "Camila"
                empresa = cfg.empresa_nombre_msg or "nuestra empresa"
                mensaje = _get_template(agente=agente, empresa=empresa, recontacto=True)
                p.reactivacion_intentos = intentos + 1
                if p.reactivacion_base is None:
                    p.reactivacion_base = last_in
                _registrar_historial(
                    db, p.id, p.tenant_id, "reactivacion",
                    f"Reactivación {intentos + 1}/{REACT_MAX_INTENTOS}: {dias}d sin respuesta del "
                    f"cliente (conversación que se colgó). Re-preguntando si vio el mensaje.")
                envios.append((wa, mensaje, gateway_url, gateway_token, session_key,
                               f"reactivación prospect {p.id} ({intentos + 1}/{REACT_MAX_INTENTOS})"))
            elif accion == "cerrar":
                p.estado = "cancelado"
                _registrar_historial(
                    db, p.id, p.tenant_id, "cancelado_auto",
                    f"Conversación abandonada: {intentos} reactivaciones sin respuesta. "
                    "Cancelado para seguimiento manual.")
                tenant = db.get(Tenant, p.tenant_id)
                avisos.append({
                    "prospect_id": p.id, "nombre": p.nombre,
                    "telefono": wa or p.telefono or "?",
                    "tenant": (tenant.nombre if tenant else str(p.tenant_id)),
                })
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[REACTIVACION ERROR] {type(e).__name__}: {e}")
        envios, avisos = [], []
    finally:
        db.close()

    # Envíos en threads daemon (fuera de la transacción), por la vía del recontacto.
    for (wa, mensaje, gw_url, gw_token, sess, etiqueta) in envios:
        _reintentar_envio_async(wa, mensaje, gw_url, gw_token, sess, etiqueta, recontacto=True)

    # Avisos de cierre a Sebi (superadmin/global), best-effort.
    for a in avisos:
        try:
            push.notificar_global_async(
                "reactivacion_cerrada",
                "🔄 Conversación abandonada",
                f"[{a['tenant']}] {a['nombre']} ({a['telefono']}) dejó de contestar tras "
                f"{REACT_MAX_INTENTOS} reactivaciones. Se marcó Cancelado para seguimiento manual.",
                {"nav": "prospect_detalle", "prospect_id": a["prospect_id"]},
            )
        except Exception as e:
            print(f"[REACTIVACION] no se pudo avisar cierre prospect {a['prospect_id']}: {e}")


# ── Escalera de seguimiento (interesado que difiere a futuro) ─────────────────
# Hueco distinto de la cadencia (nunca respondió), la reactivación (se colgó
# mid-charla) y el callback (dio fecha exacta): el cliente INTERESADO cerró bien
# pero difirió sin fecha ("voy a sacar los costos y te aviso"). El bot lo detecta y
# llama /agendar-seguimiento con el contexto. Recontactamos a +7d → +1mes → +3meses
# retomando ese contexto; se frena solo si el cliente vuelve a escribir; tras el 3ro
# sin respuesta (+gracia) → cancelado + aviso a Sebi. El estado vive en el prospect
# (seguimiento_*), no toca cant/ult_contacto. Kill switch SEGUIMIENTO_ENABLED.
SEG_DIAS = [7, 30, 90]           # gap a cada recontacto: +7d, +1mes, +3meses
SEG_MAX_ETAPAS = len(SEG_DIAS)   # 3
SEG_CIERRE_DIAS = 14             # gracia tras el 3ro antes de cerrar por agotado
_SEG_ESTADOS_CIERRA = {"cancelado", "no_le_interesa"}


def _seg_enabled() -> bool:
    return os.environ.get("SEGUIMIENTO_ENABLED", "true").strip().lower() in ("1", "true", "yes", "on")


def seguimiento_decidir(etapa, respondio, vencio):
    """Decisión PURA de la escalera (sin DB ni red). Retorna (accion, motivo) con
    accion in {'cerrar_revival', 'enviar', 'cerrar_agotado', 'nada'}."""
    if respondio:
        return ("cerrar_revival", "el cliente volvió a escribir → re-enganchado")
    if not vencio:
        return ("nada", "aún no vence la próxima fecha")
    if etapa >= SEG_MAX_ETAPAS:
        return ("cerrar_agotado", f"{SEG_MAX_ETAPAS} seguimientos sin respuesta")
    return ("enviar", f"etapa {etapa + 1}/{SEG_MAX_ETAPAS} vencida")


def _seg_proxima(etapa_nueva, ahora):
    """Cuándo cae el próximo evento tras dejar al cliente en `etapa_nueva`: si quedan
    etapas → gap de esa etapa; si ya salió el último → gracia antes del cierre."""
    dias = SEG_DIAS[etapa_nueva] if etapa_nueva < SEG_MAX_ETAPAS else SEG_CIERRE_DIAS
    return ahora + timedelta(days=dias)


def seguir_interesados():
    """Una pasada de la escalera de seguimiento (la llama el cadence job, cada hora).
    Best-effort; nunca frena la cadencia. Solo manda dentro de la ventana horaria del
    tenant; los cierres (revival/agotado) corren siempre (son DB-only)."""
    if not _seg_enabled():
        return
    from sqlalchemy import func

    from app.database import SessionLocal
    from app.models.mensaje import ProspectMensaje
    from app.models.prospect import Prospect
    from app.models.tenant import Tenant, TenantConfig
    from app.services import push

    db = SessionLocal()
    envios = []   # (wa, contexto, gw_url, gw_token, sess, etiqueta)
    avisos = []
    try:
        ahora = datetime.now(timezone.utc)
        cfgs = {c.tenant_id: c for c in
                db.query(TenantConfig).filter(TenantConfig.envio_auto_habilitado.is_(True)).all()}
        if not cfgs:
            return
        prospects = (
            db.query(Prospect)
            .filter(
                Prospect.seguimiento_proxima.isnot(None),
                Prospect.bloqueado.is_(False),
                Prospect.tenant_id.in_(list(cfgs.keys())),
            )
            .all()
        )
        for p in prospects:
            cfg = cfgs.get(p.tenant_id)
            if not cfg:
                continue
            # Estado terminal → cortar la escalera (no molestar a un cancelado / no interesado).
            if p.estado in _SEG_ESTADOS_CIERRA:
                p.seguimiento_proxima = None
                _registrar_historial(db, p.id, p.tenant_id, "seguimiento_cerrado",
                                     f"Seguimiento cerrado: el prospect pasó a {p.estado}.")
                continue

            last_in = (
                db.query(func.max(ProspectMensaje.fecha))
                .filter(ProspectMensaje.prospect_id == p.id, ProspectMensaje.direccion == "in")
                .scalar()
            )
            respondio = bool(last_in and p.seguimiento_base and last_in > p.seguimiento_base)
            vencio = ahora >= p.seguimiento_proxima
            etapa = p.seguimiento_etapa or 0
            accion, motivo = seguimiento_decidir(etapa, respondio, vencio)

            if accion == "cerrar_revival":
                p.seguimiento_proxima = None
                p.seguimiento_etapa = 0
                p.seguimiento_base = None
                _registrar_historial(db, p.id, p.tenant_id, "seguimiento_cerrado", f"Seguimiento cerrado: {motivo}.")

            elif accion == "enviar":
                wa = (p.whatsapp or "").strip()
                gateway_url = cfg.openclaw_gateway_url or ""
                session_key = cfg.openclaw_session_id or ""
                gateway_token = (cfg.openclaw_gateway_token or os.environ.get("OPENCLAW_GATEWAY_TOKEN", ""))
                if not (wa and gateway_url and gateway_token and session_key) or not _dentro_horario_cfg(cfg):
                    continue  # falta gateway o fuera de horario → se reintenta en la próxima pasada
                etapa_nueva = etapa + 1
                p.seguimiento_etapa = etapa_nueva
                p.seguimiento_base = ahora
                p.seguimiento_proxima = _seg_proxima(etapa_nueva, ahora)
                _registrar_historial(db, p.id, p.tenant_id, "seguimiento",
                                     f"Seguimiento {etapa_nueva}/{SEG_MAX_ETAPAS}: {motivo}. "
                                     f"Retomando: {(p.seguimiento_contexto or '')[:120]}")
                envios.append((wa, (p.seguimiento_contexto or ""), gateway_url, gateway_token, session_key,
                               f"seguimiento prospect {p.id} ({etapa_nueva}/{SEG_MAX_ETAPAS})"))

            elif accion == "cerrar_agotado":
                p.estado = "cancelado"
                p.seguimiento_proxima = None
                _registrar_historial(db, p.id, p.tenant_id, "cancelado_auto",
                                     f"Seguimiento agotado: {motivo}. Interesado que difirió y no retomó. "
                                     "Cancelado para seguimiento manual.")
                tenant = db.get(Tenant, p.tenant_id)
                avisos.append({"prospect_id": p.id, "nombre": p.nombre,
                               "telefono": (p.whatsapp or p.telefono or "?"),
                               "tenant": (tenant.nombre if tenant else str(p.tenant_id))})
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[SEGUIMIENTO ERROR] {type(e).__name__}: {e}")
        envios, avisos = [], []
    finally:
        db.close()

    # Envíos en threads daemon (fuera de la transacción), con prefijo ENVIAR_SEGUIMIENTO.
    for (wa, contexto, gw_url, gw_token, sess, etiqueta) in envios:
        _reintentar_envio_async(wa, contexto, gw_url, gw_token, sess, etiqueta, prefijo="ENVIAR_SEGUIMIENTO")

    # Avisos de cierre por agotado a Sebi (global), best-effort.
    for a in avisos:
        try:
            push.notificar_global_async(
                "seguimiento_cerrado",
                "🗓️ Seguimiento agotado",
                f"[{a['tenant']}] {a['nombre']} ({a['telefono']}) no retomó tras {SEG_MAX_ETAPAS} "
                "seguimientos. Se marcó Cancelado para seguimiento manual.",
                {"nav": "prospect_detalle", "prospect_id": a["prospect_id"]},
            )
        except Exception as e:
            print(f"[SEGUIMIENTO] no se pudo avisar cierre prospect {a['prospect_id']}: {e}")


# Ventana de confirmación de envío: tras contactar por WA esperamos ver el 'out'
# real (chat-log). Si no llega en este tiempo, avisamos (default 5 min, holgado
# para no falsear por demoras del agente). Paridad con el webhook de Etiguel.
WA_CONFIRM_WINDOW_S = int(os.environ.get("WA_CONFIRM_WINDOW_S", "300"))


def _reintentar_envio_async(wa, mensaje, gateway_url, gateway_token, session_key, etiqueta, recontacto=False, prefijo=None):
    """Re-inyecta un envío en un thread daemon (no bloquea el loop de monitoreo).
    Pasa por el mismo throttle anti-ráfaga. Si falla, el próximo barrido lo agarra
    (ya con los reintentos agotados → avisa)."""
    def _run():
        try:
            ok, info = _send_whatsapp_con_retry(wa, mensaje, gateway_url, gateway_token, session_key,
                                                recontacto=recontacto, prefijo=prefijo)
            print(f"[CONTACT SWEEP] reintento {etiqueta} → ok={ok} {info}")
        except Exception as e:
            print(f"[CONTACT SWEEP] reintento {etiqueta} ERROR: {e}")
    threading.Thread(target=_run, daemon=True).start()


def barrer_envios_sin_confirmar():
    """Barrido periódico (lo llama el loop de monitoreo). Prospects con un envío de
    WA que pasó la ventana sin 'out' real:
      - Parte B: si quedan reintentos, re-inyecta el mensaje y reinicia el reloj
        (NO avisa todavía).
      - Si ya se agotaron: marca envio_no_confirmado=True (chip web/app), historial
        y avisa a Sebi (push global). El 'out' real corta todo en cualquier momento."""
    from app.database import SessionLocal
    from app.models.prospect import Prospect
    from app.models.tenant import Tenant, TenantConfig
    from app.services import push

    corte = datetime.now(timezone.utc) - timedelta(seconds=WA_CONFIRM_WINDOW_S)
    avisos = []
    reintentos = []
    db = SessionLocal()
    try:
        vencidos = (
            db.query(Prospect)
            .filter(Prospect.envio_pendiente_desde.isnot(None))
            .filter(Prospect.envio_pendiente_desde < corte)
            .all()
        )
        ahora = datetime.now(timezone.utc)
        for p in vencidos:
            config = db.query(TenantConfig).filter(TenantConfig.tenant_id == p.tenant_id).first()
            wa = (p.whatsapp or "").strip()
            gateway_url = config.openclaw_gateway_url if config else ""
            session_key = config.openclaw_session_id if config else ""
            gateway_token = (config.openclaw_gateway_token if config else None) \
                or os.environ.get("OPENCLAW_GATEWAY_TOKEN", "")
            puede_reintentar = bool(wa and gateway_url and gateway_token and session_key)

            if (p.envio_reintentos or 0) < WA_CONFIRM_MAX_REINTENTOS and puede_reintentar:
                # Parte B: re-inyectar. Si el prospect ya iba por su 2°+ contacto,
                # es un recontacto → mismo template/prefijo (si no, el reintento
                # mandaría una presentación y el bot lo dedupea).
                es_recontacto = (p.cant_contactos or 0) >= 2
                agente = (config.agente_nombre if config else None) or "Camila"
                empresa = (config.empresa_nombre_msg if config else None) or "nuestra empresa"
                templates = (config.wa_templates if config else None) or None
                mensaje = _get_template(agente=agente, empresa=empresa, templates=templates,
                                        recontacto=es_recontacto)
                n = (p.envio_reintentos or 0) + 1
                p.envio_reintentos = n
                p.envio_pendiente_desde = ahora   # reinicia el reloj para este reintento
                _registrar_historial(
                    db, p.id, p.tenant_id, "reintento_envio",
                    f"Envío sin confirmar en {WA_CONFIRM_WINDOW_S // 60} min → reintento "
                    f"{n}/{WA_CONFIRM_MAX_REINTENTOS}, re-inyectando a {wa}.",
                )
                reintentos.append((wa, mensaje, gateway_url, gateway_token, session_key,
                                   f"prospect {p.id} ({n}/{WA_CONFIRM_MAX_REINTENTOS})", es_recontacto))
            else:
                # Agotó reintentos (o no se puede reintentar) → aviso final.
                p.envio_no_confirmado = True
                p.envio_pendiente_desde = None
                _registrar_historial(
                    db, p.id, p.tenant_id, "envio_no_confirmado",
                    f"El WhatsApp a {wa or p.telefono or '?'} no se registró como enviado "
                    f"ni con reintento. Pudo no haber salido.",
                )
                tenant = db.get(Tenant, p.tenant_id)
                avisos.append({
                    "prospect_id": p.id,
                    "nombre": p.nombre,
                    "telefono": wa or p.telefono or "?",
                    "tenant": (tenant.nombre if tenant else str(p.tenant_id)),
                })
        if vencidos:
            db.commit()
    except Exception as e:
        print(f"[CONTACT SWEEP ERROR] {e}")
        avisos, reintentos = [], []
    finally:
        db.close()

    # Reintentos (network) en threads daemon, fuera de la transacción.
    for r in reintentos:
        _reintentar_envio_async(*r)

    # Avisos finales (best-effort). Solo a Sebi (superadmin/global).
    for a in avisos:
        try:
            push.notificar_global_async(
                "envio_no_confirmado",
                "⚠️ WhatsApp no confirmado",
                f"[{a['tenant']}] Se contactó a {a['nombre']} ({a['telefono']}) y, ni con "
                f"reintento, se registró el envío. Pudo no haber salido.",
                {"nav": "prospect_detalle", "prospect_id": a["prospect_id"]},
            )
        except Exception as e:
            print(f"[CONTACT SWEEP] no se pudo avisar prospect {a['prospect_id']}: {e}")
