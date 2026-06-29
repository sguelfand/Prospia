"""Asistente de ayuda + reporte de errores del dashboard de Prospia, con Claude
Haiku (barato/rápido). Reusa el plumbing HTTP de intake_ai (`_post`, key desde
monitor_settings).

Dos funciones, ambas para el USUARIO NORMAL (nivel 2) dentro de la web:
  - ayuda_chat(): "¿cómo uso esto?". Acotado a cómo usar Prospia y, sobre todo, a
    las funciones de la pantalla activa (qué botones hay y qué se puede hacer). No
    conoce los datos cargados del cliente, solo las funciones.
  - reporte_chat(): el cliente dice "algo no funciona". Haiku le pregunta lo
    necesario y, cuando ya tiene la info, emite la señal REPORTE_LISTO + un JSON
    estructurado. El router lo persiste como AgentError (cola de errores) y le
    confirma al cliente que quedó cargado.

Vocabulario fácil pero respetuoso; tutea (vos); el cliente puede no entender
mucho técnicamente."""
from __future__ import annotations

import json
import re

from app.services.intake_ai import MAX_HISTORY, MAX_MSG_CHARS, _post

# Marcador que Haiku emite cuando ya tiene suficiente info para cargar el ticket.
REPORTE_MARKER = "REPORTE_LISTO"


def _historial(mensajes: list[dict]) -> list[dict]:
    """Recorta el historial (cantidad y largo) al formato de la API."""
    msgs: list[dict] = []
    for m in (mensajes or [])[-MAX_HISTORY:]:
        role = "assistant" if m.get("role") == "assistant" else "user"
        content = (m.get("content") or "")[:MAX_MSG_CHARS]
        if content.strip():
            msgs.append({"role": role, "content": content})
    return msgs


# ── 1) Chat de ayuda contextual ───────────────────────────────────────────────

def ayuda_chat(mensajes: list[dict], pantalla_titulo: str, pantalla_funciones: str) -> str | None:
    """Responde una duda de uso del cliente, acotada a cómo usar Prospia y a las
    funciones de la pantalla donde está. `pantalla_funciones` = descripción en
    castellano simple de qué botones/acciones tiene esa pantalla."""
    contexto = ""
    if pantalla_titulo or pantalla_funciones:
        contexto = (
            f'\n\nEl cliente está en la pantalla "{pantalla_titulo or "actual"}". '
            "Lo que se puede hacer ahí:\n" + (pantalla_funciones or "(sin detalle)") + "\n"
        )
    system = (
        "Sos el asistente de ayuda de Prospia, una plataforma web de prospección "
        "comercial B2B en Argentina. Ayudás a personas que usan la plataforma y que "
        "pueden NO entender mucho de tecnología.\n"
        "Tu rol:\n"
        "- Explicá cómo usar Prospia y, sobre todo, cómo usar la pantalla en la que está el cliente.\n"
        "- Hablá de las FUNCIONES y BOTONES (qué hace cada cosa, cómo se usa), no de los datos "
        "puntuales que el cliente tenga cargados (esos no los conocés).\n"
        "- Vocabulario fácil pero respetuoso. Tuteá (vos). Respondé en español, breve y claro. "
        "Evitá tecnicismos; si usás uno, explicalo en una frase.\n"
        "- Si te piden algo que no es sobre usar Prospia, decí amablemente que solo podés ayudar "
        "con el uso de la plataforma. Si el cliente quiere reportar un error o algo que no funciona, "
        "decile que use el botón \"Reportar error\" arriba a la derecha.\n"
        "- No inventes funciones que no existen."
        + contexto
    )
    msgs = _historial(mensajes)
    if not msgs or msgs[-1]["role"] != "user":
        return None
    return _post(system, msgs, max_tokens=600)


# ── 2) Chat de reporte de error → ticket ──────────────────────────────────────

def reporte_chat(mensajes: list[dict], pantalla_titulo: str = "") -> dict:
    """Conversa para juntar el detalle de un error que reporta el cliente. Cuando
    Haiku considera que ya tiene lo necesario, emite REPORTE_LISTO + un JSON. Esta
    función devuelve:
        {"listo": False, "respuesta": "<próxima pregunta al cliente>"}
      o {"listo": True, "respuesta": "<confirmación al cliente>",
         "ticket": {"titulo", "resumen", "pantalla", "pasos"}}
    El router decide guardar el AgentError cuando listo=True."""
    pista = f' El cliente abrió el reporte desde la pantalla "{pantalla_titulo}".' if pantalla_titulo else ""
    system = (
        "Sos el asistente de Prospia que toma reportes de errores de los clientes "
        "(plataforma web de prospección B2B en Argentina). El cliente te va a contar "
        "que algo no funciona o no se comporta como esperaba." + pista + "\n\n"
        "Tu trabajo es entender bien el problema haciendo las MÍNIMAS preguntas necesarias "
        "(de a una por vez, cortas, en lenguaje simple y respetuoso, tuteando). Necesitás "
        "entender: (a) en qué pantalla o función pasa, (b) qué estaba intentando hacer el "
        "cliente, (c) qué esperaba que pasara y (d) qué pasó en realidad (o qué mensaje vio).\n\n"
        "Cuando ya tengas esa información (no insistas de más: si el cliente ya lo explicó, "
        "no repreguntes), respondé EXACTAMENTE en este formato y nada más:\n"
        f"{REPORTE_MARKER}\n"
        "{\n"
        '  "titulo": "<una línea que resuma el problema>",\n'
        '  "resumen": "<2-4 líneas: qué intentaba, qué esperaba, qué pasó>",\n'
        '  "pantalla": "<pantalla o función afectada>",\n'
        '  "confirmacion": "<mensaje cordial al cliente avisándole que su reporte quedó cargado y que el equipo lo va a revisar>"\n'
        "}\n"
        f"No emitas {REPORTE_MARKER} hasta tener lo necesario. Antes de eso, respondé solo con "
        "tu próxima pregunta o comentario para el cliente, sin JSON."
    )
    msgs = _historial(mensajes)
    if not msgs or msgs[-1]["role"] != "user":
        return {"listo": False, "respuesta": "Contame qué fue lo que no funcionó."}
    raw = _post(system, msgs, max_tokens=700) or ""
    if REPORTE_MARKER not in raw:
        return {"listo": False, "respuesta": raw.strip() or "¿Me das un poco más de detalle?"}
    # Extraer el bloque JSON que sigue al marcador.
    after = raw.split(REPORTE_MARKER, 1)[1]
    ticket = _parse_json_laxo(after)
    if not ticket:
        # No pudimos parsear: seguimos la conversación pidiendo confirmación.
        return {"listo": False, "respuesta": "Dejame confirmar: ¿podés resumirme en una frase qué fue lo que falló?"}
    confirmacion = (ticket.get("confirmacion") or
                    "Listo, ya cargué tu reporte. El equipo lo va a revisar. ¡Gracias por avisar!")
    return {
        "listo": True,
        "respuesta": confirmacion,
        "ticket": {
            "titulo": (ticket.get("titulo") or "Error reportado por el cliente")[:200],
            "resumen": ticket.get("resumen") or "",
            "pantalla": ticket.get("pantalla") or pantalla_titulo or "",
        },
    }


def _parse_json_laxo(texto: str) -> dict | None:
    """Extrae el primer objeto JSON de un texto (tolera ```json fences y basura
    alrededor)."""
    if not texto:
        return None
    m = re.search(r"\{.*\}", texto, re.DOTALL)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
        return d if isinstance(d, dict) else None
    except Exception:
        return None
