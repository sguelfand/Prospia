"""Sesiones de Claude en la Mac de Sebi, vistas/manejadas desde la app.

Dos mitades:
- `/sesiones/ws-mac`: WebSocket al que se conecta el daemon `mac-bridge` de la
  Mac (auth: mirror token por query). Sube snapshots/deltas y recibe comandos.
- `/admin/sesiones*`: REST para la app (superadmin). La app hace polling corto
  mientras la pantalla está abierta; los POST encolan comandos al puente y
  esperan el ack.

El estado vive en memoria (services/sesiones_state.py); la verdad son los
transcripts de la Mac.
"""

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel

from app.core.config import settings
from app.core.deps import get_superadmin
from app.services import push, sesiones_state as st

router = APIRouter(prefix="/sesiones", tags=["sesiones"])
admin_router = APIRouter(prefix="/admin", tags=["sesiones"], dependencies=[Depends(get_superadmin)])

# Eventos que el puente puede pedir pushear (whitelist).
# `sesion_espera` se eliminó (Sebi, 23/7): duplicaba el canal `pregunta_claude`.
# `pregunta_claude` (Sebi, 24/7): el puente lo usa para el FALLBACK de la pregunta
# nativa — con el switch "Preguntas al cel" apagado, una AskUserQuestion sin
# contestar en la Mac por 10 min se reenvía al cel. Reusa el toggle de push de las
# preguntas del MCP (mismo canal para Sebi), pero con deep-link a la sesión: el
# popup respondible ya vive en la pantalla Sesiones.
_EVENTOS_PUENTE = {"sesion_termino", "pregunta_claude"}

_ws_actual: WebSocket | None = None


# ------------------------------------------------------------- WS del puente

def _token_ok(token: str | None) -> bool:
    esperado = settings.ETIGUEL_MIRROR_TOKEN or settings.WEBHOOK_TOKEN
    return bool(esperado) and token == esperado


async def _bajar_comandos(ws: WebSocket):
    """Task que drena la cola de comandos hacia el puente."""
    while True:
        cmd = st.proximo_cmd()
        if cmd is None:
            await asyncio.sleep(0.3)
            continue
        await ws.send_text(json.dumps(cmd, ensure_ascii=False))


@router.websocket("/ws-mac")
async def ws_mac(ws: WebSocket, token: str = ""):
    global _ws_actual
    if not _token_ok(token):
        await ws.close(code=4403)
        return
    await ws.accept()
    # Una sola Mac: si había una conexión vieja colgada, la pisamos.
    if _ws_actual is not None:
        try:
            await _ws_actual.close()
        except Exception:
            pass
    _ws_actual = ws
    st.set_mac_online(True)
    sender = asyncio.create_task(_bajar_comandos(ws))
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            t = msg.get("t")
            if t == "snapshot":
                st.aplicar_snapshot(msg)
            elif t == "sesion":
                st.aplicar_sesion(msg.get("sesion") or {})
            elif t == "cmd_result":
                st.resolver_cmd(msg.get("cmd_id"), msg.get("ok"), msg.get("error"))
            elif t == "notificar":
                evento = msg.get("evento")
                if evento in _EVENTOS_PUENTE:
                    try:
                        push.notificar_global_async(
                            evento,
                            (msg.get("titulo") or "Sesión de Claude")[:120],
                            (msg.get("cuerpo") or "")[:300],
                            data={"nav": "sesiones", "tipo": "sesion",
                                  "sesion_id": msg.get("sesion_id")},
                            detalle=msg.get("detalle") or None,
                        )
                    except Exception:
                        pass
            elif t == "ping":
                await ws.send_text('{"t":"pong"}')
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        sender.cancel()
        if _ws_actual is ws:
            _ws_actual = None
            st.set_mac_online(False)


# ------------------------------------------------------------- REST de la app

class MensajeIn(BaseModel):
    texto: str


class VozIn(BaseModel):
    texto: str
    reset: bool = False


@admin_router.post("/voz/chat")
def voz_chat(body: VozIn, user=Depends(get_superadmin)):
    """Asistente de voz de sesiones (Etapa 2): texto transcripto → respuesta
    corta para leer en voz alta; ejecuta acciones vía el puente."""
    texto = (body.texto or "").strip()
    if not texto:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Decime algo")
    from app.services import voz_ai
    return {"respuesta": voz_ai.voz_chat(user.id, texto, reset=body.reset)}


class NuevaSesionIn(BaseModel):
    cwd: str
    texto: str


@admin_router.get("/sesiones")
def listar_sesiones():
    """Lista de sesiones (meta, sin mensajes) + estado del puente."""
    return st.listado()


@admin_router.get("/sesiones/{sesion_id}/mensajes")
def mensajes_sesion(sesion_id: str):
    """Detalle de una sesión con su chat bufferizado."""
    s = st.detalle(sesion_id)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No existe esa sesión")
    return s


def _ejecutar(payload: dict, timeout: float = 15.0) -> dict:
    res = st.encolar_cmd(payload, timeout=timeout)
    if not res["ok"]:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail=res["error"] or "El puente no respondió")
    return {"ok": True}


@admin_router.post("/sesiones/{sesion_id}/mensaje")
def mandar_mensaje(sesion_id: str, body: MensajeIn):
    """Manda texto a una sesión interactiva (tmux) en la Mac."""
    texto = (body.texto or "").strip()
    if not texto:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Mensaje vacío")
    return _ejecutar({"cmd": "mensaje", "sesion_id": sesion_id, "texto": texto})


@admin_router.post("/sesiones/{sesion_id}/continuar")
def continuar_sesion(sesion_id: str):
    """Reabre en tmux una sesión de VSCode/terminal para poder escribirle."""
    return _ejecutar({"cmd": "continuar", "sesion_id": sesion_id}, timeout=50)


@admin_router.post("/sesiones/nueva")
def nueva_sesion(body: NuevaSesionIn):
    """Crea una sesión nueva de Claude en la Mac (tmux) con su primer mensaje."""
    texto = (body.texto or "").strip()
    if not texto:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="Escribí el primer mensaje de la sesión")
    return _ejecutar({"cmd": "nueva", "cwd": body.cwd, "texto": texto}, timeout=50)
