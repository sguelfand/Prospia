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


def _get_template(
    agente: str = "Camila",
    empresa: str = "nuestra empresa",
    templates: list[str] | None = None,
) -> str:
    """Elige un template al azar de los del tenant (rotación anti-ban). Si el tenant
    no tiene templates cargados, cae a los 5 genéricos. Reemplazo tolerante: solo
    sustituye {agente}/{empresa} si están, sin romper si el template trae otras llaves."""
    pool = templates if templates else WA_TEMPLATES
    template = random.choice(pool)
    return template.replace("{agente}", agente).replace("{empresa}", empresa)


def _send_whatsapp(numero: str, mensaje: str, gateway_url: str, gateway_token: str, session_key: str) -> tuple[bool, str]:
    target = numero.lstrip('+').replace(' ', '').replace('-', '')
    payload_message = f"ENVIAR_PROSPECCION|{target}|{mensaje}"

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


def _send_whatsapp_con_retry(numero: str, mensaje: str, gateway_url: str, gateway_token: str, session_key: str) -> tuple[bool, str]:
    """_send_whatsapp con reintentos + backoff ante fallo transitorio del gateway.

    Reintenta hasta WA_SEND_MAX_INTENTOS veces con WA_SEND_RETRY_DELAY_S de espera
    entre intentos. Corta apenas un intento sale OK. Corre en thread daemon: la
    espera no bloquea el response. Si se agotan los intentos retorna (False, motivo)."""
    ultimo_info = ""
    for intento in range(1, WA_SEND_MAX_INTENTOS + 1):
        ok, info = _send_whatsapp(numero, mensaje, gateway_url, gateway_token, session_key)
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

        wa_enviado    = False
        wa_info       = ""
        email_enviado = False

        # WhatsApp (prioridad siempre)
        if wa and gateway_url and gateway_token and session_key:
            agente  = (config.agente_nombre if config else None) or "Camila"
            empresa = (config.empresa_nombre_msg if config else None) or "nuestra empresa"
            templates = (config.wa_templates if config else None) or None
            mensaje = _get_template(agente=agente, empresa=empresa, templates=templates)
            wa_enviado, wa_info = _send_whatsapp_con_retry(wa, mensaje, gateway_url, gateway_token, session_key)
            print(f"[CONTACT] WA {wa} → ok={wa_enviado} {wa_info}")

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
