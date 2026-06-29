"""Asistentes IA del relevamiento, con Claude Haiku (barato/rápido) vía HTTP
directo — mismo estilo que services/classify.py.

Dos funciones:
  - clasificar_texto(): el cliente escribe libre desde "Agregar información" y
    Haiku reparte ese texto en los casilleros del negocio que correspondan.
  - ayuda_chat(): chat de ayuda del formulario público (qué poner en cada campo).

La key sale de monitor_settings.anthropic_api_key (o env como fallback). El chat
público tiene rate-limit por IP para que el endpoint abierto no se abuse."""
from __future__ import annotations

import json
import re
import time

import requests

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-haiku-4-5-20251001"

# Solo estos tipos se autocompletan por IA; lo demás (multiselect, archivos) no
# se toca y va a nota libre. Mantiene el mapeo simple y sin ambigüedad.
TIPOS_ASIGNABLES = {"text", "textarea", "select", "email", "tel", "url", "number"}


def _anthropic_key() -> str:
    try:
        from app.database import SessionLocal
        from app.models.service_health import MonitorSettings
        db = SessionLocal()
        try:
            s = db.query(MonitorSettings).filter(MonitorSettings.id == 1).first()
            if s and s.anthropic_api_key:
                return s.anthropic_api_key
        finally:
            db.close()
    except Exception:
        pass
    from app.core.config import settings
    return settings.ANTHROPIC_API_KEY or ""


def _post(system: str, messages: list[dict], max_tokens: int, timeout: int = 30,
          funcion: str = "Relevamiento (intake)") -> str | None:
    key = _anthropic_key()
    if not key:
        return None
    try:
        resp = requests.post(
            ANTHROPIC_API_URL,
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={"model": MODEL, "max_tokens": max_tokens, "system": system, "messages": messages},
            timeout=timeout,
        )
    except Exception as e:
        print(f"[INTAKE_AI ERROR] {type(e).__name__}: {e}")
        return None
    if resp.status_code != 200:
        print(f"[INTAKE_AI ERROR] HTTP {resp.status_code}: {resp.text[:200]}")
        return None
    try:
        data = resp.json()
        from app.services import anthropic_usage
        anthropic_usage.registrar(funcion, MODEL, data.get("usage"))
        return (data.get("content") or [{}])[0].get("text", "")
    except Exception as e:
        print(f"[INTAKE_AI ERROR] parse: {e}")
        return None


# ── 1) Clasificar texto libre → casilleros ───────────────────────────────────

def _catalogo_campos(secciones: list) -> tuple[list[dict], dict]:
    """Aplana las secciones a la lista de campos asignables (id, label, tipo,
    opciones) + un índice id→campo para validar después."""
    campos, idx = [], {}
    for s in secciones:
        for c in s.get("campos", []):
            if c.get("tipo") in TIPOS_ASIGNABLES:
                campos.append(c)
                idx[c["id"]] = c
    return campos, idx


def clasificar_texto(texto: str, secciones: list, valores_actuales: dict) -> dict:
    """Reparte `texto` (lo que el cliente escribió libre) en los campos del
    negocio. Devuelve:
      {"asignaciones": [{campo, label, tipo, valor, accion, valor_actual}],
       "nota_libre": str}
    `accion` = "completar" (campo vacío) | "agregar" (ya tenía valor)."""
    texto = (texto or "").strip()
    if not texto:
        return {"asignaciones": [], "nota_libre": ""}

    campos, idx = _catalogo_campos(secciones)
    lineas = []
    for c in campos:
        ops = f" — opciones: {', '.join(c['opciones'])}" if c.get("opciones") else ""
        actual = valores_actuales.get(c["id"])
        tiene = " [ya tiene dato]" if actual not in (None, "", [], {}) else ""
        lineas.append(f"- {c['id']} ({c['tipo']}): {c['label']}{ops}{tiene}")
    catalogo = "\n".join(lineas)

    system = (
        "Sos un asistente que ordena la información de un negocio para una plataforma "
        "de prospección comercial. El cliente escribió un texto libre con datos de su "
        "empresa. Tu tarea es repartir esa información en los campos correctos.\n\n"
        "CAMPOS DISPONIBLES (id, tipo y etiqueta):\n" + catalogo + "\n\n"
        "Reglas:\n"
        "- Asigná cada dato al campo cuyo significado mejor lo represente.\n"
        "- Para campos 'select', el valor DEBE ser exactamente una de sus opciones.\n"
        "- Si un campo ya tiene dato, usá accion 'agregar' (lo vamos a sumar, no pisar). Si está vacío, 'completar'.\n"
        "- Lo que no encaje claramente en ningún campo, ponelo en 'nota_libre'.\n"
        "- No inventes datos que el cliente no dijo.\n\n"
        "Respondé SOLO con un JSON válido (sin texto alrededor, sin ```), con esta forma:\n"
        '{"asignaciones": [{"campo": "<id>", "valor": "<texto>", "accion": "completar"|"agregar"}], "nota_libre": "<texto o vacío>"}'
    )
    raw = _post(system, [{"role": "user", "content": texto[:4000]}], max_tokens=1500,
                funcion="Relevamiento: clasificar texto")
    if not raw:
        return {"asignaciones": [], "nota_libre": texto, "error": "ia_no_disponible"}

    # Tolerar que el modelo encierre el JSON en ``` o agregue texto alrededor.
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    try:
        data = json.loads(m.group(0)) if m else {}
    except Exception:
        return {"asignaciones": [], "nota_libre": texto, "error": "parse"}

    out = []
    for a in (data.get("asignaciones") or []):
        c = idx.get(a.get("campo"))
        valor = (a.get("valor") or "").strip()
        if not c or not valor:
            continue
        # Validar opción de select; si no matchea, lo mandamos a nota libre abajo.
        if c.get("tipo") == "select" and c.get("opciones"):
            match = next((o for o in c["opciones"] if o.lower() == valor.lower()), None)
            if not match:
                continue
            valor = match
        actual = valores_actuales.get(c["id"])
        tenia = actual not in (None, "", [], {})
        out.append({
            "campo": c["id"],
            "label": c["label"],
            "tipo": c["tipo"],
            "valor": valor,
            "accion": "agregar" if tenia else "completar",
            "valor_actual": actual if tenia else None,
        })
    return {"asignaciones": out, "nota_libre": (data.get("nota_libre") or "").strip()}


# ── 2) Chat de ayuda del formulario (público, rate-limited) ───────────────────

# Rate-limit en memoria por IP: ventana deslizante. Single-container, alcanza.
_RL: dict[str, list[float]] = {}
_RL_WINDOW = 600.0   # 10 min
_RL_MAX = 25         # mensajes por ventana por IP
MAX_MSG_CHARS = 1000
MAX_HISTORY = 12


def rate_limit_ok(ip: str) -> bool:
    now = time.time()
    hits = [t for t in _RL.get(ip, []) if now - t < _RL_WINDOW]
    if len(hits) >= _RL_MAX:
        _RL[ip] = hits
        return False
    hits.append(now)
    _RL[ip] = hits
    return True


def _resumen_secciones(secciones: list) -> str:
    partes = []
    for s in secciones:
        labels = ", ".join(c["label"] for c in s.get("campos", []))
        partes.append(f"• {s['titulo']}: {labels}")
    return "\n".join(partes)


def ayuda_chat(mensajes: list[dict], secciones: list, empresa: str = "") -> str | None:
    """Responde una duda del cliente mientras completa el formulario. Acotado a
    ayudar con ESE formulario; no responde otra cosa. `mensajes` = historial
    [{role: 'user'|'assistant', content}]."""
    resumen = _resumen_secciones(secciones)
    quien = f" de {empresa}" if empresa else ""
    system = (
        f"Sos un asistente que ayuda a completar el formulario de relevamiento{quien} "
        "de Prospia (una plataforma de prospección comercial B2B en Argentina). "
        "El cliente está llenando el formulario y te hace dudas sobre qué poner.\n\n"
        "El formulario tiene estas secciones y campos:\n" + resumen + "\n\n"
        "Tu rol:\n"
        "- Ayudá a entender qué se espera en cada campo y dá ejemplos concretos del rubro del cliente.\n"
        "- Sé breve, claro y cordial. Tuteá (vos). Respondé en español.\n"
        "- Si preguntan algo que no tiene que ver con completar este formulario, decí amablemente "
        "que solo podés ayudar con el relevamiento.\n"
        "- No inventes datos de la empresa del cliente; ayudalo a que los complete él."
    )
    # Recortar historial y largo de cada mensaje.
    msgs = []
    for m in (mensajes or [])[-MAX_HISTORY:]:
        role = "assistant" if m.get("role") == "assistant" else "user"
        content = (m.get("content") or "")[:MAX_MSG_CHARS]
        if content.strip():
            msgs.append({"role": role, "content": content})
    if not msgs or msgs[-1]["role"] != "user":
        return None
    return _post(system, msgs, max_tokens=600, funcion="Relevamiento: chat de ayuda")
