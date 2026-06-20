"""Envío de notificaciones push a la app de administración vía Expo Push API.

La cadena es: backend → Expo (exp.host) → FCM (Google) → celular. Acá solo
hablamos con Expo; Expo se encarga del resto. No bloquea el request que dispara
el evento: se manda en un thread daemon."""
import threading

import requests

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

# Eventos de push toggleables por dispositivo (#38). label = lo que ve el usuario
# en la config de notificaciones. El orden es el de la UI.
EVENTOS_PUSH: list[tuple[str, str]] = [
    ("interesado", "Interesado"),
    ("respuesta", "Primera respuesta"),
    ("error_camila", "Error de Camila"),
    ("standby", "Pendiente en espera (standby)"),
    ("cola_terminada", "Cola de pendientes terminada"),
    ("necesita_autorizacion", "Necesita tu autorización"),
]
EVENTOS_PUSH_KEYS = [k for k, _ in EVENTOS_PUSH]


def _tokens_para_evento(db, evento: str) -> list[str]:
    """Devices a los que SÍ hay que mandarles este evento: todos menos los que lo
    tienen silenciado en push_event_mutes (#38)."""
    from app.models.device import Device
    from app.models.push_event_mute import PushEventMute

    muteados = {
        t for (t,) in db.query(PushEventMute.expo_token)
        .filter(PushEventMute.evento == evento)
        .all()
    }
    return [d.expo_token for d in db.query(Device).all() if d.expo_token not in muteados]


def _enviar(tokens: list[str], title: str, body: str, data: dict) -> None:
    if not tokens:
        print("[PUSH] sin devices registrados, no se envía nada")
        return
    messages = [
        {
            "to": t,
            "title": title,
            "body": body,
            "data": data,
            "sound": "default",
            "priority": "high",
            "channelId": "default",
        }
        for t in tokens
    ]
    try:
        resp = requests.post(
            EXPO_PUSH_URL,
            json=messages,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            timeout=10,
        )
        print(f"[PUSH] enviado a {len(tokens)} device(s) → HTTP {resp.status_code}: {resp.text[:300]}")
    except Exception as e:
        print(f"[PUSH] error enviando: {type(e).__name__}: {e}")


def _notificar_evento(prospect_id: int, tipo: str, detalle: str | None) -> None:
    from app.database import SessionLocal
    from app.models.device import Device
    from app.models.prospect import Prospect
    from app.models.push_mute import PushMute
    from app.models.tenant import Tenant

    db = SessionLocal()
    try:
        prospect = db.get(Prospect, prospect_id)
        if not prospect:
            return
        tenant = db.get(Tenant, prospect.tenant_id)
        cliente = tenant.nombre if tenant else "Cliente"

        if tipo == "en_conversacion":
            title = f"💬 Nueva respuesta — {cliente}"
            body = f"{prospect.nombre} respondió por primera vez"
        elif tipo == "interesado":
            title = f"🔥 Interesado — {cliente}"
            resumen = (detalle or "").strip()
            body = f"{prospect.nombre}" + (f": {resumen[:90]}" if resumen else " se mostró interesado")
        else:
            return

        # Devices que silenciaron este cliente (APP.4): se excluyen del envío.
        muteados = {
            t for (t,) in db.query(PushMute.expo_token)
            .filter(PushMute.tenant_id == prospect.tenant_id)
            .all()
        }
        # Además, el toggle por evento (#38): interesado / respuesta.
        evento_key = "respuesta" if tipo == "en_conversacion" else "interesado"
        permitidos = set(_tokens_para_evento(db, evento_key))
        tokens = [
            d.expo_token for d in db.query(Device).all()
            if d.expo_token not in muteados and d.expo_token in permitidos
        ]
        _enviar(tokens, title, body, {
            "tenant_id": prospect.tenant_id,
            "prospect_id": prospect_id,
            "tipo": tipo,
        })
    except Exception as e:
        print(f"[PUSH] error armando notificación: {type(e).__name__}: {e}")
    finally:
        db.close()


def notificar_evento_async(prospect_id: int, tipo: str, detalle: str | None = None) -> None:
    """Dispara la notificación en background (no bloquea el webhook que la origina)."""
    threading.Thread(
        target=_notificar_evento,
        args=(prospect_id, tipo, detalle),
        daemon=True,
    ).start()


def _notificar_error(error_id: int, fuente: str, contenido: str) -> None:
    from app.database import SessionLocal
    from app.models.device import Device

    db = SessionLocal()
    try:
        title = f"⚠️ Error de Camila #{error_id}"
        resumen = (contenido or "").strip().replace("\n", " ")
        body = (f"[{fuente}] " + resumen)[:140] if resumen else f"[{fuente}] error capturado"
        # Alerta global, pero respeta el toggle de evento "error_camila" (#38).
        tokens = _tokens_para_evento(db, "error_camila")
        _enviar(tokens, title, body, {"tipo": "agent_error", "error_id": error_id})
    except Exception as e:
        print(f"[PUSH] error armando alerta de error: {type(e).__name__}: {e}")
    finally:
        db.close()


def notificar_error_async(error_id: int, fuente: str, contenido: str) -> None:
    """Dispara el push de alerta de error en background (no bloquea el ingest)."""
    threading.Thread(target=_notificar_error, args=(error_id, fuente, contenido), daemon=True).start()


def _notificar_aviso(title: str, body: str, data: dict) -> None:
    from app.database import SessionLocal
    from app.models.device import Device

    db = SessionLocal()
    try:
        # Aviso al dueño (primer contacto, consulta de Camila, alertas técnicas):
        # va a TODOS los devices, sin filtro de silencio por cliente.
        tokens = [d.expo_token for d in db.query(Device).all()]
        _enviar(tokens, title, body, data)
    except Exception as e:
        print(f"[PUSH] error armando aviso: {type(e).__name__}: {e}")
    finally:
        db.close()


def notificar_aviso_async(title: str, body: str, data: dict | None = None) -> None:
    """Push genérico de aviso (reemplaza los mails de notificación). Background."""
    threading.Thread(target=_notificar_aviso, args=(title, body, data or {}), daemon=True).start()


def _notificar_global(evento: str, title: str, body: str, data: dict) -> None:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        tokens = _tokens_para_evento(db, evento)
        _enviar(tokens, title, body, {**data, "evento": evento})
    except Exception as e:
        print(f"[PUSH] error armando push global {evento}: {type(e).__name__}: {e}")
    finally:
        db.close()


def notificar_global(evento: str, title: str, body: str, data: dict | None = None) -> int:
    """Push de un evento global (#38): standby / cola_terminada /
    necesita_autorizacion. Respeta el toggle por dispositivo. SINCRÓNICO (lo
    llama Claude desde un script o el endpoint /admin/notify). Devuelve a cuántos
    devices se mandó."""
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        tokens = _tokens_para_evento(db, evento)
        _enviar(tokens, title, body, {**(data or {}), "evento": evento})
        return len(tokens)
    finally:
        db.close()


def notificar_global_async(evento: str, title: str, body: str, data: dict | None = None) -> None:
    """Versión background de notificar_global (para disparar desde un request)."""
    threading.Thread(target=_notificar_global, args=(evento, title, body, data or {}), daemon=True).start()


def enviar_prueba() -> int:
    """Manda una notificación de prueba a todos los devices registrados.
    Devuelve a cuántos se envió. Útil para verificar el circuito de push."""
    from app.database import SessionLocal
    from app.models.device import Device

    db = SessionLocal()
    try:
        tokens = [d.expo_token for d in db.query(Device).all()]
        _enviar(tokens, "🔔 Prospia Admin", "Notificación de prueba — ¡funciona! ✓", {"tipo": "test"})
        return len(tokens)
    finally:
        db.close()
