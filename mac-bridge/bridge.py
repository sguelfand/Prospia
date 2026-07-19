#!/usr/bin/env python3
"""mac-bridge: puente entre las sesiones de Claude Code de la Mac y Prospia.

Corre como daemon (launchd) en la Mac de Sebi. Hace tres cosas:
1. Lee los transcripts de ~/.claude/projects/ y arma el estado de cada sesión
   (título, mensajes renderizables, si está procesando/esperando/idle).
2. Recibe los hooks de Claude Code (UserPromptSubmit/Stop/Notification/...) por
   HTTP local (127.0.0.1:8765) para tener el estado al instante.
3. Se conecta por WebSocket SALIENTE al backend de Prospia y sube
   snapshots/deltas; recibe comandos de la app (mandar mensaje, crear sesión,
   continuar una) y los ejecuta vía tmux.

Las sesiones creadas/continuadas desde la app viven en tmux: son 100%%
interactivas desde el cel Y desde la Mac (tmux attach). A una sesión interactiva
de VSCode/terminal no se le puede inyectar texto (limitación de Claude Code):
solo se ve, hasta que se la "continúa" en tmux.

Python 3.9 compatible. Única dependencia externa: websockets.
"""

from __future__ import annotations

import asyncio
import json
import os
import queue
import re
import shutil
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# ----------------------------------------------------------------- config

HOME = Path.home()
PROJECTS_DIR = HOME / ".claude" / "projects"
STATE_DIR = HOME / ".claude" / "mac-bridge"
REGISTRY_FILE = STATE_DIR / "registry.json"
LOG_FILE = STATE_DIR / "bridge.log"
SECRETS_FILE = HOME / ".config" / "claude" / "secrets.env"

WS_URL = os.environ.get("PROSPIA_SESIONES_WS", "wss://prospia.app/api/sesiones/ws-mac")
HOOK_PORT = int(os.environ.get("BRIDGE_HOOK_PORT", "8765"))

# Sesiones "activas" = transcript tocado en esta ventana.
VENTANA_ACTIVA_H = 24
MAX_SESIONES = 25
TAIL_SNAPSHOT = 60          # mensajes por sesión en el snapshot inicial
MIN_SEG_AVISO_TERMINO = 60  # solo avisar "terminó" si el turno duró al menos esto
RATE_AVISO_ESPERA_SEG = 300  # no repetir "te espera" por sesión antes de esto

SKIP_PREFIJOS = ("<local-command", "<command-name", "Caveat:", "[Request interrupted",
                 "<system-reminder", "<task-notification", "<teammate-message")


def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        if LOG_FILE.exists() and LOG_FILE.stat().st_size > 5_000_000:
            LOG_FILE.write_text("")
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def cargar_token() -> str:
    tok = os.environ.get("PROSPIA_MIRROR_TOKEN", "")
    if tok:
        return tok
    try:
        for line in SECRETS_FILE.read_text().splitlines():
            m = re.match(r'\s*(?:export\s+)?PROSPIA_MIRROR_TOKEN=["\']?([^"\'\s]+)', line)
            if m:
                return m.group(1)
    except Exception:
        pass
    return ""


def ahora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ----------------------------------------------------------------- tmux

def _which_claude() -> str:
    for c in (shutil.which("claude"),
              str(HOME / ".local/bin/claude"),
              "/opt/homebrew/bin/claude",
              "/usr/local/bin/claude"):
        if c and os.path.exists(c):
            return c
    return "claude"


def _which_tmux() -> str:
    return shutil.which("tmux") or "/opt/homebrew/bin/tmux"


class Tmux:
    """Sesiones de Claude manejadas por el puente (interactivas desde app y Mac)."""

    def __init__(self):
        self.tmux = _which_tmux()
        self.claude = _which_claude()
        self.registry: dict = {}
        self._cargar()

    def _cargar(self):
        try:
            self.registry = json.loads(REGISTRY_FILE.read_text())
        except Exception:
            self.registry = {}

    def _guardar(self):
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        REGISTRY_FILE.write_text(json.dumps(self.registry, indent=2))

    def _run(self, *args, **kw):
        return subprocess.run([self.tmux, *args], capture_output=True, text=True,
                              timeout=15, **kw)

    def viva(self, nombre: str) -> bool:
        return self._run("has-session", "-t", f"={nombre}").returncode == 0

    def interactiva(self, sesion_id: str):
        info = self.registry.get(sesion_id)
        if info and self.viva(info["tmux"]):
            return info["tmux"]
        return None

    def _esperar_listo(self, nombre: str, seg: int = 20) -> bool:
        """Espera a que el TUI de Claude esté dibujado antes de tipear."""
        fin = time.time() + seg
        while time.time() < fin:
            cap = self._run("capture-pane", "-p", "-t", f"={nombre}")
            if cap.returncode != 0:
                return False
            txt = cap.stdout or ""
            if "? for shortcuts" in txt or "shortcuts" in txt or "" in txt or ">" in txt:
                time.sleep(1.0)  # margen para que termine de montar
                return True
            time.sleep(0.7)
        return False

    def escribir(self, nombre: str, texto: str) -> None:
        """Pega el texto (bracketed paste, banca multilínea) y manda Enter."""
        p = subprocess.run([self.tmux, "load-buffer", "-b", "puente", "-"],
                           input=texto, text=True, capture_output=True, timeout=15)
        if p.returncode != 0:
            raise RuntimeError(f"tmux load-buffer: {p.stderr.strip()}")
        r = self._run("paste-buffer", "-p", "-b", "puente", "-t", f"={nombre}")
        if r.returncode != 0:
            raise RuntimeError(f"tmux paste-buffer: {r.stderr.strip()}")
        time.sleep(0.4)
        self._run("send-keys", "-t", f"={nombre}", "Enter")

    def teclas(self, nombre: str, teclas: str) -> None:
        """Teclas crudas ("1", "Enter", "Escape", "Down") p/ prompts nativos."""
        self._run("send-keys", "-t", f"={nombre}", *teclas.split())

    def mensaje(self, sesion_id: str, texto: str) -> None:
        nombre = self.interactiva(sesion_id)
        if not nombre:
            raise RuntimeError("Esa sesión no es interactiva desde el cel. "
                               "Usá 'Continuar desde el cel' primero.")
        m = re.match(r"^/key\s+(.+)$", texto.strip())
        if m:
            self.teclas(nombre, m.group(1))
        else:
            self.escribir(nombre, texto)

    def _nombre_libre(self, base: str) -> str:
        base = re.sub(r"[^a-zA-Z0-9_-]", "-", base)[:20] or "sesion"
        nombre = f"cc-{base}"
        i = 2
        while self.viva(nombre):
            nombre = f"cc-{base}-{i}"
            i += 1
        return nombre

    def nueva(self, cwd: str, texto: str) -> str:
        """Crea sesión nueva de Claude en tmux y le manda el primer mensaje.
        Devuelve el session_id (lo elegimos nosotros con --session-id)."""
        cwd = os.path.expanduser(cwd)
        if not os.path.isdir(cwd):
            raise RuntimeError(f"No existe la carpeta {cwd}")
        sid = str(uuid.uuid4())
        nombre = self._nombre_libre(os.path.basename(cwd))
        cmd = f'"{self.claude}" --session-id {sid}'
        r = self._run("new-session", "-d", "-s", nombre, "-c", cwd, cmd)
        if r.returncode != 0:
            raise RuntimeError(f"tmux new-session: {r.stderr.strip()}")
        if not self._esperar_listo(nombre):
            raise RuntimeError("Claude no llegó a arrancar en tmux")
        self.escribir(nombre, texto)
        self.registry[sid] = {"tmux": nombre, "cwd": cwd, "creada": ahora_iso()}
        self._guardar()
        return sid

    def continuar(self, sesion_id: str, cwd: str):
        """Reabre una sesión de VSCode/terminal en tmux con --resume.
        Devuelve (nuevo_sid | None, nombre_tmux): si claude forkea el id al
        resumir, detectamos el jsonl nuevo y mapeamos."""
        cwd = os.path.expanduser(cwd)
        nombre = self._nombre_libre("cont-" + sesion_id[:8])
        proyecto_dir = PROJECTS_DIR / re.sub(r"[^a-zA-Z0-9]", "-", cwd)
        antes = {p.name for p in proyecto_dir.glob("*.jsonl")} if proyecto_dir.is_dir() else set()
        t0 = time.time()
        cmd = f'"{self.claude}" --resume {sesion_id}'
        r = self._run("new-session", "-d", "-s", nombre, "-c", cwd, cmd)
        if r.returncode != 0:
            raise RuntimeError(f"tmux new-session: {r.stderr.strip()}")
        if not self._esperar_listo(nombre, 25):
            raise RuntimeError("Claude no llegó a resumir la sesión en tmux")
        # ¿Siguió con el mismo id o forkeó a uno nuevo?
        nuevo_sid = None
        fin = time.time() + 10
        while time.time() < fin and proyecto_dir.is_dir():
            for p in proyecto_dir.glob("*.jsonl"):
                if p.name not in antes and p.stat().st_mtime >= t0:
                    nuevo_sid = p.stem
                    break
            if nuevo_sid:
                break
            time.sleep(1)
        sid_final = nuevo_sid or sesion_id
        self.registry[sid_final] = {"tmux": nombre, "cwd": cwd, "creada": ahora_iso(),
                                    "continuada_de": sesion_id if nuevo_sid else None}
        self._guardar()
        return nuevo_sid, nombre


# ----------------------------------------------------------------- transcripts

def _decodificar_proyecto(nombre_dir: str) -> str:
    """"-Users-x-Documents-Claude" -> "/Users/x/Documents/Claude".
    El encoding de Claude es ambiguo con carpetas que llevan guión (varen-home):
    armamos el path greedy, prefiriendo el guión cuando el slash no existe."""
    if not nombre_dir.startswith("-"):
        return nombre_dir
    path = ""
    for seg in nombre_dir[1:].split("-"):
        con_slash = path + "/" + seg
        if path and not os.path.isdir(con_slash) and os.path.isdir(path + "-" + seg):
            path = path + "-" + seg
        else:
            path = con_slash
    return path


def _resumen_tool(nombre: str, inp: dict) -> str:
    nombre = nombre.replace("mcp__preguntar-sebi__", "MCP ")
    detalle = (inp.get("description") or inp.get("command") or inp.get("file_path")
               or inp.get("pattern") or inp.get("skill") or inp.get("prompt")
               or inp.get("pregunta") or "")
    detalle = str(detalle).strip().replace("\n", " ")
    if len(detalle) > 90:
        detalle = detalle[:90] + "…"
    return f"{nombre} · {detalle}" if detalle else nombre


class Sesion:
    def __init__(self, sid: str, proyecto_dir: str):
        self.id = sid
        self.proyecto_dir = proyecto_dir  # nombre codificado del dir
        self.cwd = _decodificar_proyecto(proyecto_dir)
        self.titulo = ""
        self.branch = ""
        self.mensajes: list = []   # [{seq, rol, texto, hora}]
        self.seq = 0
        self.offset = 0            # bytes leídos del jsonl
        self.estado = "idle"       # procesando | esperando | pregunta | idle
        self.ultima_actividad = ""
        self.turno_inicio = None   # epoch del arranque del turno actual
        self.ultimo_aviso_espera = 0.0
        self.pregunta_mcp_abierta = False
        self.oculta = False
        self.entrypoint = ""

    def agregar(self, rol: str, texto: str, hora: str):
        self.seq += 1
        self.mensajes.append({"seq": self.seq, "rol": rol, "texto": texto, "hora": hora})
        if len(self.mensajes) > 400:
            del self.mensajes[:100]

    def ultimo_texto_claude(self) -> str:
        for m in reversed(self.mensajes):
            if m["rol"] == "claude":
                return m["texto"]
        return ""

    def meta(self, interactiva: bool) -> dict:
        prev = self.ultimo_texto_claude()
        return {
            "id": self.id,
            "titulo": self.titulo or (self.mensajes[0]["texto"][:60] if self.mensajes else self.id[:8]),
            "proyecto": os.path.basename(self.cwd) or self.cwd,
            "cwd": self.cwd,
            "branch": self.branch,
            "estado": self.estado,
            "interactivo": interactiva,
            "ultima_actividad": self.ultima_actividad,
            "seq": self.seq,
            "preview": (prev[:160] + "…") if len(prev) > 160 else prev,
            "oculta": self.oculta,
        }


class Tracker:
    """Lee los transcripts en forma incremental y mantiene el estado."""

    def __init__(self, tmux: Tmux, salida: "queue.Queue"):
        self.tmux = tmux
        self.salida = salida  # mensajes para el WS
        self.sesiones: dict = {}
        self.enviado_seq: dict = {}   # sid -> último seq mandado
        self.enviado_meta: dict = {}  # sid -> json de meta mandada

    # ---- parseo ----

    def _parsear_linea(self, s: Sesion, obj: dict):
        t = obj.get("type")
        if t == "ai-title":
            s.titulo = (obj.get("aiTitle") or "").strip() or s.titulo
            return
        if obj.get("isSidechain"):
            return
        hora = obj.get("timestamp") or ahora_iso()
        if t == "user":
            s.entrypoint = obj.get("entrypoint") or s.entrypoint
            s.branch = obj.get("gitBranch") or s.branch
            s.cwd = obj.get("cwd") or s.cwd
            # CUALQUIER entrada user (incluye tool_results) = Claude recibió
            # input: si había una pregunta abierta, ya fue respondida.
            if s.pregunta_mcp_abierta or s.estado == "pregunta":
                s.pregunta_mcp_abierta = False
                s.estado = "procesando"
                s.turno_inicio = s.turno_inicio or time.time()
            msg = obj.get("message") or {}
            contenido = msg.get("content")
            texto = ""
            if isinstance(contenido, str):
                texto = contenido
            elif isinstance(contenido, list):
                partes = [b.get("text", "") for b in contenido
                          if isinstance(b, dict) and b.get("type") == "text"]
                texto = "\n".join(p for p in partes if p)
            texto = (texto or "").strip()
            if not texto or texto.startswith(SKIP_PREFIJOS):
                return
            s.agregar("sebi", texto, hora)
            s.pregunta_mcp_abierta = False
            if s.estado in ("idle", "esperando", "pregunta"):
                s.estado = "procesando"
                s.turno_inicio = time.time()
        elif t == "assistant":
            msg = obj.get("message") or {}
            for b in msg.get("content") or []:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text" and (b.get("text") or "").strip():
                    s.agregar("claude", b["text"].strip(), hora)
                    if s.estado == "esperando":
                        s.estado = "procesando"
                elif b.get("type") == "tool_use":
                    nombre = b.get("name") or "?"
                    s.agregar("tool", _resumen_tool(nombre, b.get("input") or {}), hora)
                    if "preguntar_a_sebi" in nombre or nombre == "AskUserQuestion":
                        s.pregunta_mcp_abierta = True
                        s.estado = "pregunta"

    def _leer_incremental(self, s: Sesion, path: Path):
        try:
            size = path.stat().st_size
            if size < s.offset:  # archivo reescrito
                s.offset = 0
                s.mensajes = []
                s.seq = 0
            if size == s.offset:
                return False
            with open(path, "r", errors="replace") as f:
                f.seek(s.offset)
                data = f.read()
                s.offset = f.tell()
            for line in data.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    self._parsear_linea(s, json.loads(line))
                except Exception:
                    continue
            s.ultima_actividad = datetime.fromtimestamp(path.stat().st_mtime,
                                                        timezone.utc).isoformat()
            return True
        except FileNotFoundError:
            return False

    # ---- scan ----

    def scan(self):
        if not PROJECTS_DIR.is_dir():
            return
        limite = time.time() - VENTANA_ACTIVA_H * 3600
        vistos = set()
        candidatos = []
        for proy in PROJECTS_DIR.iterdir():
            if not proy.is_dir():
                continue
            for f in proy.glob("*.jsonl"):
                try:
                    mt = f.stat().st_mtime
                except FileNotFoundError:
                    continue
                if mt >= limite and f.stat().st_size > 200:
                    candidatos.append((mt, proy.name, f))
        candidatos.sort(reverse=True)
        for mt, proy_nombre, f in candidatos[:MAX_SESIONES]:
            sid = f.stem
            vistos.add(sid)
            s = self.sesiones.get(sid)
            if s is None:
                s = Sesion(sid, proy_nombre)
                self.sesiones[sid] = s
            cambio = self._leer_incremental(s, f)
            if cambio:
                self._emitir_delta(s)
        # sesiones que salieron de la ventana → ocultarlas en el backend
        for sid, s in list(self.sesiones.items()):
            if sid not in vistos and not s.oculta:
                s.oculta = True
                self._emitir_delta(s, forzar=True)

    # ---- hooks ----

    def evento_hook(self, ev: dict):
        sid = ev.get("session_id") or ""
        nombre = ev.get("hook_event_name") or ""
        s = self.sesiones.get(sid)
        if s is None:
            return
        if nombre == "UserPromptSubmit":
            s.estado = "procesando"
            s.turno_inicio = time.time()
        elif nombre == "Stop":
            dur = (time.time() - s.turno_inicio) if s.turno_inicio else 0
            s.estado = "pregunta" if s.pregunta_mcp_abierta else "idle"
            s.turno_inicio = None
            self.scan()  # levantar el texto final ya
            if dur >= MIN_SEG_AVISO_TERMINO and s.estado == "idle":
                texto = s.ultimo_texto_claude()
                self.salida.put({"t": "notificar", "evento": "sesion_termino",
                                 "sesion_id": sid,
                                 "titulo": f"✅ {s.meta(False)['titulo'][:60]}",
                                 "cuerpo": texto[:250] or "Terminó la tarea.",
                                 "detalle": texto[:4000] or None})
        elif nombre in ("Notification", "PermissionRequest"):
            if s.estado != "pregunta":
                s.estado = "esperando"
            if time.time() - s.ultimo_aviso_espera > RATE_AVISO_ESPERA_SEG:
                s.ultimo_aviso_espera = time.time()
                detalle = ev.get("message") or "Una sesión quedó esperándote."
                self.salida.put({"t": "notificar", "evento": "sesion_espera",
                                 "sesion_id": sid,
                                 "titulo": f"⏸ {s.meta(False)['titulo'][:60]}",
                                 "cuerpo": str(detalle)[:250]})
        elif nombre == "SessionEnd":
            s.estado = "idle"
        self._emitir_delta(s, forzar=True)

    # ---- emisión ----

    def _emitir_delta(self, s: Sesion, forzar: bool = False):
        interactiva = bool(self.tmux.interactiva(s.id))
        meta = s.meta(interactiva)
        desde = self.enviado_seq.get(s.id, 0)
        nuevos = [m for m in s.mensajes if m["seq"] > desde]
        meta_json = json.dumps(meta, sort_keys=True)
        if not nuevos and not forzar and self.enviado_meta.get(s.id) == meta_json:
            return
        self.enviado_seq[s.id] = s.seq
        self.enviado_meta[s.id] = meta_json
        sesion = dict(meta)
        sesion["mensajes_nuevos"] = nuevos[-200:]
        self.salida.put({"t": "sesion", "sesion": sesion})

    def snapshot(self) -> dict:
        sesiones = []
        for s in self.sesiones.values():
            if s.oculta:
                continue
            interactiva = bool(self.tmux.interactiva(s.id))
            item = s.meta(interactiva)
            item["mensajes"] = s.mensajes[-TAIL_SNAPSHOT:]
            sesiones.append(item)
            self.enviado_seq[s.id] = s.seq
            self.enviado_meta[s.id] = json.dumps(s.meta(interactiva), sort_keys=True)
        return {"t": "snapshot", "sesiones": sesiones, "proyectos": self.proyectos()}

    def proyectos(self) -> list:
        """Carpetas candidatas para 'Nueva sesión'."""
        rutas = {}
        for proy in (PROJECTS_DIR.iterdir() if PROJECTS_DIR.is_dir() else []):
            if proy.is_dir():
                ruta = _decodificar_proyecto(proy.name)
                if os.path.isdir(ruta):
                    rutas[ruta] = None
        base = HOME / "Documents" / "Claude"
        if base.is_dir():
            rutas[str(base)] = None
            for d in sorted(base.iterdir()):
                if d.is_dir() and not d.name.startswith(".") and not d.name.endswith("-sesiones"):
                    rutas[str(d)] = None
        return [{"ruta": r, "nombre": os.path.basename(r) or r} for r in list(rutas)[:30]]


# ----------------------------------------------------------------- hooks HTTP

def armar_http(cola_eventos: "queue.Queue"):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"ok":true}')

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n) if n else b"{}"
            try:
                cola_eventos.put(json.loads(body.decode("utf-8", "replace")))
            except Exception:
                pass
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"ok":true}')

    srv = ThreadingHTTPServer(("127.0.0.1", HOOK_PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    log(f"hooks HTTP escuchando en 127.0.0.1:{HOOK_PORT}")
    return srv


# ----------------------------------------------------------------- comandos

def ejecutar_cmd(tracker: Tracker, tmux: Tmux, cmd: dict) -> dict:
    try:
        que = cmd.get("cmd")
        if que == "mensaje":
            tmux.mensaje(cmd["sesion_id"], cmd["texto"])
        elif que == "nueva":
            tmux.nueva(cmd.get("cwd") or str(HOME / "Documents" / "Claude"), cmd["texto"])
        elif que == "continuar":
            s = tracker.sesiones.get(cmd["sesion_id"])
            cwd = s.cwd if s else str(HOME / "Documents" / "Claude")
            nuevo, _ = tmux.continuar(cmd["sesion_id"], cwd)
            if nuevo and s:
                s.oculta = True  # la sesión vieja sigue en el fork nuevo
        else:
            return {"ok": False, "error": f"Comando desconocido: {que}"}
        return {"ok": True, "error": None}
    except Exception as e:
        log(f"cmd {cmd.get('cmd')} falló: {e}")
        return {"ok": False, "error": str(e)[:300]}


# ----------------------------------------------------------------- loop WS

async def loop_ws(token: str, tracker: Tracker, salida: "queue.Queue",
                  cola_eventos: "queue.Queue", tmux: Tmux):
    import websockets

    url = f"{WS_URL}?token={token}"
    backoff = 3
    while True:
        try:
            async with websockets.connect(url, ping_interval=25, ping_timeout=20,
                                          max_size=8_000_000) as ws:
                log("WS conectado al backend")
                backoff = 3
                tracker.scan()
                await ws.send(json.dumps(tracker.snapshot(), ensure_ascii=False))

                async def subir():
                    ultimo_scan = 0.0
                    while True:
                        # hooks primero (estado al instante)
                        try:
                            while True:
                                ev = cola_eventos.get_nowait()
                                tracker.evento_hook(ev)
                        except queue.Empty:
                            pass
                        # transcripts cada 1.5s
                        if time.time() - ultimo_scan > 1.5:
                            ultimo_scan = time.time()
                            def _scan():
                                try:
                                    tracker.scan()
                                except Exception as e:
                                    log(f"scan error: {e}")
                            await asyncio.get_event_loop().run_in_executor(None, _scan)
                        # drenar salida
                        try:
                            while True:
                                msg = salida.get_nowait()
                                await ws.send(json.dumps(msg, ensure_ascii=False))
                        except queue.Empty:
                            pass
                        await asyncio.sleep(0.3)

                async def bajar():
                    async for raw in ws:
                        try:
                            cmd = json.loads(raw)
                        except Exception:
                            continue
                        if cmd.get("t") != "cmd":
                            continue

                        def correr(c=cmd):
                            res = ejecutar_cmd(tracker, tmux, c)
                            salida.put({"t": "cmd_result", "cmd_id": c.get("cmd_id"),
                                        "ok": res["ok"], "error": res["error"]})

                        threading.Thread(target=correr, daemon=True).start()

                done, pending = await asyncio.wait(
                    [asyncio.ensure_future(subir()), asyncio.ensure_future(bajar())],
                    return_when=asyncio.FIRST_EXCEPTION)
                for p in pending:
                    p.cancel()
                for d in done:
                    exc = d.exception()
                    if exc is not None:
                        raise exc
        except Exception as e:
            log(f"WS caído ({type(e).__name__}: {e}); reintento en {backoff}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)


def main():
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    token = cargar_token()
    if not token:
        log("FALTA PROSPIA_MIRROR_TOKEN (env o secrets.env). Abortando.")
        raise SystemExit(1)
    salida: "queue.Queue" = queue.Queue()
    cola_eventos: "queue.Queue" = queue.Queue()
    tmux = Tmux()
    tracker = Tracker(tmux, salida)
    armar_http(cola_eventos)
    log(f"mac-bridge arrancando (claude={tmux.claude}, tmux={tmux.tmux})")
    asyncio.get_event_loop().run_until_complete(
        loop_ws(token, tracker, salida, cola_eventos, tmux))


if __name__ == "__main__":
    main()
