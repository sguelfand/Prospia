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
ABIERTAS_FILE = STATE_DIR / "abiertas.json"
LOG_FILE = STATE_DIR / "bridge.log"
SECRETS_FILE = HOME / ".config" / "claude" / "secrets.env"

WS_URL = os.environ.get("PROSPIA_SESIONES_WS", "wss://prospia.app/api/sesiones/ws-mac")
HOOK_PORT = int(os.environ.get("BRIDGE_HOOK_PORT", "8765"))

# Sesiones "activas" = transcript tocado en esta ventana.
VENTANA_ACTIVA_H = 72  # 24 quedaba corto: con la Mac durmiendo de noche, la lista amanecía vacía
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
            # Target SIN "=": el prefijo exact-match vale para sesiones
            # (has-session) pero capture-pane espera un pane y no lo resuelve.
            cap = self._run("capture-pane", "-p", "-t", nombre)
            if cap.returncode != 0:
                return False
            txt = cap.stdout or ""
            # Listo = el input box idle del TUI ("? for shortcuts"). Nada de
            # marcadores sueltos ("❯"/">"): los diálogos de arranque también
            # los tienen y el paste se perdía adentro de un chooser.
            if "? for shortcuts" in txt:
                time.sleep(1.0)  # margen para que termine de montar
                return True
            # Diálogo de confianza de carpeta ("Do you trust...") → aceptar.
            if "trust" in txt.lower() and ("proceed" in txt.lower() or "Enter" in txt):
                self._run("send-keys", "-t", nombre, "Enter")
                time.sleep(1.5)
                continue
            # Cualquier otro chooser de arranque (p.ej. "Try the new fullscreen
            # renderer?") → Escape lo descarta y deja el input normal.
            if "Enter to confirm" in txt or "Esc to cancel" in txt:
                self._run("send-keys", "-t", nombre, "Escape")
                time.sleep(1.5)
                continue
            time.sleep(0.7)
        return False

    def escribir(self, nombre: str, texto: str) -> None:
        """Pega el texto (bracketed paste, banca multilínea), VERIFICA que haya
        quedado en el input box y recién ahí manda Enter."""
        marca = texto.strip().splitlines()[0][:25]
        for intento in range(3):
            p = subprocess.run([self.tmux, "load-buffer", "-b", "puente", "-"],
                               input=texto, text=True, capture_output=True, timeout=15)
            if p.returncode != 0:
                raise RuntimeError(f"tmux load-buffer: {p.stderr.strip()}")
            r = self._run("paste-buffer", "-p", "-b", "puente", "-t", nombre)
            if r.returncode != 0:
                raise RuntimeError(f"tmux paste-buffer: {r.stderr.strip()}")
            time.sleep(0.6)
            cap = self._run("capture-pane", "-p", "-t", nombre)
            if marca and marca not in (cap.stdout or ""):
                time.sleep(1.5)  # el TUI todavía no estaba listo; reintentar
                continue
            self._run("send-keys", "-t", nombre, "Enter")
            return
        raise RuntimeError("El texto no llegó al input de Claude en tmux")

    def teclas(self, nombre: str, teclas: str) -> None:
        """Teclas crudas ("1", "Enter", "Escape", "Down") p/ prompts nativos."""
        self._run("send-keys", "-t", nombre, *teclas.split())

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
        # Si en la Mac no hay ninguna ventana mirando esta sesión, abrirla:
        # lo que Sebi hace desde el cel se ve en tiempo real al volver.
        if not self._hay_cliente(nombre):
            self._abrir_ventana(nombre)

    # -- ventana visible en la Mac (tiempo real) -------------------------------
    # Las sesiones del cel se lanzan DENTRO de una ventana de Terminal (un
    # .command + `open`): Sebi las ve en vivo en la Mac, nada queda "viejo". De
    # paso, el server de tmux nace con los permisos TCC de Terminal (Documents).

    def _win_file(self, nombre: str) -> Path:
        return STATE_DIR / f"win-{nombre}.command"

    def _crear_win(self, nombre: str, cwd: str, claude_args: str) -> Path:
        f = self._win_file(nombre)
        f.write_text(
            "#!/bin/bash\n"
            'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"\n'
            "clear\n"
            # -A: crea la sesión si no existe, o se cuelga de la ya existente.
            f'exec tmux new-session -A -s {nombre} -c "{cwd}" '
            f"'\"{self.claude}\" {claude_args}'\n"
        )
        f.chmod(0o755)
        return f

    def _abrir_ventana(self, nombre: str) -> bool:
        f = self._win_file(nombre)
        if not f.exists():
            return False
        r = subprocess.run(["/usr/bin/open", str(f)], capture_output=True, timeout=10)
        return r.returncode == 0

    def _hay_cliente(self, nombre: str) -> bool:
        r = self._run("list-clients", "-t", nombre)
        return r.returncode == 0 and bool((r.stdout or "").strip())

    def _esperar_sesion(self, nombre: str, seg: int = 25) -> bool:
        fin = time.time() + seg
        while time.time() < fin:
            if self.viva(nombre):
                return True
            time.sleep(0.7)
        return False

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
        # Ojo: no validamos con isdir() — el daemon puede no tener permiso TCC
        # para *ver* ~/Documents; si la carpeta no existe, tmux/claude fallan solos.
        sid = str(uuid.uuid4())
        nombre = self._nombre_libre(os.path.basename(cwd))
        # Nace en una ventana de Terminal visible (tiempo real en la Mac).
        # Fallback si `open` falla: tmux directo (sin ventana).
        self._crear_win(nombre, cwd, f"--session-id {sid}")
        if not (self._abrir_ventana(nombre) and self._esperar_sesion(nombre)):
            log(f"nueva {nombre}: sin ventana Terminal, fallback tmux directo")
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
        # También en ventana de Terminal visible; fallback: tmux directo.
        self._crear_win(nombre, cwd, f"--resume {sesion_id}")
        if not (self._abrir_ventana(nombre) and self._esperar_sesion(nombre)):
            log(f"continuar {nombre}: sin ventana Terminal, fallback tmux directo")
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
        self.pregunta_texto = ""
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
            "pregunta_texto": self.pregunta_texto if self.estado == "pregunta" else "",
            "oculta": self.oculta,
        }


class Tracker:
    """Lee los transcripts en forma incremental y mantiene el estado.

    Solo se muestran sesiones ABIERTAS en la Mac (pedido de Sebi 20/7: las
    cerradas no van al cel). "Abierta" se decide así:
    - cualquier evento de hook de esa sesión (menos SessionEnd) la marca
      abierta (persistido en abiertas.json, sobrevive restarts);
    - actividad fresca del transcript (<10 min) también la marca;
    - SessionEnd la cierra; una sesión tmux del puente muerta también;
    - si NO queda ningún proceso `claude` corriendo, se cierran todas;
    - sin actividad por 72 h se poda del registro.
    """

    def __init__(self, tmux: Tmux, salida: "queue.Queue"):
        self.tmux = tmux
        self.salida = salida  # mensajes para el WS
        self.sesiones: dict = {}
        self.enviado_seq: dict = {}   # sid -> último seq mandado
        self.enviado_meta: dict = {}  # sid -> json de meta mandada
        try:
            self.abiertas: dict = json.loads(ABIERTAS_FILE.read_text())
        except Exception:
            self.abiertas = {}         # sid -> iso del último indicio de vida

    def _guardar_abiertas(self):
        try:
            STATE_DIR.mkdir(parents=True, exist_ok=True)
            ABIERTAS_FILE.write_text(json.dumps(self.abiertas, indent=2))
        except Exception:
            pass

    def _marcar_abierta(self, sid: str):
        if sid not in self.abiertas:
            self.abiertas[sid] = ahora_iso()
            self._guardar_abiertas()
        s = self.sesiones.get(sid)
        if s is not None and s.oculta:
            s.oculta = False
            self.enviado_seq[sid] = 0
            self._emitir_delta(s, forzar=True)

    def _cerrar(self, sid: str):
        self.abiertas.pop(sid, None)
        self._guardar_abiertas()
        s = self.sesiones.get(sid)
        if s is not None and not s.oculta:
            s.oculta = True
            self._emitir_delta(s, forzar=True)

    def _hay_procesos_claude(self) -> bool:
        try:
            r = subprocess.run(["/usr/bin/pgrep", "-x", "claude"],
                               capture_output=True, text=True, timeout=5)
            return bool((r.stdout or "").strip())
        except Exception:
            return True  # ante la duda, no cerrar nada

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
                s.pregunta_texto = ""
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
                        # Texto de la 1ra pregunta: la app lo usa para matchear
                        # la pendiente del backend y mostrarla como popup.
                        inp = b.get("input") or {}
                        qs = inp.get("preguntas") or inp.get("questions") or []
                        primera = (qs[0] if qs else inp) or {}
                        s.pregunta_texto = str(primera.get("pregunta")
                                               or primera.get("question")
                                               or inp.get("pregunta") or "")[:300]

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
            mtime = path.stat().st_mtime
            s.ultima_actividad = datetime.fromtimestamp(mtime, timezone.utc).isoformat()
            # Inferir estado al re-leer (tras un restart no hay hooks que lo
            # digan): si lo último es texto de Claude, el turno terminó.
            if (s.mensajes and s.mensajes[-1]["rol"] == "claude"
                    and s.estado not in ("pregunta", "esperando")):
                s.estado = "idle"
                s.turno_inicio = None
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
        hay_claude = self._hay_procesos_claude()
        sids_candidatos = {f.stem for _, _, f in candidatos}
        for mt, proy_nombre, f in candidatos[:MAX_SESIONES]:
            sid = f.stem
            interactiva_viva = bool(self.tmux.interactiva(sid))
            tmux_muerta = sid in self.tmux.registry and not interactiva_viva
            if tmux_muerta and time.time() - mt < 600:
                # El tmux murió pero la sesión SIGUE con actividad: se mudó a
                # otro lado (p.ej. Sebi la retomó en el panel de Antigravity).
                # Desligarla del tmux muerto en vez de darla por cerrada.
                self.tmux.registry.pop(sid, None)
                self.tmux._guardar()
                tmux_muerta = False
            # ¿Está ABIERTA en la Mac? (ver docstring de la clase)
            if tmux_muerta or not hay_claude:
                self.abiertas.pop(sid, None)
            elif time.time() - mt < 600:
                self.abiertas.setdefault(sid, ahora_iso())
            abierta = interactiva_viva or (sid in self.abiertas and not tmux_muerta)
            if not abierta:
                s = self.sesiones.get(sid)
                if s is not None and not s.oculta:
                    s.oculta = True
                    self._emitir_delta(s, forzar=True)
                continue
            vistos.add(sid)
            s = self.sesiones.get(sid)
            if s is None:
                s = Sesion(sid, proy_nombre)
                self.sesiones[sid] = s
            # Volvió a la ventana (p.ej. la Mac durmió y la sesión revivió):
            # sacarle la marca y REMANDAR todo el buffer (el backend la había
            # descartado). Sin esto, una sesión oculta quedaba oculta para
            # siempre aunque tuviera actividad nueva.
            revivida = s.oculta
            if revivida:
                s.oculta = False
                self.enviado_seq[sid] = 0
            cambio = self._leer_incremental(s, f)
            # Sin actividad 15 min = ese turno ya no está corriendo (el
            # transcript se escribe seguido mientras procesa).
            if s.estado in ("procesando", "esperando") and time.time() - mt > 900:
                s.estado = "idle"
                s.turno_inicio = None
                cambio = True
            if cambio or revivida:
                self._emitir_delta(s, forzar=revivida)
        # sesiones que salieron de la ventana → ocultarlas en el backend
        for sid, s in list(self.sesiones.items()):
            if sid not in vistos and not s.oculta:
                s.oculta = True
                self._emitir_delta(s, forzar=True)
        # podar del registro de abiertas lo que ya ni transcript vigente tiene
        muertos = [sid for sid in self.abiertas if sid not in sids_candidatos]
        if muertos:
            for sid in muertos:
                self.abiertas.pop(sid, None)
        self._guardar_abiertas()

    # ---- hooks ----

    def evento_hook(self, ev: dict):
        sid = ev.get("session_id") or ""
        nombre = ev.get("hook_event_name") or ""
        if nombre == "SessionEnd":
            self._cerrar(sid)  # Sebi cerró esa sesión en la Mac → chau del cel
            return
        if sid:
            self._marcar_abierta(sid)  # cualquier otro evento = está viva
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
        """Carpetas candidatas para 'Nueva sesión'. Sin validar con isdir():
        el daemon puede no tener permiso TCC para ver ~/Documents."""
        rutas = {}
        # Primero los cwd reales de las sesiones vivas (vienen del transcript).
        for s in self.sesiones.values():
            if s.cwd:
                rutas[s.cwd] = None
        try:
            for proy in (PROJECTS_DIR.iterdir() if PROJECTS_DIR.is_dir() else []):
                if proy.is_dir():
                    rutas.setdefault(_decodificar_proyecto(proy.name), None)
        except Exception:
            pass
        base = HOME / "Documents" / "Claude"
        rutas.setdefault(str(base), None)
        try:
            for d in sorted(base.iterdir()):
                if d.is_dir() and not d.name.startswith(".") and not d.name.endswith("-sesiones"):
                    rutas.setdefault(str(d), None)
        except Exception:
            pass
        return [{"ruta": r, "nombre": os.path.basename(r) or r} for r in list(rutas)[:30]]


# ----------------------------------------------------------------- hooks HTTP

def armar_http(cola_eventos: "queue.Queue", tmux: "Tmux"):
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
                data = json.loads(body.decode("utf-8", "replace"))
            except Exception:
                data = {}
            if self.path == "/registrar":
                # Lo llama el comando `cs`: registra una sesión tmux creada a
                # mano para que sea interactiva también desde el cel (espejo).
                sid, nombre = data.get("sid"), data.get("tmux")
                if sid and nombre:
                    tmux.registry[sid] = {"tmux": nombre, "cwd": data.get("cwd") or "",
                                          "creada": ahora_iso(), "origen": "cs"}
                    tmux._guardar()
                    log(f"registrada sesión espejo {nombre} ({sid[:8]})")
            else:
                cola_eventos.put(data)
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
    armar_http(cola_eventos, tmux)
    log(f"mac-bridge arrancando (claude={tmux.claude}, tmux={tmux.tmux})")
    asyncio.get_event_loop().run_until_complete(
        loop_ws(token, tracker, salida, cola_eventos, tmux))


if __name__ == "__main__":
    main()
