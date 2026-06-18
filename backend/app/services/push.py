"""Envío de notificaciones push a la app de administración vía Expo Push API.

La cadena es: backend → Expo (exp.host) → FCM (Google) → celular. Acá solo
hablamos con Expo; Expo se encarga del resto. No bloquea el request que dispara
el evento: se manda en un thread daemon."""
import threading

import requests

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


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

        tokens = [d.expo_token for d in db.query(Device).all()]
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
