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
    ("mensaje_entrante", "Cada mensaje entrante"),
    ("error_camila", "Error de Camila"),
    ("standby", "Pendiente en espera (standby)"),
    ("cola_terminada", "Cola de pendientes terminada"),
    ("necesita_autorizacion", "Necesita tu autorización"),
    ("servicio_caido", "Servicio caído (monitoreo)"),
    ("servicio_recuperado", "Servicio recuperado (monitoreo)"),
    ("tokens_oportunidad", "Oportunidad de mejora de consumo (tokens)"),
]
EVENTOS_PUSH_KEYS = [k for k, _ in EVENTOS_PUSH]

# Eventos configurables POR CLIENTE (#44) + su default cuando no hay fila.
# mensaje_entrante arranca OFF para no inundar; el resto ON.
EVENTOS_CLIENTE: list[tuple[str, str]] = [
    ("interesado", "Interesado"),
    ("respuesta", "Primera respuesta"),
    ("mensaje_entrante", "Cada mensaje entrante"),
]
DEFAULT_CLIENTE_EVENTO = {"interesado": True, "respuesta": True, "mensaje_entrante": False}


def _cliente_evento_ok(db, expo_token: str, tenant_id: int, evento: str) -> bool:
    """¿Este device quiere `evento` para `tenant_id`? Usa la fila explícita de
    push_cliente_evento o el default (#44)."""
    from app.models.push_cliente_evento import PushClienteEvento
    row = (
        db.query(PushClienteEvento)
        .filter(
            PushClienteEvento.expo_token == expo_token,
            PushClienteEvento.tenant_id == tenant_id,
            PushClienteEvento.evento == evento,
        )
        .first()
    )
    return row.enabled if row else DEFAULT_CLIENTE_EVENTO.get(evento, True)


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


def _log_aviso(db, tipo: str, title: str, body: str, tenant_id=None, cliente=None, prospect_id=None) -> int | None:
    """Persiste el push como Aviso (#42) para que quede en el historial de la app.
    Devuelve el id del aviso creado (para deep-link desde la push) o None si falla.
    Best-effort: si falla, no rompe el envío."""
    from app.models.aviso import Aviso
    try:
        av = Aviso(tipo=tipo, title=title[:160], body=(body or "")[:2000],
                   tenant_id=tenant_id, cliente=cliente, prospect_id=prospect_id)
        db.add(av)
        db.commit()
        return av.id
    except Exception as e:
        db.rollback()
        print(f"[PUSH] no se pudo guardar el aviso: {type(e).__name__}: {e}")
        return None


def _textos_evento(evento: str, cliente: str, nombre: str, detalle: str | None) -> tuple[str, str]:
    """Arma (title, body) de un evento de cliente. Compartido Plataforma/Etiguel."""
    resumen = (detalle or "").strip()
    if evento == "respuesta":
        return f"💬 Nueva respuesta — {cliente}", f"{nombre} respondió por primera vez"
    if evento == "interesado":
        return f"🔥 Interesado — {cliente}", f"{nombre}" + (f": {resumen[:90]}" if resumen else " se mostró interesado")
    if evento == "mensaje_entrante":
        return f"💬 {cliente} · {nombre}", (resumen[:120] if resumen else "Nuevo mensaje entrante")
    return f"{cliente}", resumen[:120]


def _enviar_evento_filtrado(db, evento: str, title: str, body: str, tenant_id: int,
                            cliente: str | None = None, prospect_id: int | None = None) -> int:
    """Manda un push de evento de cliente (interesado/respuesta/mensaje_entrante)
    respetando el toggle GLOBAL por evento (#38) Y el toggle POR CLIENTE (#44).
    Sirve para Plataforma y para Etiguel (tenant -1). Persiste aviso. Devuelve
    a cuántos devices se mandó."""
    from app.models.device import Device
    permitidos = set(_tokens_para_evento(db, evento))
    tokens = [
        d.expo_token for d in db.query(Device).all()
        if d.expo_token in permitidos and _cliente_evento_ok(db, d.expo_token, tenant_id, evento)
    ]
    # Persistir el aviso ANTES de enviar para incluir su id en la push (deep-link).
    aviso_id = _log_aviso(db, evento, title, body, tenant_id=tenant_id, cliente=cliente, prospect_id=prospect_id) if tokens else None
    _enviar(tokens, title, body, {"tenant_id": tenant_id, "prospect_id": prospect_id, "evento": evento, "aviso_id": aviso_id})
    return len(tokens)


def _notificar_evento(prospect_id: int, tipo: str, detalle: str | None) -> None:
    from app.database import SessionLocal
    from app.models.prospect import Prospect
    from app.models.tenant import Tenant

    # tipo del endpoint → clave de evento de la config
    evento = "respuesta" if tipo == "en_conversacion" else tipo  # interesado / mensaje_entrante / respuesta
    db = SessionLocal()
    try:
        prospect = db.get(Prospect, prospect_id)
        if not prospect:
            return
        tenant = db.get(Tenant, prospect.tenant_id)
        cliente = tenant.nombre if tenant else "Cliente"
        title, body = _textos_evento(evento, cliente, prospect.nombre, detalle)
        _enviar_evento_filtrado(db, evento, title, body, prospect.tenant_id, cliente=cliente, prospect_id=prospect_id)
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


# Etiguel vive en Monday, fuera de la tabla `prospects` (tenant sentinela -1).
ETIGUEL_TENANT_ID = -1
ETIGUEL_NOMBRE = "Etiguel"


def _notificar_evento_etiguel(evento: str, nombre: str, detalle: str | None) -> None:
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        title, body = _textos_evento(evento, ETIGUEL_NOMBRE, nombre or "un lead", detalle)
        _enviar_evento_filtrado(db, evento, title, body, ETIGUEL_TENANT_ID, cliente=ETIGUEL_NOMBRE)
    except Exception as e:
        print(f"[PUSH] error armando evento Etiguel: {type(e).__name__}: {e}")
    finally:
        db.close()


def notificar_evento_etiguel_async(evento: str, nombre: str, detalle: str | None = None) -> None:
    """Push de un evento de Etiguel (interesado / respuesta / mensaje_entrante),
    respetando los mismos toggles (global + por cliente con tenant -1) que la
    Plataforma. Lo dispara el espejo de Etiguel (#44 diferenciado)."""
    threading.Thread(target=_notificar_evento_etiguel, args=(evento, nombre, detalle), daemon=True).start()


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
        aviso_id = _log_aviso(db, "error_camila", title, body) if tokens else None
        _enviar(tokens, title, body, {"tipo": "agent_error", "error_id": error_id, "aviso_id": aviso_id})
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
        aviso_id = _log_aviso(db, (data or {}).get("tipo", "aviso"), title, body) if tokens else None
        _enviar(tokens, title, body, {**(data or {}), "aviso_id": aviso_id})
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
        aviso_id = _log_aviso(db, evento, title, body) if tokens else None
        _enviar(tokens, title, body, {**data, "evento": evento, "aviso_id": aviso_id})
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
        aviso_id = _log_aviso(db, evento, title, body) if tokens else None
        _enviar(tokens, title, body, {**(data or {}), "evento": evento, "aviso_id": aviso_id})
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
