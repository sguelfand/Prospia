"""Auditor de consumo de Camila — por CONVERSACIÓN (teléfono).

Corre en el backend de Prospia. Lee las trajectories de OpenClaw vía /fs, parsea
los `model.completed` (traen `usage` con tokens reales + el teléfono de la charla
en el runtime-context) y agrega el consumo **por número de teléfono** (conversación),
por modelo y por día/mes. El costo es el REAL que paga Sebi = tokens × rate-card
MyClaw (10% off oficial; el jsonl reporta cost 0 porque el provider myclaw está en 0).

- Oportunidades de mejora: FIJAS (tabla camila_oportunidad). Se acumulan y quedan
  abiertas hasta que se marcan resueltas; NO cambian en cada recálculo.
- Daily: costo partido en mensajes vs errores (para barras apiladas).
- Mensual: rollup por mes (gráfico histórico) + por_modelo del mes actual.
- Multi-cliente: SOURCES (hoy 'etiguel'; extensible)."""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime, timedelta, timezone

import requests

_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
_BA = timezone(timedelta(hours=-3))

# Precio REAL USD/token [input, output, cacheRead, cacheWrite] = rate-card MyClaw
# (10% off el oficial; lo que Sebi efectivamente paga). El jsonl reporta cost 0
# porque el provider myclaw está configurado en 0. Tabla en memoria
# reference_myclaw_pricing. ($/M) / 1e6:
_PRICES = {
    "sonnet": (2.70e-6, 13.50e-6, 0.27e-6, 3.38e-6),   # sonnet 4.6 / 4.5
    "opus":   (4.50e-6, 22.50e-6, 0.45e-6, 5.63e-6),   # opus 4.5 / 4.6 / 4.7 / 4.8
    "gpt":    (2.25e-6, 13.50e-6, 0.23e-6, 0.0),        # gpt-5.4 (sin cache write)
    "haiku":  (0.90e-6,  4.50e-6, 0.90e-6, 1.13e-6),   # ⚠️ cacheRead haiku NO descontado
}
_PRICE_DEFAULT = _PRICES["sonnet"]


def _price_for(model_id: str):
    m = (model_id or "").lower()
    if "opus" in m:
        return _PRICES["opus"]
    if "haiku" in m:
        return _PRICES["haiku"]
    if "gpt" in m:
        return _PRICES["gpt"]
    return _PRICE_DEFAULT


def _usage_cost(model_id: str, u: dict) -> float:
    pi, po, pcr, pcw = _price_for(model_id)
    return (u.get("input", 0) * pi + u.get("output", 0) * po
            + u.get("cacheRead", 0) * pcr + u.get("cacheWrite", 0) * pcw)


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


SOURCES: dict[str, dict] = {
    "etiguel": {
        "nombre": "Etiguel (Camila)",
        "base": "https://webhook.etiguel.net",
        "token_fn": _etiguel_token,
        "agentes": ["etiguel", "main"],
    },
}

_PHONE_RE = re.compile(r'"(?:chat_id|sender_id)"\s*:\s*"([^"]+)"')
# Outbound de primer contacto: el número va en ENVIAR_LEAD|num|... / ENVIAR_PROSPECCION|num|...
# (en un lead recién contactado todavía no hay mensaje entrante con chat_id).
_ENVIAR_RE = re.compile(r'ENVIAR_(?:LEAD|PROSPECCION)\|(\+?\d{8,15})\|')


def _norm_phone(p: str | None) -> str | None:
    """Normaliza a '+<dígitos>' para unificar chat_id (+549...) con el num de
    ENVIAR_LEAD (549...) → la misma conversación no se parte en dos."""
    if not p:
        return None
    digits = re.sub(r"\D", "", p)
    return ("+" + digits) if digits else None


def _extract_phone(mc: dict) -> str | None:
    snaps = mc.get("data", {}).get("messagesSnapshot", [])
    # 1) chat_id / sender_id (mensajes entrantes)
    for m in snaps:
        if not isinstance(m, dict):
            continue
        c = m.get("content")
        txt = c if isinstance(c, str) else json.dumps(c, ensure_ascii=False)
        hit = _PHONE_RE.search(txt)
        if hit:
            return _norm_phone(hit.group(1))
    # 2) outbound de primer contacto (ENVIAR_LEAD|num| / ENVIAR_PROSPECCION|num|)
    for m in snaps:
        if not isinstance(m, dict):
            continue
        c = m.get("content")
        txt = c if isinstance(c, str) else json.dumps(c, ensure_ascii=False)
        hit = _ENVIAR_RE.search(txt)
        if hit:
            return _norm_phone(hit.group(1))
    return None


# ── recolección ──────────────────────────────────────────────────────────────

def _fs_list(base, token, path):
    r = requests.get(f"{base}/fs/list", params={"path": path},
                     headers={"User-Agent": _UA, "X-Deploy-Token": token}, timeout=20)
    r.raise_for_status()
    return r.json()


def _fs_read(base, token, path, max_bytes=10_000_000):
    r = requests.get(f"{base}/fs/read", params={"path": path, "max_bytes": max_bytes},
                     headers={"User-Agent": _UA, "X-Deploy-Token": token}, timeout=40)
    r.raise_for_status()
    return r.json()


def _iter_model_events(content: str, agente: str, sesion: str):
    """Itera por cada model.completed de una trajectory, con teléfono adjunto."""
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
        yield {
            "agente": agente, "sesion": sesion, "ts": tsd,
            "modelId": o.get("modelId"), "data": o.get("data") or {},
            "telefono": _extract_phone(o),
        }


def _collect_events(source: str, since: datetime):
    """Eventos model.completed de todos los agentes con ts >= since. Lee cada
    trajectory tocada desde `since` una sola vez."""
    cfg = SOURCES[source]
    base, token = cfg["base"], cfg["token_fn"]()
    if not token:
        raise RuntimeError("token del source no configurado")
    eventos = []
    for agente in cfg["agentes"]:
        sdir = f".openclaw/agents/{agente}/sessions"
        try:
            listing = _fs_list(base, token, sdir)
        except Exception:
            continue
        for e in listing.get("entries", []):
            if not e.get("name", "").endswith(".trajectory.jsonl"):
                continue
            mt = e.get("mtime") or ""
            try:
                if mt and datetime.fromisoformat(mt.replace("Z", "+00:00")) < since - timedelta(hours=2):
                    continue
            except Exception:
                pass
            try:
                doc = _fs_read(base, token, f"{sdir}/{e['name']}")
            except Exception:
                continue
            sesion = e["name"].replace(".trajectory.jsonl", "")
            for ev in _iter_model_events(doc.get("content", ""), agente, sesion):
                if ev["ts"] >= since:
                    eventos.append(ev)
    return eventos


# ── agregación ───────────────────────────────────────────────────────────────

def _blank_tot():
    return {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0,
            "llamadas": 0, "costo_usd": 0.0, "costo_mensajes": 0.0, "costo_errores": 0.0,
            "errores": 0, "timeouts": 0, "compactaciones": 0}


def _new_acc():
    return {"totales": _blank_tot(), "por_modelo": {}, "por_conversacion": {}}


def _fold(acc: dict, ev: dict):
    d = ev["data"]; u = d.get("usage") or {}
    model = ev["modelId"] or "?"
    costo = _usage_cost(model, u)
    timed_out = bool(d.get("timedOut") or d.get("idleTimedOut") or d.get("timedOutDuringCompaction"))
    error = d.get("promptErrorSource") is not None
    bad = timed_out or error
    comp = int(d.get("compactionCount") or 0)
    es_sistema = ev["agente"] == "main"
    tel = ev["telefono"] or ("(sistema)" if es_sistema else "(sin teléfono)")

    t = acc["totales"]
    for k in ("input", "output", "cacheRead", "cacheWrite", "total"):
        t[k] += u.get(k, 0)
    t["llamadas"] += 1; t["costo_usd"] += costo
    t["errores"] += 1 if error else 0; t["timeouts"] += 1 if timed_out else 0
    t["compactaciones"] += comp
    t["costo_errores" if bad else "costo_mensajes"] += costo

    m = acc["por_modelo"].setdefault(model, {"tokens": 0, "costo_usd": 0.0, "llamadas": 0})
    m["tokens"] += u.get("total", 0); m["costo_usd"] += costo; m["llamadas"] += 1

    cv = acc["por_conversacion"].setdefault(tel, {
        "telefono": tel, "tokens": 0, "input": 0, "output": 0,
        "cacheRead": 0, "cacheWrite": 0, "costo_usd": 0.0, "llamadas": 0,
        "timeouts": 0, "errores": 0, "compactaciones": 0, "por_modelo": {},
        "primer_ts": None, "ultimo_ts": None, "ejemplo": None, "es_sistema": es_sistema})
    for k in ("input", "output", "cacheRead", "cacheWrite"):
        cv[k] += u.get(k, 0)
    cv["tokens"] += u.get("total", 0); cv["costo_usd"] += costo; cv["llamadas"] += 1
    cv["timeouts"] += 1 if timed_out else 0; cv["errores"] += 1 if error else 0
    cv["compactaciones"] += comp
    cm = cv["por_modelo"].setdefault(model, {"llamadas": 0, "costo_usd": 0.0})
    cm["llamadas"] += 1; cm["costo_usd"] += costo
    tsiso = ev["ts"].isoformat()
    if cv["primer_ts"] is None or tsiso < cv["primer_ts"]:
        cv["primer_ts"] = tsiso
    if cv["ultimo_ts"] is None or tsiso > cv["ultimo_ts"]:
        cv["ultimo_ts"] = tsiso
    if not cv["ejemplo"]:
        txt = (d.get("finalPromptText") or "").strip().replace("\n", " ")
        if txt:
            cv["ejemplo"] = txt[:120]


def _aggregate_day(source: str, fecha: str, eventos: list) -> dict:
    acc = _new_acc()
    for ev in eventos:
        _fold(acc, ev)
    convs = sorted(acc["por_conversacion"].values(), key=lambda x: x["costo_usd"], reverse=True)
    for c in convs:
        c["costo_usd"] = round(c["costo_usd"], 4)
        for mv in c.get("por_modelo", {}).values():
            mv["costo_usd"] = round(mv["costo_usd"], 4)
    return {
        "source": source, "fecha": fecha,
        "totales": acc["totales"],
        "por_modelo": acc["por_modelo"],
        "top_conversaciones": convs[:15],
        "conversaciones": convs,  # lista COMPLETA (para el drill-down per-día)
        "n_conversaciones": sum(1 for c in convs if not c["es_sistema"]),
    }


# ── oportunidades FIJAS ──────────────────────────────────────────────────────

def _detectar(resumen: dict) -> list[dict]:
    t = resumen["totales"]; ops = []
    if t["timeouts"] > 0:
        ops.append({"tipo": "timeouts", "clave": "", "severidad": "alta",
                    "titulo": f"{t['timeouts']} llamada(s) con timeout/idle",
                    "detalle": "Gastan tokens sin respuesta útil. Revisar modelo/fallbacks/timeout del provider."})
    if t["errores"] > 0:
        ops.append({"tipo": "errores", "clave": "", "severidad": "alta",
                    "titulo": f"{t['errores']} llamada(s) con error",
                    "detalle": "Fallaron (promptErrorSource). Revisar causa para no re-gastar."})
    caros = {m: v for m, v in resumen["por_modelo"].items() if ("opus" in m.lower() or "gpt" in m.lower())}
    if caros:
        n = sum(v["llamadas"] for v in caros.values())
        ops.append({"tipo": "modelo_caro", "clave": "", "severidad": "media",
                    "titulo": f"{n} llamada(s) en modelo caro (fallback)",
                    "detalle": f"Modelos: {', '.join(caros)}. Revisar por qué cae al fallback."})
    if t["cacheWrite"] > max(t["cacheRead"], 1) * 0.8 and t["cacheWrite"] > 100_000:
        ops.append({"tipo": "cache", "clave": "", "severidad": "media",
                    "titulo": "Caché ineficiente (mucho cacheWrite)",
                    "detalle": f"cacheWrite={t['cacheWrite']:,} vs cacheRead={t['cacheRead']:,}. El contexto cambia mucho entre llamadas."})
    if t["compactaciones"] > 2:
        ops.append({"tipo": "compactacion", "clave": "", "severidad": "media",
                    "titulo": f"{t['compactaciones']} compactaciones de contexto",
                    "detalle": "Contexto grande que se compacta seguido. Revisar reset de sesión / system prompt."})
    convs = [c for c in resumen["top_conversaciones"] if not c.get("es_sistema")]
    if convs:
        prom = sum(c["costo_usd"] for c in convs) / len(convs)
        cara = convs[0]
        if cara["costo_usd"] > max(prom * 3, 0.30):
            ops.append({"tipo": "conversacion_cara", "clave": cara["telefono"], "severidad": "baja",
                        "titulo": f"Conversación cara: {cara['telefono']} (~${cara['costo_usd']:.2f})",
                        "detalle": f"{cara['llamadas']} llamadas. {('“'+cara['ejemplo']+'”') if cara['ejemplo'] else ''}"})
    return ops


def _upsert_oportunidades(source: str, ops: list[dict]) -> int:
    """Acumula oportunidades (no las borra). Devuelve cuántas se abrieron nuevas
    (insertadas o re-abiertas) para decidir el push."""
    from app.models.camila_audit import CamilaOportunidad
    from app.database import SessionLocal
    ahora = datetime.now(timezone.utc)
    nuevas = 0
    db = SessionLocal()
    try:
        for o in ops:
            row = (db.query(CamilaOportunidad)
                   .filter(CamilaOportunidad.source == source,
                           CamilaOportunidad.tipo == o["tipo"],
                           CamilaOportunidad.clave == o.get("clave", "")).first())
            if row:
                row.severidad = o["severidad"]; row.titulo = o["titulo"]
                row.detalle = o["detalle"]; row.ultima_vez = ahora
                if row.estado == "resuelta":
                    row.estado = "abierta"; row.resuelta_at = None; nuevas += 1
            else:
                db.add(CamilaOportunidad(source=source, tipo=o["tipo"], clave=o.get("clave", ""),
                                         severidad=o["severidad"], titulo=o["titulo"],
                                         detalle=o["detalle"], estado="abierta",
                                         primera_vez=ahora, ultima_vez=ahora))
                nuevas += 1
        db.commit()
    finally:
        db.close()
    return nuevas


def get_oportunidades(source: str, incluir_resueltas: bool = False) -> list[dict]:
    from app.models.camila_audit import CamilaOportunidad
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        q = db.query(CamilaOportunidad).filter(CamilaOportunidad.source == source)
        if not incluir_resueltas:
            q = q.filter(CamilaOportunidad.estado == "abierta")
        sev = {"alta": 0, "media": 1, "baja": 2}
        rows = q.all()
        rows.sort(key=lambda r: (sev.get(r.severidad, 9),
                                 r.primera_vez or datetime.min.replace(tzinfo=timezone.utc)))
        return [{"id": r.id, "tipo": r.tipo, "clave": r.clave, "severidad": r.severidad,
                 "titulo": r.titulo, "detalle": r.detalle, "estado": r.estado,
                 "primera_vez": r.primera_vez.isoformat() if r.primera_vez else None,
                 "ultima_vez": r.ultima_vez.isoformat() if r.ultima_vez else None}
                for r in rows]
    finally:
        db.close()


def resolver_oportunidad(op_id: int, resolver: bool = True) -> bool:
    from app.models.camila_audit import CamilaOportunidad
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        row = db.get(CamilaOportunidad, op_id)
        if not row:
            return False
        row.estado = "resuelta" if resolver else "abierta"
        row.resuelta_at = datetime.now(timezone.utc) if resolver else None
        db.commit()
        return True
    finally:
        db.close()


# ── persistencia diaria ──────────────────────────────────────────────────────

def run_audit(source: str, fecha: str, notify: bool = True) -> dict:
    if source not in SOURCES:
        raise ValueError(f"source desconocido: {source}")
    day_start = datetime.strptime(fecha, "%Y-%m-%d").replace(tzinfo=_BA)
    day_end = day_start + timedelta(days=1)
    eventos = [e for e in _collect_events(source, day_start) if day_start <= e["ts"] < day_end]
    resumen = _aggregate_day(source, fecha, eventos)

    from app.models.camila_audit import CamilaAudit
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        row = db.query(CamilaAudit).filter(CamilaAudit.source == source, CamilaAudit.fecha == fecha).first()
        if not row:
            row = CamilaAudit(source=source, fecha=fecha)
            db.add(row)
        t = resumen["totales"]
        row.total_tokens = t["total"]; row.costo_usd = round(t["costo_usd"], 4)
        row.llamadas = t["llamadas"]; row.errores = t["errores"]
        row.data = json.dumps(resumen, ensure_ascii=False)
        row.generated_at = datetime.now(timezone.utc)
        nuevas = _upsert_oportunidades(source, _detectar(resumen))
        row.oportunidades = len(get_oportunidades(source))
        db.commit()
    finally:
        db.close()

    if notify and nuevas > 0:
        try:
            from app.services import push
            push.notificar_global("tokens_oportunidad",
                                   f"💡 {SOURCES[source]['nombre']}: {nuevas} oportunidad(es) nueva(s)",
                                   "Entrá a Monitoreo → Tokens para revisarlas.",
                                   {"tipo": "tokens", "source": source, "nav": "tokens"})
        except Exception as e:
            print(f"[CAMILA-AUDIT] push: {type(e).__name__}: {e}")
    return resumen


# ── rollup mensual (gráfico histórico) ───────────────────────────────────────

def backfill_mensual(source: str, meses: int = 6, max_files: int = 500) -> dict:
    """Barrido único de trajectories → rollup por mes (camila_audit_mensual).
    Lee cada archivo una vez; cap de archivos (loguea si recorta)."""
    if source not in SOURCES:
        raise ValueError("source desconocido")
    cfg = SOURCES[source]
    base, token = cfg["base"], cfg["token_fn"]()
    if not token:
        raise RuntimeError("token del source no configurado")
    desde = datetime.now(_BA).replace(hour=0, minute=0, second=0, microsecond=0, day=1) \
        - timedelta(days=31 * (meses - 1))

    files_all = []
    for agente in cfg["agentes"]:
        sdir = f".openclaw/agents/{agente}/sessions"
        try:
            listing = _fs_list(base, token, sdir)
        except Exception:
            continue
        for e in listing.get("entries", []):
            if e.get("name", "").endswith(".trajectory.jsonl"):
                files_all.append((agente, sdir, e))
    files_all.sort(key=lambda x: x[2].get("mtime") or "", reverse=True)
    recortados = max(0, len(files_all) - max_files)

    by_month: dict[str, dict] = {}
    for agente, sdir, e in files_all[:max_files]:
        mt = e.get("mtime") or ""
        try:
            if mt and datetime.fromisoformat(mt.replace("Z", "+00:00")) < desde - timedelta(days=2):
                continue
        except Exception:
            pass
        try:
            doc = _fs_read(base, token, f"{sdir}/{e['name']}")
        except Exception:
            continue
        sesion = e["name"].replace(".trajectory.jsonl", "")
        for ev in _iter_model_events(doc.get("content", ""), agente, sesion):
            tsl = ev["ts"].astimezone(_BA)
            if tsl < desde:
                continue
            mes = tsl.strftime("%Y-%m")
            mb = by_month.setdefault(mes, {"acc": _new_acc(), "phones": set()})
            _fold(mb["acc"], ev)
            if ev["agente"] != "main":
                mb["phones"].add(ev["telefono"] or "(sin teléfono)")

    from app.models.camila_audit import CamilaAuditMensual
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        for mes, mb in by_month.items():
            t = mb["acc"]["totales"]
            data = {"totales": t, "por_modelo": mb["acc"]["por_modelo"],
                    "conversaciones": len(mb["phones"])}
            row = db.query(CamilaAuditMensual).filter(
                CamilaAuditMensual.source == source, CamilaAuditMensual.mes == mes).first()
            if not row:
                row = CamilaAuditMensual(source=source, mes=mes); db.add(row)
            row.costo_usd = round(t["costo_usd"], 4)
            row.conversaciones = len(mb["phones"])
            row.llamadas = t["llamadas"]
            row.data = json.dumps(data, ensure_ascii=False)
            row.generated_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()
    if recortados:
        print(f"[CAMILA-AUDIT] backfill mensual: {recortados} archivos no leídos (cap {max_files})")
    return {"meses": sorted(by_month), "files_recortados": recortados}


# ── lectura para la UI ───────────────────────────────────────────────────────

def get_sources() -> list[dict]:
    return [{"id": k, "nombre": v["nombre"]} for k, v in SOURCES.items()]


def _mes_actual() -> str:
    return datetime.now(_BA).strftime("%Y-%m")


def get_audit(source: str, days: int = 14) -> dict:
    from app.models.camila_audit import CamilaAudit, CamilaAuditMensual
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        rows = (db.query(CamilaAudit).filter(CamilaAudit.source == source)
                .order_by(CamilaAudit.fecha.desc()).limit(max(1, days)).all())
        tendencia = []
        for r in reversed(rows):
            try:
                t = json.loads(r.data).get("totales", {})
            except Exception:
                t = {}
            tendencia.append({"fecha": r.fecha, "costo_usd": r.costo_usd,
                              "costo_mensajes": round(t.get("costo_mensajes", 0.0), 4),
                              "costo_errores": round(t.get("costo_errores", 0.0), 4)})
        ultimo = json.loads(rows[0].data) if rows else None
        if ultimo:
            _enriquecer_nombres(source, [ultimo.get("conversaciones"), ultimo.get("top_conversaciones")], db)

        mensual = (db.query(CamilaAuditMensual).filter(CamilaAuditMensual.source == source)
                   .order_by(CamilaAuditMensual.mes.asc()).all())
        serie_mensual = []
        por_modelo_mes = {}
        mes_actual = _mes_actual()
        for r in mensual:
            convs = r.conversaciones or 0
            serie_mensual.append({
                "mes": r.mes, "costo_usd": r.costo_usd, "conversaciones": convs, "llamadas": r.llamadas,
                "costo_por_conversacion": round(r.costo_usd / convs, 4) if convs else 0.0,
            })
            if r.mes == mes_actual:
                try:
                    por_modelo_mes = json.loads(r.data).get("por_modelo", {})
                except Exception:
                    por_modelo_mes = {}
        return {
            "source": source, "ultimo": ultimo, "tendencia": tendencia,
            "serie_mensual": serie_mensual, "por_modelo_mes": por_modelo_mes,
            "mes_actual": mes_actual, "oportunidades": get_oportunidades(source),
        }
    finally:
        db.close()


def _enriquecer_nombres(source: str, listas: list, db) -> None:
    """Para cada conversación (por teléfono) agrega `nombre` y `mirror_id` (Etiguel)
    matcheando por últimos 10 dígitos contra el espejo. Permite mostrar el nombre y
    abrir la conversación entera desde la vista de costos."""
    if source != "etiguel":
        return
    try:
        from app.models.etiguel_mirror import EtiguelMirror
        by_digits = {}
        for r in db.query(EtiguelMirror.id, EtiguelMirror.nombre, EtiguelMirror.telefono).all():
            d = re.sub(r"\D", "", r.telefono or "")[-10:]
            if d and d not in by_digits:
                by_digits[d] = (r.nombre, r.id)
        for convs in listas:
            for c in (convs or []):
                d = re.sub(r"\D", "", (c.get("telefono") or ""))[-10:]
                ref = by_digits.get(d)
                if ref:
                    c["nombre"], c["mirror_id"] = ref[0], ref[1]
    except Exception:
        pass


def get_dia(source: str, fecha: str) -> dict | None:
    """Detalle COMPLETO de un día (para el drill-down): totales + por_modelo +
    lista completa de conversaciones (cada una con tokens, costo, split por modelo,
    cache, timeouts/errores, ejemplo y primer/último ts). None si no hay fila."""
    from app.models.camila_audit import CamilaAudit
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        row = (db.query(CamilaAudit)
               .filter(CamilaAudit.source == source, CamilaAudit.fecha == fecha).first())
        if not row:
            return None
        try:
            data = json.loads(row.data)
        except Exception:
            return {"source": source, "fecha": fecha, "totales": {}, "conversaciones": []}
        _enriquecer_nombres(source, [data.get("conversaciones"), data.get("top_conversaciones")], db)
        return data
    finally:
        db.close()


def get_conversacion_costo(source: str, telefono: str) -> dict:
    """Costo EN VIVO de una conversación: proxy al `/costos/conversacion` del webhook
    del cliente (lee la sesión per-chat al momento → fresco para la pantalla de chat)."""
    if source not in SOURCES:
        raise ValueError(f"source desconocido: {source}")
    cfg = SOURCES[source]
    base, token = cfg["base"], cfg["token_fn"]()
    if not token:
        raise RuntimeError("token del source no configurado")
    r = requests.get(f"{base}/costos/conversacion", params={"telefono": telefono},
                     headers={"User-Agent": _UA, "X-Deploy-Token": token}, timeout=20)
    r.raise_for_status()
    return r.json()


def get_clientes_resumen() -> list[dict]:
    """Por cada cliente/source: gasto del mes actual + serie mensual (para las
    cards 'gasto del mes' y el gráfico mensual por cliente del dashboard superadmin).
    El gasto del mes corriente se suma de las filas diarias (más fresco que el rollup)."""
    from app.models.camila_audit import CamilaAudit, CamilaAuditMensual
    from app.database import SessionLocal
    mes_actual = _mes_actual()
    out = []
    db = SessionLocal()
    try:
        for sid, cfg in SOURCES.items():
            mensual = (db.query(CamilaAuditMensual)
                       .filter(CamilaAuditMensual.source == sid)
                       .order_by(CamilaAuditMensual.mes.asc()).all())
            serie = [{"mes": r.mes, "costo_usd": round(r.costo_usd, 4),
                      "conversaciones": r.conversaciones, "llamadas": r.llamadas,
                      "costo_por_conversacion": round(r.costo_usd / r.conversaciones, 4)
                      if r.conversaciones else 0.0}
                     for r in mensual]
            dailies = (db.query(CamilaAudit)
                       .filter(CamilaAudit.source == sid,
                               CamilaAudit.fecha.like(mes_actual + "%")).all())
            gasto_mes = round(sum(d.costo_usd for d in dailies), 4)
            llamadas_mes = sum(d.llamadas for d in dailies)
            if not dailies:  # fallback al rollup si no hay diarias del mes
                r = next((x for x in mensual if x.mes == mes_actual), None)
                gasto_mes = round(r.costo_usd, 4) if r else 0.0
                llamadas_mes = r.llamadas if r else 0
            out.append({
                "id": sid, "nombre": cfg["nombre"], "mes_actual": mes_actual,
                "gasto_mes_actual": gasto_mes, "llamadas_mes": llamadas_mes,
                "serie_mensual": serie,
            })
    finally:
        db.close()
    return out


# ── loops ─────────────────────────────────────────────────────────────────────

def _hoy_ba() -> str:
    return datetime.now(_BA).strftime("%Y-%m-%d")


def _ayer_ba() -> str:
    return (datetime.now(_BA) - timedelta(days=1)).strftime("%Y-%m-%d")


def start():
    def loop():
        time.sleep(120)
        last_day = None
        first = True
        while True:
            hoy = _hoy_ba()
            for source in SOURCES:
                try:
                    run_audit(source, hoy, notify=False)
                except Exception as e:
                    print(f"[CAMILA-AUDIT] {source} hoy: {type(e).__name__}: {e}")
                if last_day != hoy:
                    try:
                        run_audit(source, _ayer_ba(), notify=True)
                    except Exception as e:
                        print(f"[CAMILA-AUDIT] {source} ayer: {type(e).__name__}: {e}")
                if first or last_day != hoy:
                    try:
                        backfill_mensual(source, meses=6)
                    except Exception as e:
                        print(f"[CAMILA-AUDIT] {source} mensual: {type(e).__name__}: {e}")
            last_day = hoy
            first = False
            time.sleep(6 * 3600)

    threading.Thread(target=loop, daemon=True, name="camila-audit").start()
