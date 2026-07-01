"""Guardia semántica de salida de Camila (1/7).

El outbound-guard del bot bloquea por PATRONES (rápido, gratis) las fugas conocidas.
Esta capa es la red semántica: para CUALQUIER redacción (aunque no esté en la lista),
un modelo barato (Haiku) decide si el texto que Camila está por enviar es un mensaje
para el cliente o razonamiento/estado/nota interna que se filtró. Corre en el backend
(la key vive acá, no en el bot) y **registra su costo en `anthropic_usage`** con función
propia → aparece discriminado en Tokens → Costos internos.

Se prende/apaga con `monitor_settings.guard_semantico` (default ON).
"""
from __future__ import annotations

import requests

from app.services.camila_quality import _anthropic_key

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
HAIKU = "claude-haiku-4-5-20251001"
FUNCION = "Guardia semántica (Camila)"


def habilitado() -> bool:
    from app.database import SessionLocal
    from app.models.service_health import MonitorSettings
    db = SessionLocal()
    try:
        s = db.query(MonitorSettings).filter(MonitorSettings.id == 1).first()
        return bool(getattr(s, "guard_semantico", True)) if s else True
    finally:
        db.close()


def es_interno(texto: str, source: str | None = None) -> bool:
    """True si el texto parece razonamiento/estado/nota interna en vez de un mensaje
    genuino para el cliente. Ante cualquier duda o error, devuelve False (no bloquea:
    el guard por patrones ya cubre lo conocido; no queremos frenar mensajes válidos)."""
    texto = (texto or "").strip()
    if len(texto) < 3:
        return False
    key = _anthropic_key()
    if not key:
        return False
    system = (
        "Sos un filtro de salida para Camila, la agente de WhatsApp de un negocio (Etiguel). "
        "Te doy UN mensaje que Camila está por enviarle a alguien por WhatsApp. Decidí si es:\n"
        "- un MENSAJE PARA EL CLIENTE (lo que un cliente esperaría recibir: una respuesta, una "
        "pregunta, un precio, un saludo, una derivación), o\n"
        "- RAZONAMIENTO / ESTADO / NOTA INTERNA que se filtró y NO debería ir a un cliente: narrar "
        "chequeos (blacklist, leer un archivo, decidir si consultar una tela o precio), reportar el "
        "estado de la conversación ('el número no dijo nada', 'no hay nada pendiente'), hablar del "
        "cliente en tercera persona, dirigirse a Sebi/Delfina/el equipo, o decir que necesita "
        "consultar/verificar algo internamente.\n"
        'Respondé SOLO con JSON: {"interno": true} si NO debe ir al cliente, {"interno": false} si es '
        "un mensaje válido para el cliente. Ante la duda, respondé false."
    )
    try:
        resp = requests.post(
            ANTHROPIC_API_URL,
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": HAIKU, "max_tokens": 20, "system": system,
                  "messages": [{"role": "user", "content": texto[:2000]}]},
            timeout=15,
        )
    except Exception as e:
        print(f"[CAMILA-GUARD] HTTP: {type(e).__name__}: {e}")
        return False
    if resp.status_code != 200:
        print(f"[CAMILA-GUARD] HTTP {resp.status_code}: {resp.text[:150]}")
        return False
    try:
        data = resp.json()
        from app.services import anthropic_usage
        anthropic_usage.registrar(FUNCION, HAIKU, data.get("usage"), source)
        txt = (data.get("content") or [{}])[0].get("text", "").lower()
        return '"interno": true' in txt or '"interno":true' in txt
    except Exception as e:
        print(f"[CAMILA-GUARD] parse: {type(e).__name__}: {e}")
        return False
