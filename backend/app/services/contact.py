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
                   session_key: str, recontacto: bool = False) -> tuple[bool, str]:
    target = numero.lstrip('+').replace(' ', '').replace('-', '')
    # recontacto=True → prefijo ENVIAR_RECONTACTO: señal explícita al bot del tenant
    # de que es un recontacto intencional (mandarlo aunque ya haya contactado el
    # número, NO dedupear). 1er contacto → ENVIAR_PROSPECCION como siempre.
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


def _send_whatsapp_con_retry(numero: str, mensaje: str, gateway_url: str, gateway_token: str, session_key: str, recontacto: bool = False) -> tuple[bool, str]:
    """_send_whatsapp con reintentos + backoff ante fallo transitorio del gateway.

    Reintenta hasta WA_SEND_MAX_INTENTOS veces con WA_SEND_RETRY_DELAY_S de espera
    entre intentos. Corta apenas un intento sale OK. Corre en thread daemon: la
    espera no bloquea el response. Si se agotan los intentos retorna (False, motivo)."""
    ultimo_info = ""
    for intento in range(1, WA_SEND_MAX_INTENTOS + 1):
        ok, info = _send_whatsapp(numero, mensaje, gateway_url, gateway_token, session_key, recontacto=recontacto)
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


# Ventana de confirmación de envío: tras contactar por WA esperamos ver el 'out'
# real (chat-log). Si no llega en este tiempo, avisamos (default 5 min, holgado
# para no falsear por demoras del agente). Paridad con el webhook de Etiguel.
WA_CONFIRM_WINDOW_S = int(os.environ.get("WA_CONFIRM_WINDOW_S", "300"))


def _reintentar_envio_async(wa, mensaje, gateway_url, gateway_token, session_key, etiqueta, recontacto=False):
    """Re-inyecta un envío en un thread daemon (no bloquea el loop de monitoreo).
    Pasa por el mismo throttle anti-ráfaga. Si falla, el próximo barrido lo agarra
    (ya con los reintentos agotados → avisa)."""
    def _run():
        try:
            ok, info = _send_whatsapp_con_retry(wa, mensaje, gateway_url, gateway_token, session_key,
                                                recontacto=recontacto)
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
