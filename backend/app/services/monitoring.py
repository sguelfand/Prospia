"""Monitoreo de servicios de la infraestructura.

Corre desde el server de Prospia (el que controlamos de punta a punta) y chequea
periódicamente que todo esté vivo: el webhook de Etiguel + el gateway de Camila
(MyClaw, vía sus endpoints), prospia.app, varen.prospia.app, la base de datos y
las dependencias externas (Monday/Anthropic/Apify).

Las DEFINICIONES de qué se chequea están acá (CHECKS). El estado vivo se persiste
en la tabla service_health para mostrarlo en la app/web y detectar transiciones.
Cuando un servicio crítico pasa de OK a caído, dispara un push (y otro cuando se
recupera). El loop de fondo corre cada `interval_seconds` (config en
monitor_settings, default 300s = 5 min)."""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import requests

from app.core.config import settings

# Cloudflare bloquea requests sin User-Agent de browser (error 1010) al webhook
# de Etiguel. Mandamos uno siempre que peguemos a webhook.etiguel.net.
_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
_ETIGUEL = "https://webhook.etiguel.net"
_SLOW_MS = 5000  # respuesta OK pero lenta → warn

# Códigos HTTP que indican que el problema es el tunnel/Cloudflare (no llegamos
# al origen del container), NO el servicio de adentro: 530 (Argo tunnel error
# 1033) y la familia 520-527 de Cloudflare, más los 502/503/504 de gateway.
# Se usan para no marcar OpenClaw como caído cuando en realidad lo único roto
# es el tunnel (el gateway puede estar perfecto del otro lado).
_TUNNEL_DOWN_CODES = {502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530}

# ── helpers ──────────────────────────────────────────────────────────────────

def _timed_get(url: str, headers: dict | None = None, timeout: int = 8):
    t0 = time.monotonic()
    r = requests.get(url, headers=headers, timeout=timeout)
    return r, int((time.monotonic() - t0) * 1000)


def _http_up(url: str, headers: dict | None = None, expect=(200,), must_contain: str | None = None,
             timeout: int = 8):
    """Check HTTP genérico → (estado, latency_ms, detalle)."""
    try:
        r, ms = _timed_get(url, headers=headers, timeout=timeout)
        if r.status_code not in expect:
            return "down", ms, f"HTTP {r.status_code}"
        if must_contain and must_contain.lower() not in r.text.lower():
            return "down", ms, f"respuesta inesperada (sin '{must_contain}')"
        if ms > _SLOW_MS:
            return "warn", ms, f"lento ({ms}ms)"
        return "up", ms, None
    except Exception as e:
        return "down", None, f"{type(e).__name__}: {e}"


def _reachable(url: str, timeout: int = 8):
    """Para dependencias externas: alcanza con que respondan algo (aunque sea
    401/403). Solo error de conexión/timeout o 5xx cuenta como problema."""
    try:
        r, ms = _timed_get(url, headers={"User-Agent": _UA}, timeout=timeout)
        if r.status_code >= 500:
            return "warn", ms, f"HTTP {r.status_code}"
        return "up", ms, None
    except Exception as e:
        return "down", None, f"{type(e).__name__}: {e}"


# ── checks concretos ───────────────────────────────────────────────────────

def _check_etiguel_webhook():
    """El tunnel Cloudflare + el webhook. Un 530/52x significa que el tunnel
    (cloudflared en el container) está caído y el origen es inalcanzable —
    lo dejamos explícito para distinguirlo de OpenClaw."""
    try:
        r, ms = _timed_get(_ETIGUEL + "/", headers={"User-Agent": _UA})
    except Exception as e:
        return "down", None, f"tunnel/origen inalcanzable: {type(e).__name__}"
    if r.status_code in _TUNNEL_DOWN_CODES:
        return "down", ms, f"tunnel Cloudflare caído (HTTP {r.status_code}, origen inalcanzable)"
    if r.status_code != 200:
        return "down", ms, f"HTTP {r.status_code}"
    if "ok" not in r.text.lower():
        return "down", ms, "respuesta inesperada (sin 'ok')"
    if ms > _SLOW_MS:
        return "warn", ms, f"lento ({ms}ms)"
    return "up", ms, None


def _etiguel_token() -> str:
    """Token del webhook de Etiguel: primero la columna en monitor_settings
    (seteable por SQL sin tocar Coolify), con fallback al env."""
    try:
        from app.models.service_health import MonitorSettings
        from app.database import SessionLocal
        db = SessionLocal()
        try:
            s = db.query(MonitorSettings).filter(MonitorSettings.id == 1).first()
            if s and s.etiguel_deploy_token:
                return s.etiguel_deploy_token
        finally:
            db.close()
    except Exception:
        pass
    return settings.ETIGUEL_DEPLOY_TOKEN or ""


def _check_camila_gateway():
    token = _etiguel_token()
    if not token:
        return "unknown", None, "Token de Etiguel no configurado (monitor_settings / env)"
    # OJO: este check llega a OpenClaw únicamente a través del tunnel de Etiguel
    # (webhook.etiguel.net). Si el tunnel se cae, no podemos verificar el gateway,
    # pero eso NO significa que OpenClaw esté caído — puede estar perfecto del
    # otro lado. En ese caso devolvemos "unknown" (no verificable) en vez de
    # "down", para no disparar un falso "OpenClaw caído" cada vez que el problema
    # real es solo el tunnel. Solo marcamos "down" cuando SÍ llegamos al diag y
    # nos dice que el supervisor/gateway no está reachable.
    try:
        r, ms = _timed_get(_ETIGUEL + "/camila-config/diag",
                           headers={"User-Agent": _UA, "X-Deploy-Token": token})
    except Exception as e:
        return "unknown", None, (f"no verificable (webhook/tunnel inalcanzable, "
                                 f"OpenClaw puede estar OK): {type(e).__name__}")
    if r.status_code in _TUNNEL_DOWN_CODES:
        return "unknown", ms, (f"no verificable (tunnel Cloudflare caído: HTTP "
                               f"{r.status_code}); OpenClaw puede estar OK")
    if r.status_code != 200:
        return "down", ms, f"diag HTTP {r.status_code}"
    try:
        d = r.json()
    except Exception:
        return "down", ms, "diag no devolvió JSON"
    if d.get("supervisor_reachable"):
        estado = "up" if ms <= _SLOW_MS else "warn"
        return estado, ms, (d.get("supervisor_status") or "")[:200]
    return "down", ms, ("gateway no reachable: " + str(d.get("supervisor_status") or ""))[:180]


def _check_prospia_web():
    return _http_up("https://prospia.app/", expect=(200,))


def _check_prospia_api():
    return _http_up("https://prospia.app/api/", must_contain="ok")


def _check_varen_app():
    # La app de Varen tiene login; la raíz devuelve 200 (la página de login).
    return _http_up("https://varen.prospia.app/", expect=(200,))


def _check_database():
    from sqlalchemy import text
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        t0 = time.monotonic()
        db.execute(text("SELECT 1"))
        ms = int((time.monotonic() - t0) * 1000)
        return "up", ms, None
    except Exception as e:
        return "down", None, f"{type(e).__name__}: {e}"
    finally:
        db.close()


def _check_monday():
    return _reachable("https://api.monday.com/v2")


def _check_anthropic():
    return _reachable("https://api.anthropic.com/v1/models")


def _check_apify():
    return _reachable("https://api.apify.com/v2")


# ── salud interna de Camila (/camila-health) ────────────────────────────────
#
# Un solo HTTP a /camila-health del webhook devuelve memoria/contexto/modelo/
# liveness de la sesión de Camila. Lo llamamos UNA vez por corrida (cacheado en
# un dict por los 4 checks que derivan de él) en lugar de pegarle 4 veces.

_camila_health_cache: dict = {}  # {"ts": monotonic, "data": dict|None, "error": str|None}
_CAMILA_HEALTH_TTL = 20  # s — todos los checks de una misma corrida comparten el fetch


def _fetch_camila_health() -> tuple[dict | None, str | None]:
    """Devuelve (data, error). Cachea por _CAMILA_HEALTH_TTL para que los 4
    checks de Camila compartan una sola llamada HTTP por corrida del monitor."""
    now = time.monotonic()
    c = _camila_health_cache
    if c and (now - c.get("ts", 0)) < _CAMILA_HEALTH_TTL:
        return c.get("data"), c.get("error")

    token = _etiguel_token()
    if not token:
        data, err = None, "Token de Etiguel no configurado (monitor_settings / env)"
    else:
        try:
            r, _ms = _timed_get(_ETIGUEL + "/camila-health",
                                headers={"User-Agent": _UA, "X-Deploy-Token": token})
            if r.status_code in _TUNNEL_DOWN_CODES:
                data, err = None, (f"no verificable (tunnel Cloudflare caído: HTTP "
                                   f"{r.status_code}); Camila puede estar OK")
            elif r.status_code != 200:
                data, err = None, f"camila-health HTTP {r.status_code}"
            else:
                try:
                    data, err = r.json(), None
                except Exception:
                    data, err = None, "camila-health no devolvió JSON"
        except Exception as e:
            data, err = None, (f"no verificable (webhook/tunnel inalcanzable, "
                               f"Camila puede estar OK): {type(e).__name__}")

    _camila_health_cache.clear()
    _camila_health_cache.update({"ts": now, "data": data, "error": err})
    return data, err


# Confirmación por tiempo sostenido para camila_responde. La señal de liveness es
# instantánea: un turno pesado puntual genera un stall >15s que la marca mala, pero
# se limpia solo dentro de la ventana de 10 min del gateway → falsa alarma + push
# transitorio. Por eso solo declaramos "down" si la señal mala PERSISTE de forma
# continua >= _RESPONDE_CONFIRM_S; cualquier lectura buena (o no verificable)
# resetea el reloj. Mientras se confirma devolvemos "warn": visible en la UI como
# "verificando" pero SIN push (camila_responde no tiene alerta_warn → warn no alarma).
_RESPONDE_CONFIRM_S = 12 * 60  # 12 min sostenidos antes de declarar caída (≈3 lecturas)
_responde_bad = {"since": None}  # time.monotonic() de la primera lectura mala consecutiva


def _check_camila_responde():
    """liveness.ok==True → up; ==False sostenido >=12min → down (con confirmación,
    para no flapear por un stall puntual); False reciente → warn 'verificando';
    null/no verificable → unknown. Lee señales del gateway, no gasta tokens."""
    data, err = _fetch_camila_health()
    now = time.monotonic()
    if data is None:
        _responde_bad["since"] = None  # no verificable → no podemos confirmar caída
        return "unknown", None, err
    lv = data.get("liveness") or {}
    ok = lv.get("ok")
    detalle = f"stall {round((lv.get('stall_max_ms') or 0) / 1000)}s / stuck {lv.get('stuck', 0)}"
    if lv.get("overflow"):
        detalle += f" / overflow {lv.get('overflow')}"
    if ok is False:
        if _responde_bad["since"] is None:
            _responde_bad["since"] = now
        elapsed = now - _responde_bad["since"]
        mins = round(elapsed / 60)
        if elapsed >= _RESPONDE_CONFIRM_S:
            return "down", None, f"{detalle} (caída sostenida {mins}min)"
        return "warn", None, f"{detalle} (verificando {mins}min, confirma a los 12)"
    # ok True, o unknown/sin datos → resetear el reloj de confirmación
    _responde_bad["since"] = None
    if ok is True:
        return "up", None, None
    return "unknown", None, "liveness sin datos"


def _check_camila_gateway_outbound():
    """¿El webhook PUEDE mandar vía el gateway? (OPENCLAW_GATEWAY_TOKEN presente +
    aceptado). Cubre el hueco silencioso del 25/6: el webhook quedó sin token y
    todo el outbound de Camila quedó mudo sin alerta (el check camila_gateway mira
    el proceso del gateway, no la capacidad de enviar del webhook). Token-free."""
    data, err = _fetch_camila_health()
    if data is None:
        return "unknown", None, err
    g = data.get("gateway_outbound") or {}
    ok = g.get("ok")
    if ok is True:
        return "up", None, g.get("detalle")
    if ok is False:
        return "down", None, g.get("detalle") or "el webhook no puede enviar"
    return "unknown", None, "gateway_outbound sin datos (¿webhook viejo?)"


def _check_camila_memoria():
    """memoria.pct>=85 → warn (avisa antes de quedarse sin RAM y tirar el
    túnel/webhook); <85 → up."""
    data, err = _fetch_camila_health()
    if data is None:
        return "unknown", None, err
    mem = data.get("memoria") or {}
    pct = mem.get("pct")
    if pct is None:
        return "unknown", None, "memoria sin datos"
    detalle = f"{round(pct)}% ({mem.get('used_mb', '?')}/{mem.get('max_mb', '?')} MB)"
    return ("warn" if pct >= 85 else "up"), None, detalle


def _check_camila_contexto():
    """contexto.cargado==True → warn (la conversación acumuló mucho contexto y
    puede dejar de responder); False → up."""
    data, err = _fetch_camila_health()
    if data is None:
        return "unknown", None, err
    ctx = data.get("contexto") or {}
    cargado = ctx.get("cargado")
    if cargado is None:
        return "unknown", None, "contexto sin datos"
    detalle = f"trajectory {ctx.get('trajectory_mb', '?')} MB"
    return ("warn" if cargado else "up"), None, detalle


def _check_camila_modelo():
    """modelo.esperado_ok==True → up; False → down (algo cambió el modelo de
    Camila respecto del esperado)."""
    data, err = _fetch_camila_health()
    if data is None:
        return "unknown", None, err
    mod = data.get("modelo") or {}
    esperado_ok = mod.get("esperado_ok")
    actual = mod.get("actual") or {}
    primary = actual.get("primary") or actual.get("model") or actual.get("name") or "?"
    detalle = str(primary)[:120]
    if esperado_ok is True:
        return "up", None, detalle
    if esperado_ok is False:
        return "down", None, f"modelo inesperado: {detalle}"
    return "unknown", None, "modelo sin datos"


# slug, nombre (= proveedor, para identificar rápido), descripcion (etiqueta corta
# al lado del nombre), tooltip (explicación al pasar el mouse), grupo, critico, fn
CHECKS: list[dict] = [
    {"slug": "etiguel_webhook", "nombre": "Cloudflare", "descripcion": "Webhook Etiguel", "tooltip": "Túnel Cloudflare + webhook de Etiguel. Es la puerta por la que pasan los contactos de Camila; si se cae, Camila queda incomunicada.", "grupo": "Etiguel (MyClaw)", "critico": True, "fn": _check_etiguel_webhook},
    {"slug": "camila_gateway", "nombre": "OpenClaw", "descripcion": "Gateway de Camila", "tooltip": "Gateway de OpenClaw que corre el agente Camila. Si está caído, Camila no atiende WhatsApp.", "grupo": "Etiguel (MyClaw)", "critico": True, "fn": _check_camila_gateway},
    {"slug": "camila_responde", "nombre": "Camila responde", "descripcion": "Liveness", "tooltip": "Verifica que Camila no esté trabada/en loop (lee señales del gateway, sin gastar tokens). Solo marca caído si el problema persiste ~12 min seguidos, para no alarmar por un pico puntual.", "grupo": "Etiguel (MyClaw)", "critico": True, "fn": _check_camila_responde},
    {"slug": "camila_outbound", "nombre": "Camila envía", "descripcion": "Outbound", "tooltip": "Verifica que el webhook pueda MANDAR vía el gateway (token presente y aceptado). Si falla, Camila puede recibir pero no contesta ni inicia contactos — pasó el 25/6 y no avisaba nada.", "grupo": "Etiguel (MyClaw)", "critico": True, "fn": _check_camila_gateway_outbound},
    {"slug": "camila_memoria", "nombre": "Memoria del servidor de Camila", "descripcion": "RAM", "tooltip": "Si se llena, se caen los servicios de Camila (lo que pasó el 25/6: se quedó sin memoria y tiró el túnel y el webhook). Avisa antes.", "grupo": "Etiguel (MyClaw)", "critico": True, "alerta_warn": True, "fn": _check_camila_memoria},
    {"slug": "camila_contexto", "nombre": "Contexto de Camila", "descripcion": "Conversación", "tooltip": "Cuánto contexto acumuló la conversación de Camila. Si se llena, deja de responder. Avisa antes de que reviente.", "grupo": "Etiguel (MyClaw)", "critico": True, "alerta_warn": True, "fn": _check_camila_contexto},
    {"slug": "camila_modelo", "nombre": "Modelo de Camila", "descripcion": "Modelo IA", "tooltip": "Verifica que Camila siga en su modelo correcto (sonnet-4.6 + fallbacks). Si algo lo cambia, se avisa.", "grupo": "Etiguel (MyClaw)", "critico": True, "fn": _check_camila_modelo},
    {"slug": "prospia_web", "nombre": "Coolify", "descripcion": "prospia.app (web)", "tooltip": "La web de Prospia (prospia.app) que ves en el navegador. Servida por Coolify en el server de Hetzner.", "grupo": "Prospia (Hetzner)", "critico": True, "fn": _check_prospia_web},
    {"slug": "prospia_api", "nombre": "Coolify", "descripcion": "API Prospia", "tooltip": "La API del backend de Prospia. Si se cae, la web y la app móvil dejan de funcionar.", "grupo": "Prospia (Hetzner)", "critico": True, "fn": _check_prospia_api},
    {"slug": "varen_app", "nombre": "Coolify", "descripcion": "varen.prospia.app", "tooltip": "La app interna de Varen Home (varen.prospia.app), corre en el mismo server de Prospia.", "grupo": "Prospia (Hetzner)", "critico": True, "fn": _check_varen_app},
    {"slug": "database", "nombre": "PostgreSQL", "descripcion": "Base de datos", "tooltip": "La base de datos PostgreSQL de Prospia: guarda prospects, contactos, pendientes y todo el estado. Si se cae, no anda nada.", "grupo": "Prospia (Hetzner)", "critico": True, "fn": _check_database},
    {"slug": "monday", "nombre": "Monday", "descripcion": "API de leads", "tooltip": "API de Monday.com, donde Etiguel lleva los leads y prospects. Si no responde, no se cargan ni actualizan leads.", "grupo": "Externos", "critico": False, "fn": _check_monday},
    {"slug": "anthropic", "nombre": "Anthropic", "descripcion": "Modelo de Camila", "tooltip": "API de Anthropic (Claude), el cerebro de Camila. Si está caída, Camila no puede pensar las respuestas.", "grupo": "Externos", "critico": False, "fn": _check_anthropic},
    {"slug": "apify", "nombre": "Apify", "descripcion": "Scraping", "tooltip": "API de Apify, que usa el scraper para juntar prospects. Si se cae, no se consiguen contactos nuevos.", "grupo": "Externos", "critico": False, "fn": _check_apify},
]
_BY_SLUG = {c["slug"]: c for c in CHECKS}


# ── persistencia + transiciones ──────────────────────────────────────────────

def _ensure_rows(db):
    """Crea filas placeholder (estado unknown) para los servicios del registro que
    todavía no existan, así la UI los lista desde el primer momento."""
    from app.models.service_health import ServiceHealth
    existentes = {s.slug for s in db.query(ServiceHealth).all()}
    cambios = False
    for i, c in enumerate(CHECKS):
        if c["slug"] not in existentes:
            db.add(ServiceHealth(slug=c["slug"], nombre=c["nombre"], grupo=c["grupo"],
                                 critico=c["critico"], orden=i, estado="unknown"))
            cambios = True
    if cambios:
        db.commit()


def _persist_and_alert(results: list[tuple]):
    """results = [(entry, estado, latency_ms, detalle), ...]. Upserta el estado,
    detecta transiciones y arma los push a mandar."""
    from app.models.service_health import ServiceHealth
    from app.services import push

    ahora = datetime.now(timezone.utc)
    alertas: list[tuple[str, str]] = []  # (evento, mensaje)
    db = None
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        for entry, estado, ms, detalle in results:
            row = db.query(ServiceHealth).filter(ServiceHealth.slug == entry["slug"]).first()
            if not row:
                row = ServiceHealth(slug=entry["slug"], orden=0)
                db.add(row)
                prev = "unknown"
            else:
                prev = row.estado
            # metadata (por si cambió el registro)
            row.nombre, row.grupo, row.critico = entry["nombre"], entry["grupo"], entry["critico"]
            row.last_check = ahora
            row.latency_ms = ms
            row.detalle = detalle
            if estado != prev:
                row.since = ahora
            if estado == "up":
                row.last_ok = ahora
            row.estado = estado

            # Transiciones que disparan push (solo servicios críticos).
            # Por defecto solo down↔up alerta (un "warn" = lento no molesta).
            # Algunos checks (memoria/contexto de Camila) usan `warn` como su
            # estado de aviso real ("avisar antes de reventar"): para esos,
            # marcados con alerta_warn=True, un warn cuenta como caída.
            if entry["critico"]:
                alerta_warn = entry.get("alerta_warn", False)
                malo = ("down", "warn") if alerta_warn else ("down",)
                ahora_malo = estado in malo
                antes_malo = prev in malo
                if ahora_malo and not antes_malo and prev != "unknown":
                    # Un warn en checks alerta_warn (memoria/contexto) NO es una
                    # caída: es un aviso preventivo ("pesado", "se está llenando").
                    # Sólo un down real es "caído" — no confundir a Sebi.
                    if estado == "warn":
                        msg = f"🟡 {entry['nombre']}: atención"
                        if detalle:
                            msg += f" ({detalle})"
                    else:
                        msg = f"🔴 {entry['nombre']} caído"
                    alertas.append(("servicio_caido", msg))
                elif estado == "up" and antes_malo:
                    # Si venía de warn (alerta_warn) "normalizó"; de down real "se recuperó".
                    verbo = "normalizó" if prev == "warn" else "se recuperó"
                    alertas.append(("servicio_recuperado",
                                    f"🟢 {entry['nombre']} {verbo}"))
        db.commit()
    finally:
        if db:
            db.close()

    # Mandar pushes después de commitear (best-effort). nav → Monitoreo → Servicios.
    for evento, title in alertas:
        try:
            push.notificar_global(evento, title, title, {"nav": "monitoreo_servicios"})
        except Exception as e:
            print(f"[MONITOR] no se pudo notificar {evento}: {type(e).__name__}: {e}")


def run_all() -> dict:
    """Corre todos los checks (en paralelo), persiste y devuelve el estado."""
    def _run(entry):
        try:
            estado, ms, detalle = entry["fn"]()
        except Exception as e:
            estado, ms, detalle = "down", None, f"{type(e).__name__}: {e}"
        return (entry, estado, ms, detalle)

    with ThreadPoolExecutor(max_workers=min(8, len(CHECKS))) as ex:
        results = list(ex.map(_run, CHECKS))
    _persist_and_alert(results)
    return get_status()


def run_one(slug: str) -> dict | None:
    """Corre un solo check y devuelve su estado (o None si el slug no existe)."""
    entry = _BY_SLUG.get(slug)
    if not entry:
        return None
    try:
        estado, ms, detalle = entry["fn"]()
    except Exception as e:
        estado, ms, detalle = "down", None, f"{type(e).__name__}: {e}"
    _persist_and_alert([(entry, estado, ms, detalle)])
    return get_service(slug)


# ── lectura / settings ───────────────────────────────────────────────────────

def _service_dict(row) -> dict:
    entry = _BY_SLUG.get(row.slug, {})
    return {
        "slug": row.slug,
        "nombre": row.nombre,
        "descripcion": entry.get("descripcion"),
        "tooltip": entry.get("tooltip"),
        "grupo": row.grupo,
        "estado": row.estado,
        "last_check": row.last_check,
        "last_ok": row.last_ok,
        "since": row.since,
        "latency_ms": row.latency_ms,
        "detalle": row.detalle,
        "critico": row.critico,
    }


def _get_interval(db) -> int:
    from app.models.service_health import MonitorSettings
    s = db.query(MonitorSettings).filter(MonitorSettings.id == 1).first()
    if not s:
        s = MonitorSettings(id=1, interval_seconds=300)
        db.add(s)
        db.commit()
    return s.interval_seconds


def get_status() -> dict:
    from app.models.service_health import ServiceHealth
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        _ensure_rows(db)
        rows = db.query(ServiceHealth).order_by(ServiceHealth.orden, ServiceHealth.id).all()
        servicios = [_service_dict(r) for r in rows]
        interval = _get_interval(db)
        last_run = max((r.last_check for r in rows if r.last_check), default=None)
        resumen = {
            "up": sum(1 for r in rows if r.estado == "up"),
            "down": sum(1 for r in rows if r.estado == "down"),
            "warn": sum(1 for r in rows if r.estado == "warn"),
            "unknown": sum(1 for r in rows if r.estado == "unknown"),
            "total": len(rows),
        }
        return {"servicios": servicios, "interval_seconds": interval,
                "last_run": last_run, "resumen": resumen}
    finally:
        db.close()


def get_service(slug: str) -> dict | None:
    from app.models.service_health import ServiceHealth
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        row = db.query(ServiceHealth).filter(ServiceHealth.slug == slug).first()
        return _service_dict(row) if row else None
    finally:
        db.close()


def set_interval(seconds: int) -> dict:
    from app.models.service_health import MonitorSettings
    from app.database import SessionLocal
    seconds = max(60, min(3600, int(seconds)))  # entre 1 min y 1 hora
    db = SessionLocal()
    try:
        s = db.query(MonitorSettings).filter(MonitorSettings.id == 1).first()
        if not s:
            s = MonitorSettings(id=1)
            db.add(s)
        s.interval_seconds = seconds
        s.updated_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()
    return get_status()


# ── loop de fondo ─────────────────────────────────────────────────────────────

def start():
    def loop():
        time.sleep(45)  # espera inicial al arrancar
        while True:
            try:
                run_all()
            except Exception as e:
                print(f"[MONITOR ERROR] {type(e).__name__}: {e}")
            # releer el intervalo cada vuelta (puede cambiar desde la UI)
            try:
                from app.database import SessionLocal
                db = SessionLocal()
                try:
                    interval = _get_interval(db)
                finally:
                    db.close()
            except Exception:
                interval = 300
            time.sleep(interval)

    threading.Thread(target=loop, daemon=True, name="monitoring-job").start()
