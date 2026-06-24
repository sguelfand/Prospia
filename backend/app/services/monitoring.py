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


# slug, nombre (= proveedor, para identificar rápido), descripcion (al lado), grupo, critico, fn
CHECKS: list[dict] = [
    {"slug": "etiguel_webhook", "nombre": "Cloudflare", "descripcion": "Webhook Etiguel", "grupo": "Etiguel (MyClaw)", "critico": True, "fn": _check_etiguel_webhook},
    {"slug": "camila_gateway", "nombre": "OpenClaw", "descripcion": "Gateway de Camila", "grupo": "Etiguel (MyClaw)", "critico": True, "fn": _check_camila_gateway},
    {"slug": "prospia_web", "nombre": "Coolify", "descripcion": "prospia.app (web)", "grupo": "Prospia (Hetzner)", "critico": True, "fn": _check_prospia_web},
    {"slug": "prospia_api", "nombre": "Coolify", "descripcion": "API Prospia", "grupo": "Prospia (Hetzner)", "critico": True, "fn": _check_prospia_api},
    {"slug": "varen_app", "nombre": "Coolify", "descripcion": "varen.prospia.app", "grupo": "Prospia (Hetzner)", "critico": True, "fn": _check_varen_app},
    {"slug": "database", "nombre": "PostgreSQL", "descripcion": "Base de datos", "grupo": "Prospia (Hetzner)", "critico": True, "fn": _check_database},
    {"slug": "monday", "nombre": "Monday", "descripcion": "API de leads", "grupo": "Externos", "critico": False, "fn": _check_monday},
    {"slug": "anthropic", "nombre": "Anthropic", "descripcion": "Modelo de Camila", "grupo": "Externos", "critico": False, "fn": _check_anthropic},
    {"slug": "apify", "nombre": "Apify", "descripcion": "Scraping", "grupo": "Externos", "critico": False, "fn": _check_apify},
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

            # Transiciones que disparan push (solo servicios críticos)
            if entry["critico"]:
                if estado == "down" and prev in ("up", "warn"):
                    alertas.append(("servicio_caido",
                                    f"🔴 {entry['nombre']} caído"))
                elif estado == "up" and prev == "down":
                    alertas.append(("servicio_recuperado",
                                    f"🟢 {entry['nombre']} se recuperó"))
        db.commit()
    finally:
        if db:
            db.close()

    # Mandar pushes después de commitear (best-effort)
    for evento, title in alertas:
        try:
            push.notificar_global(evento, title, title)
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
