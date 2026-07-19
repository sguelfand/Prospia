"""Estado en memoria del puente de sesiones de Claude (Mac <-> backend <-> app).

El daemon `mac-bridge` (corre en la Mac de Sebi) se conecta por WebSocket
(`/sesiones/ws-mac`) y va subiendo snapshots/deltas de las sesiones de Claude
Code. La app los lee por REST (`/admin/sesiones*`). Los comandos que dispara la
app (mandar mensaje, crear sesión, continuar una) se encolan acá y el WS se los
baja al daemon, que contesta con `cmd_result`.

Todo es efímero a propósito: la verdad viva son los transcripts en la Mac. Si el
backend reinicia, el puente re-manda el snapshot completo al reconectar.
"""

from __future__ import annotations

import threading
from collections import deque
from datetime import datetime, timezone

# Tope de mensajes bufferizados por sesión (el chat de la app muestra esto).
MAX_MENSAJES = 300
# Tope de sesiones trackeadas (el puente ya filtra por actividad reciente).
MAX_SESIONES = 40

_lock = threading.Lock()
_mac_online = False
_last_seen: datetime | None = None
_sesiones: dict[str, dict] = {}  # id -> {meta..., "mensajes": [..]}
_proyectos: list[dict] = []

_cmd_seq = 0
_cmd_cola: deque[dict] = deque()
_cmd_pendientes: dict[int, dict] = {}  # cmd_id -> {"event": Event, "ok": .., "error": ..}


def _ahora() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------- conexión Mac

def set_mac_online(online: bool) -> None:
    global _mac_online, _last_seen
    with _lock:
        _mac_online = online
        _last_seen = datetime.now(timezone.utc)
        if not online:
            # Sin puente no hay comandos que entregar: fallar los que esperan.
            while _cmd_cola:
                cmd = _cmd_cola.popleft()
                resolver_cmd(cmd.get("cmd_id"), False, "La Mac se desconectó")


def mac_online() -> bool:
    with _lock:
        return _mac_online


# ------------------------------------------------------------------- sesiones

def aplicar_snapshot(data: dict) -> None:
    """Snapshot completo del puente: reemplaza todo el estado de sesiones."""
    global _proyectos
    with _lock:
        _sesiones.clear()
        for s in (data.get("sesiones") or [])[:MAX_SESIONES]:
            sid = s.get("id")
            if not sid:
                continue
            s["mensajes"] = (s.get("mensajes") or [])[-MAX_MENSAJES:]
            _sesiones[sid] = s
        _proyectos = data.get("proyectos") or []


def aplicar_sesion(s: dict) -> None:
    """Delta de una sesión: upsert de meta + append de mensajes nuevos."""
    sid = s.get("id")
    if not sid:
        return
    nuevos = s.pop("mensajes_nuevos", None) or []
    with _lock:
        prev = _sesiones.get(sid)
        if prev is None:
            s["mensajes"] = nuevos[-MAX_MENSAJES:]
            _sesiones[sid] = s
        else:
            mensajes = prev.get("mensajes") or []
            # Dedup por seq (el puente numera cada mensaje renderizable).
            ya = {m.get("seq") for m in mensajes}
            mensajes.extend(m for m in nuevos if m.get("seq") not in ya)
            mensajes.sort(key=lambda m: m.get("seq") or 0)
            s["mensajes"] = mensajes[-MAX_MENSAJES:]
            _sesiones[sid] = s
        if s.get("oculta"):
            _sesiones.pop(sid, None)


def listado() -> dict:
    with _lock:
        metas = []
        for s in _sesiones.values():
            meta = {k: v for k, v in s.items() if k != "mensajes"}
            metas.append(meta)
        metas.sort(key=lambda m: m.get("ultima_actividad") or "", reverse=True)
        return {
            "mac_online": _mac_online,
            "last_seen": _last_seen.isoformat() if _last_seen else None,
            "sesiones": metas,
            "proyectos": list(_proyectos),
        }


def detalle(sesion_id: str) -> dict | None:
    with _lock:
        s = _sesiones.get(sesion_id)
        if s is None:
            return None
        out = dict(s)
        out["mensajes"] = list(s.get("mensajes") or [])
        out["mac_online"] = _mac_online
        return out


# ------------------------------------------------------------------- comandos

def encolar_cmd(payload: dict, timeout: float = 15.0) -> dict:
    """Encola un comando para el puente y espera el resultado (o timeout).
    Devuelve {"ok": bool, "error": str|None}."""
    global _cmd_seq
    with _lock:
        if not _mac_online:
            return {"ok": False, "error": "La Mac está offline (puente desconectado)"}
        _cmd_seq += 1
        cmd_id = _cmd_seq
        payload = {**payload, "t": "cmd", "cmd_id": cmd_id}
        entry = {"event": threading.Event(), "ok": False, "error": "Sin respuesta de la Mac"}
        _cmd_pendientes[cmd_id] = entry
        _cmd_cola.append(payload)
    entry["event"].wait(timeout)
    with _lock:
        _cmd_pendientes.pop(cmd_id, None)
    return {"ok": entry["ok"], "error": entry["error"] if not entry["ok"] else None}


def proximo_cmd() -> dict | None:
    """Lo consume el loop del WebSocket para bajarle comandos al puente."""
    with _lock:
        return _cmd_cola.popleft() if _cmd_cola else None


def resolver_cmd(cmd_id, ok: bool, error: str | None = None) -> None:
    with _lock:
        entry = _cmd_pendientes.get(cmd_id)
    if entry:
        entry["ok"] = bool(ok)
        entry["error"] = error
        entry["event"].set()
