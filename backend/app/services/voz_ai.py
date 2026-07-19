"""Asistente de VOZ de las sesiones de Claude (Etapa 2 de Sesiones).

Sebi le habla desde la app (STT en el cel → texto acá → TTS en el cel) y ella
maneja las sesiones: cuenta el estado, lee lo importante y ejecuta órdenes
(mandar un mensaje, crear una sesión, continuar una) vía el puente mac-bridge.

Haiku (barato/rápido), reusando el plumbing de intake_ai (`_post`). Sin SDK de
tools: la respuesta viene como JSON {"decir": ..., "accion": ...} y la acción la
ejecuta este módulo contra sesiones_state. Memoria corta por usuario (15 min).
"""

from __future__ import annotations

import json
import re
import time

from app.services import sesiones_state
from app.services.intake_ai import _post

MAX_TURNOS = 12          # mensajes que recordamos por usuario
TTL_SEG = 15 * 60        # la conversación de voz expira sola

_charlas: dict = {}      # user_id -> {"msgs": [...], "ts": epoch, "mapa": {n: sesion_id}}


def _charla(user_id: int) -> dict:
    c = _charlas.get(user_id)
    if not c or time.time() - c["ts"] > TTL_SEG:
        c = {"msgs": [], "ts": time.time(), "mapa": {}}
        _charlas[user_id] = c
    c["ts"] = time.time()
    return c


def _snapshot() -> tuple[str, dict]:
    """Estado vivo de las sesiones, numerado para que Haiku refiera por número."""
    data = sesiones_state.listado()
    if not data["mac_online"]:
        return "⚠ La Mac está OFFLINE: solo se ve lo último conocido, no se puede ejecutar nada.", {}
    lineas, mapa = [], {}
    for i, s in enumerate(data["sesiones"][:12], 1):
        mapa[i] = s["id"]
        lineas.append(
            f"{i}. \"{s['titulo']}\" [{s['estado']}] proyecto={s['proyecto']}"
            f"{' (interactiva)' if s.get('interactivo') else ' (solo ver: hay que continuarla)'}"
            f" | último: {(s.get('preview') or '')[:150]}"
        )
    proys = ", ".join(p["nombre"] for p in data.get("proyectos", [])[:10])
    txt = "SESIONES AHORA:\n" + ("\n".join(lineas) or "(ninguna activa)")
    txt += f"\nCarpetas para sesión nueva: {proys}"
    return txt, mapa


_SYSTEM = """Sos la asistente de voz de Sebi en Prospia. Manejás sus sesiones de
Claude Code que corren en su Mac. Sebi te HABLA (lo que leés es voz transcripta,
puede venir con errores) y tu respuesta se LEE EN VOZ ALTA.

Reglas de la charla:
- Español rioplatense, tuteo (vos). Tono de compañera de trabajo, natural.
- CORTO: 1-2 frases, salvo que pida que le leas algo en detalle.
- Nada de markdown, ni emojis, ni URLs: es voz.
- Si una sesión terminó o está esperando, contáselo directo y ofrecé seguir.
- Referí a las sesiones por su título corto, no por números ni ids.

Podés ejecutar UNA acción por turno. Respondé SIEMPRE un JSON válido:
{"decir": "<lo que le decís a Sebi>", "accion": null}
o con acción:
- mandar mensaje: {"decir": "...", "accion": {"tipo": "mensaje", "n": <número de sesión>, "texto": "<mensaje para esa sesión de Claude>"}}
- sesión nueva:  {"decir": "...", "accion": {"tipo": "nueva", "carpeta": "<nombre de carpeta de la lista>", "texto": "<primer mensaje>"}}
- continuar una: {"decir": "...", "accion": {"tipo": "continuar", "n": <número>}}
Antes de una acción con efecto (mensaje/nueva/continuar) confirmá UNA vez si la
orden fue ambigua; si fue clara, ejecutá directo. El "texto" que mandes a una
sesión redactalo bien (Claude de esa sesión lo recibe tal cual)."""


def _parse(raw: str) -> dict:
    try:
        return json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw or "", re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass
    return {"decir": (raw or "").strip() or "Perdón, me perdí. ¿Me lo repetís?", "accion": None}


def _ejecutar(accion: dict, mapa: dict) -> str:
    """Corre la acción contra el puente. Devuelve un apéndice hablado."""
    try:
        tipo = accion.get("tipo")
        if tipo == "mensaje":
            sid = mapa.get(int(accion.get("n") or 0))
            if not sid:
                return " No encontré esa sesión, ¿cuál era?"
            r = sesiones_state.encolar_cmd({"cmd": "mensaje", "sesion_id": sid,
                                            "texto": accion.get("texto") or ""})
        elif tipo == "nueva":
            carpeta = (accion.get("carpeta") or "").strip()
            data = sesiones_state.listado()
            ruta = next((p["ruta"] for p in data.get("proyectos", [])
                         if p["nombre"].lower() == carpeta.lower()), None)
            if not ruta:
                return f" No tengo la carpeta {carpeta}, decime una de la lista."
            r = sesiones_state.encolar_cmd({"cmd": "nueva", "cwd": ruta,
                                            "texto": accion.get("texto") or ""}, timeout=50)
        elif tipo == "continuar":
            sid = mapa.get(int(accion.get("n") or 0))
            if not sid:
                return " No encontré esa sesión, ¿cuál era?"
            r = sesiones_state.encolar_cmd({"cmd": "continuar", "sesion_id": sid}, timeout=50)
        else:
            return ""
        return "" if r["ok"] else f" Ojo: no salió — {r['error']}."
    except Exception as e:
        return f" Ojo: falló la acción ({str(e)[:80]})."


def voz_chat(user_id: int, texto: str, reset: bool = False) -> str:
    if reset:
        _charlas.pop(user_id, None)
    c = _charla(user_id)
    estado, mapa = _snapshot()
    c["mapa"] = mapa

    c["msgs"].append({"role": "user", "content": texto[:2000]})
    c["msgs"] = c["msgs"][-MAX_TURNOS:]
    system = _SYSTEM + "\n\n" + estado
    raw = _post(system, list(c["msgs"]), max_tokens=500,
                funcion="Voz sesiones (asistente)", source="app")
    if raw is None:
        return "No pude pensar la respuesta, probá de nuevo en un toque."
    out = _parse(raw)
    decir = (out.get("decir") or "").strip() or "Listo."
    accion = out.get("accion")
    if isinstance(accion, dict):
        decir += _ejecutar(accion, mapa)
    c["msgs"].append({"role": "assistant", "content": raw[:2000]})
    return decir
