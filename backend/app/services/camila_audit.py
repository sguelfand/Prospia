"""Auditor diario de consumo de Camila (tokens/costo/errores + oportunidades).

Corre en el backend de Prospia (que controlamos) y lee las trajectories de
OpenClaw de cada cliente vía sus endpoints /fs. Parsea los eventos
`model.completed` (que traen `usage`, modelo, timeouts/errores), agrega el
consumo del día, estima el costo y detecta oportunidades de mejora por REGLAS
(timeouts, fallback a modelo caro, caché ineficiente, compactaciones,
conversaciones caras, gasto del agente `main` sin uso). Cuando hay
oportunidades, manda un push para que Sebi entre a revisarlas. NO auto-aplica
nada: las soluciones se charlan.

Multi-cliente: `SOURCES` mapea cada cliente a su gateway. Hoy solo 'etiguel';
los próximos clientes se suman como una entrada más (su base + token)."""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timedelta, timezone

import requests

_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
_BA = timezone(timedelta(hours=-3))  # Buenos Aires

# Precios estimados USD por TOKEN (Anthropic ref; myclaw puede facturar distinto
# → el costo es una ESTIMACIÓN). [input, output, cacheRead, cacheWrite]
_PRICES = {
    "claude-sonnet-4.6": (3e-6, 15e-6, 0.3e-6, 3.75e-6),
    "claude-opus-4.6":   (15e-6, 75e-6, 1.5e-6, 18.75e-6),
    "claude-haiku":      (0.8e-6, 4e-6, 0.08e-6, 1e-6),
}
_PRICE_DEFAULT = _PRICES["claude-sonnet-4.6"]


def _price_for(model_id: str):
    m = (model_id or "").lower()
    if "opus" in m:
        return _PRICES["claude-opus-4.6"]
    if "haiku" in m:
        return _PRICES["claude-haiku"]
    if "sonnet" in m:
        return _PRICES["claude-sonnet-4.6"]
    return _PRICE_DEFAULT


def _etiguel_token() -> str:
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
    from app.core.config import settings
    return settings.ETIGUEL_DEPLOY_TOKEN or ""


# Cada source: cómo alcanzar las trajectories de ese cliente.
# fetch headers/base por cliente; agentes a auditar dentro del container.
SOURCES: dict[str, dict] = {
    "etiguel": {
        "nombre": "Etiguel (Camila)",
        "base": "https://webhook.etiguel.net",
        "token_fn": _etiguel_token,
        "agentes": ["etiguel", "main"],
    },
}


# ── recolección de eventos del día ───────────────────────────────────────────

def _fs_get(base: str, token: str, path: str, max_bytes: int = 10_000_000):
    if path.startswith("LIST:"):
        r = requests.get(f"{base}/fs/list", params={"path": path[5:]},
                         headers={"User-Agent": _UA, "X-Deploy-Token": token}, timeout=20)
    else:
        r = requests.get(f"{base}/fs/read", params={"path": path, "max_bytes": max_bytes},
                         headers={"User-Agent": _UA, "X-Deploy-Token": token}, timeout=30)
    r.raise_for_status()
    return r.json()


def _collect_events(source: str, fecha: str) -> list[dict]:
    """Devuelve los eventos model.completed cuyo ts cae en `fecha` (YYYY-MM-DD BA),
    de todos los agentes del source. Cada item: {agente, sesion, ts, modelId, data}."""
    cfg = SOURCES[source]
    base, token = cfg["base"], cfg["token_fn"]()
    if not token:
        raise RuntimeError("token del source no configurado")
    # ventana del día en UTC (los ts de las trajectories son UTC/Z)
    day_start = datetime.strptime(fecha, "%Y-%m-%d").replace(tzinfo=_BA)
    day_end = day_start + timedelta(days=1)
    eventos: list[dict] = []
    for agente in cfg["agentes"]:
        sdir = f".openclaw/agents/{agente}/sessions"
        try:
            listing = _fs_get(base, token, "LIST:" + sdir)
        except Exception:
            continue
        for e in listing.get("entries", []):
            name = e.get("name", "")
            if not name.endswith(".trajectory.jsonl"):
                continue
            # Solo archivos tocados desde el inicio del día (tienen eventos del día)
            mt = e.get("mtime") or ""
            try:
                if mt and datetime.fromisoformat(mt.replace("Z", "+00:00")) < day_start - timedelta(hours=1):
                    continue
            except Exception:
                pass
            try:
                doc = _fs_get(base, token, f"{sdir}/{name}")
                content = doc.get("content", "")
            except Exception:
                continue
            sesion = name.replace(".trajectory.jsonl", "")
            for line in content.splitlines():
                line = line.strip()
                if not line or '"model.completed"' not in line:
                    continue
                try:
                    o = json.loads(line)
                except Exception:
                    continue
                if o.get("type") != "model.completed":
                    continue
                ts = o.get("ts") or ""
                try:
                    tsd = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                except Exception:
                    continue
                if tsd.tzinfo is None:
                    tsd = tsd.replace(tzinfo=timezone.utc)
                # day_start/day_end son BA-aware; la comparación cross-tz es correcta
                if not (day_start <= tsd < day_end):
                    continue
                eventos.append({
                    "agente": agente, "sesion": sesion, "ts": ts,
                    "modelId": o.get("modelId"), "data": o.get("data") or {},
                })
    return eventos


# ── agregación + costo + oportunidades ───────────────────────────────────────

def _usage_cost(model_id: str, u: dict) -> float:
    pi, po, pcr, pcw = _price_for(model_id)
    return (u.get("input", 0) * pi + u.get("output", 0) * po
            + u.get("cacheRead", 0) * pcr + u.get("cacheWrite", 0) * pcw)


def _aggregate(source: str, fecha: str, eventos: list[dict]) -> dict:
    tot = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0,
           "llamadas": 0, "costo_usd": 0.0, "errores": 0, "timeouts": 0, "compactaciones": 0}
    por_agente: dict[str, dict] = {}
    por_modelo: dict[str, dict] = {}
    por_sesion: dict[str, dict] = {}

    for ev in eventos:
        d = ev["data"]
        u = d.get("usage") or {}
        model = ev["modelId"] or "?"
        costo = _usage_cost(model, u)
        timed_out = bool(d.get("timedOut") or d.get("idleTimedOut") or d.get("timedOutDuringCompaction"))
        error = d.get("promptErrorSource") is not None
        comp = int(d.get("compactionCount") or 0)

        tot["input"] += u.get("input", 0); tot["output"] += u.get("output", 0)
        tot["cacheRead"] += u.get("cacheRead", 0); tot["cacheWrite"] += u.get("cacheWrite", 0)
        tot["total"] += u.get("total", 0); tot["llamadas"] += 1
        tot["costo_usd"] += costo
        tot["errores"] += 1 if error else 0
        tot["timeouts"] += 1 if timed_out else 0
        tot["compactaciones"] += comp

        a = por_agente.setdefault(ev["agente"], {"tokens": 0, "costo_usd": 0.0, "llamadas": 0})
        a["tokens"] += u.get("total", 0); a["costo_usd"] += costo; a["llamadas"] += 1
        m = por_modelo.setdefault(model, {"tokens": 0, "costo_usd": 0.0, "llamadas": 0})
        m["tokens"] += u.get("total", 0); m["costo_usd"] += costo; m["llamadas"] += 1

        s = por_sesion.setdefault(ev["sesion"], {
            "sesion": ev["sesion"], "agente": ev["agente"], "tokens": 0, "costo_usd": 0.0,
            "llamadas": 0, "timeouts": 0, "errores": 0, "ejemplo": None})
        s["tokens"] += u.get("total", 0); s["costo_usd"] += costo; s["llamadas"] += 1
        s["timeouts"] += 1 if timed_out else 0; s["errores"] += 1 if error else 0
        if not s["ejemplo"]:
            txt = (d.get("finalPromptText") or "").strip().replace("\n", " ")
            if txt:
                s["ejemplo"] = txt[:120]

    top = sorted(por_sesion.values(), key=lambda x: x["costo_usd"], reverse=True)[:10]
    oportunidades = _detectar_oportunidades(tot, por_modelo, por_agente, por_sesion)

    return {
        "source": source, "fecha": fecha,
        "totales": tot,
        "por_agente": por_agente,
        "por_modelo": por_modelo,
        "top_conversaciones": top,
        "oportunidades": oportunidades,
    }


def _detectar_oportunidades(tot, por_modelo, por_agente, por_sesion) -> list[dict]:
    ops: list[dict] = []
    if tot["timeouts"] > 0:
        ops.append({"tipo": "timeouts", "severidad": "alta",
                    "titulo": f"{tot['timeouts']} llamada(s) con timeout/idle",
                    "detalle": "Gastaron tokens sin producir respuesta útil. Revisar modelo/fallbacks/timeout del provider."})
    if tot["errores"] > 0:
        ops.append({"tipo": "errores", "severidad": "alta",
                    "titulo": f"{tot['errores']} llamada(s) con error",
                    "detalle": "Llamadas que fallaron (promptErrorSource). Revisar causa para no re-gastar."})
    # Fallback a modelo caro
    caros = {m: v for m, v in por_modelo.items() if ("opus" in m.lower() or "gpt" in m.lower())}
    if caros:
        n = sum(v["llamadas"] for v in caros.values())
        costo = sum(v["costo_usd"] for v in caros.values())
        ops.append({"tipo": "modelo_caro", "severidad": "media",
                    "titulo": f"{n} llamada(s) en modelo caro (fallback)",
                    "detalle": f"Modelos: {', '.join(caros)}. ~${costo:.2f}. Si el primario falla seguido, conviene revisar por qué cae al fallback."})
    # Caché ineficiente: se reescribe más de lo que se lee
    if tot["cacheWrite"] > max(tot["cacheRead"], 1) * 0.8 and tot["cacheWrite"] > 100_000:
        ops.append({"tipo": "cache", "severidad": "media",
                    "titulo": "Caché ineficiente (mucho cacheWrite)",
                    "detalle": f"cacheWrite={tot['cacheWrite']:,} vs cacheRead={tot['cacheRead']:,}. El prompt/contexto cambia mucho entre llamadas → se reescribe la caché en vez de reusarla."})
    if tot["compactaciones"] > 2:
        ops.append({"tipo": "compactacion", "severidad": "media",
                    "titulo": f"{tot['compactaciones']} compactaciones de contexto",
                    "detalle": "El contexto crece y se compacta seguido (caro). Revisar reset de sesión / tamaño del system prompt."})
    # Gasto del agente main (system/cron) sin interacción de cliente
    main = por_agente.get("main")
    if main and main["costo_usd"] >= 0.20:
        ops.append({"tipo": "main_sin_uso", "severidad": "media",
                    "titulo": f"agent:main consumió ~${main['costo_usd']:.2f} (sistema, sin cliente)",
                    "detalle": f"{main['llamadas']} llamadas del agente interno (crons/heartbeat/mantenimiento). Revisar si hay tareas LLM evitables."})
    # Conversación cara (muy por encima del promedio del día)
    sesiones = [s for s in por_sesion.values() if s["agente"] != "main"]
    if sesiones:
        prom = sum(s["costo_usd"] for s in sesiones) / len(sesiones)
        cara = max(sesiones, key=lambda s: s["costo_usd"])
        if cara["costo_usd"] > max(prom * 3, 0.30):
            ops.append({"tipo": "conversacion_cara", "severidad": "baja",
                        "titulo": f"Conversación cara: ~${cara['costo_usd']:.2f}",
                        "detalle": f"{cara['llamadas']} llamadas. {('“' + cara['ejemplo'] + '”') if cara['ejemplo'] else ''}",
                        "sesion": cara["sesion"]})
    return ops


# ── persistencia + push ──────────────────────────────────────────────────────

def run_audit(source: str, fecha: str, notify: bool = True) -> dict:
    """Computa la auditoría de `source` para `fecha` (YYYY-MM-DD BA), la persiste
    y (si notify) manda push si hay oportunidades nuevas. Devuelve el resumen."""
    if source not in SOURCES:
        raise ValueError(f"source desconocido: {source}")
    eventos = _collect_events(source, fecha)
    resumen = _aggregate(source, fecha, eventos)

    from app.models.camila_audit import CamilaAudit
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        row = db.query(CamilaAudit).filter(
            CamilaAudit.source == source, CamilaAudit.fecha == fecha).first()
        ops_antes = 0
        if row:
            try:
                ops_antes = len(json.loads(row.data).get("oportunidades", []))
            except Exception:
                ops_antes = 0
        else:
            row = CamilaAudit(source=source, fecha=fecha)
            db.add(row)
        tot = resumen["totales"]
        row.total_tokens = tot["total"]
        row.costo_usd = round(tot["costo_usd"], 4)
        row.llamadas = tot["llamadas"]
        row.errores = tot["errores"]
        row.oportunidades = len(resumen["oportunidades"])
        row.data = json.dumps(resumen, ensure_ascii=False)
        row.generated_at = datetime.now(timezone.utc)
        db.commit()
        nuevas = row.oportunidades > ops_antes
    finally:
        db.close()

    if notify and resumen["oportunidades"] and nuevas:
        try:
            from app.services import push
            nombre = SOURCES[source]["nombre"]
            n = len(resumen["oportunidades"])
            altas = sum(1 for o in resumen["oportunidades"] if o.get("severidad") == "alta")
            push.notificar_global(
                "tokens_oportunidad",
                f"💡 {nombre}: {n} oportunidad(es) de mejora",
                f"{fecha} · ~${tot['costo_usd']:.2f} · {altas} de prioridad alta. Entrá a Monitoreo → Tokens.",
                {"tipo": "tokens", "source": source, "fecha": fecha},
            )
        except Exception as e:
            print(f"[CAMILA-AUDIT] no se pudo notificar: {type(e).__name__}: {e}")
    return resumen


# ── lectura ──────────────────────────────────────────────────────────────────

def get_sources() -> list[dict]:
    return [{"id": k, "nombre": v["nombre"]} for k, v in SOURCES.items()]


def get_audits(source: str, days: int = 14) -> dict:
    """Devuelve la última auditoría (detalle completo) + la tendencia de los
    últimos `days` días (para el gráfico)."""
    from app.models.camila_audit import CamilaAudit
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        rows = (db.query(CamilaAudit).filter(CamilaAudit.source == source)
                .order_by(CamilaAudit.fecha.desc()).limit(max(1, days)).all())
        tendencia = [{"fecha": r.fecha, "costo_usd": r.costo_usd, "total_tokens": r.total_tokens,
                      "errores": r.errores, "oportunidades": r.oportunidades}
                     for r in reversed(rows)]
        ultimo = None
        if rows:
            try:
                ultimo = json.loads(rows[0].data)
            except Exception:
                ultimo = None
        return {"source": source, "ultimo": ultimo, "tendencia": tendencia}
    finally:
        db.close()


# ── loop diario ───────────────────────────────────────────────────────────────

def _hoy_ba() -> str:
    return datetime.now(_BA).strftime("%Y-%m-%d")


def _ayer_ba() -> str:
    return (datetime.now(_BA) - timedelta(days=1)).strftime("%Y-%m-%d")


def start():
    """Una corrida diaria: audita el día completo anterior (y refresca el día en
    curso) para cada source. Best-effort; los errores no tumban el loop."""
    def loop():
        time.sleep(120)  # espera inicial
        last_day = None
        while True:
            hoy = _hoy_ba()
            try:
                for source in SOURCES:
                    # refresca el día en curso (sin push para no spamear)
                    try:
                        run_audit(source, hoy, notify=False)
                    except Exception as e:
                        print(f"[CAMILA-AUDIT] {source} hoy: {type(e).__name__}: {e}")
                    # al cambiar de día, cierra el día anterior CON push
                    if last_day != hoy:
                        try:
                            run_audit(source, _ayer_ba(), notify=True)
                        except Exception as e:
                            print(f"[CAMILA-AUDIT] {source} ayer: {type(e).__name__}: {e}")
                last_day = hoy
            except Exception as e:
                print(f"[CAMILA-AUDIT ERROR] {type(e).__name__}: {e}")
            time.sleep(6 * 3600)  # cada 6h (refresca el día en curso; cierra ayer 1 vez)

    threading.Thread(target=loop, daemon=True, name="camila-audit").start()
