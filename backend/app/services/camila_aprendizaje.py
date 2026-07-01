"""Capa B — enseñarle a Camila lo que aprendió el Especialista Negocio.

Las lecciones (revisiones confirmadas como 'Camila estuvo mal') se acumulan. Al
llegar a UMBRAL (o por tope semanal, o a pedido) se CONSOLIDAN: un agente toma el
bloque vigente + las lecciones nuevas y produce un bloque de guidelines limpio,
deduplicado, generalizado y corto. Sebi lo aprueba y recién ahí se inyecta en una
sección marcada del prompt de Camila (vía /camila-config, que auto-backupea y
reinicia el gateway). Prospia es dueño del bloque → no depende de leer el prompt.

Por qué consolidar en vez de pegar cada error: un prompt que crece sin control se
sigue peor (reglas que se ignoran/contradicen) e infla el cache (costo). Consolidar
mantiene el bloque corto y coherente.
"""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timedelta, timezone

import requests

from app.services.camila_quality import _post, _parse_json

_BA = timezone(timedelta(hours=-3))
_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

UMBRAL_LECCIONES = 5            # cuántas lecciones juntar antes de proponer
DIAS_TOPE = 7                   # tope de respaldo: proponer igual 1×/semana si hay pendientes

MARKER_START = "<!-- APRENDIZAJES_NEGOCIO:START (Especialista Negocio - no editar a mano) -->"
MARKER_END = "<!-- APRENDIZAJES_NEGOCIO:END -->"

# Agentes por source (id del agente en openclaw.json cuyo systemPromptOverride es el de Camila).
_AGENT_ID = {"etiguel": "etiguel"}


# ── pendientes / estado ───────────────────────────────────────────────────────

def _pendientes(db, source: str):
    from app.models.camila_revision import CamilaRevision
    return (db.query(CamilaRevision)
            .filter(CamilaRevision.source == source,
                    CamilaRevision.veredicto == "acierto",
                    CamilaRevision.resuelto_directo.is_(False),
                    CamilaRevision.incorporada_at.is_(None))
            .order_by(CamilaRevision.revisado_at.asc()).all())


def _propuesta_abierta(db, source: str):
    from app.models.camila_revision import CamilaConsolidacion
    return (db.query(CamilaConsolidacion)
            .filter(CamilaConsolidacion.source == source,
                    CamilaConsolidacion.estado == "propuesta")
            .order_by(CamilaConsolidacion.created_at.desc()).first())


def _cons_dict(c) -> dict:
    return {
        "id": c.id, "source": c.source, "estado": c.estado,
        "bloque_propuesto": c.bloque_propuesto, "bloque_anterior": c.bloque_anterior,
        "n_lecciones": c.n_lecciones,
        "lecciones_ids": json.loads(c.lecciones_ids or "[]"),
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "aplicada_at": c.aplicada_at.isoformat() if c.aplicada_at else None,
    }


def estado(source: str = "etiguel") -> dict:
    from app.database import SessionLocal
    from app.models.camila_revision import CamilaConsolidacion
    db = SessionLocal()
    try:
        pend = _pendientes(db, source)
        prop = _propuesta_abierta(db, source)
        ultima = (db.query(CamilaConsolidacion)
                  .filter(CamilaConsolidacion.source == source,
                          CamilaConsolidacion.estado == "aplicada")
                  .order_by(CamilaConsolidacion.aplicada_at.desc()).first())
        return {
            "source": source,
            "pendientes": len(pend),
            "umbral": UMBRAL_LECCIONES,
            "propuesta": _cons_dict(prop) if prop else None,
            "ultima_aplicada": _cons_dict(ultima) if ultima else None,
            "lecciones_pendientes": [
                {"id": r.id, "titulo": r.titulo, "categoria": r.categoria,
                 "sugerencia": r.sugerencia, "nota_sebi": r.nota_sebi}
                for r in pend
            ],
        }
    finally:
        db.close()


def historial(source: str = "etiguel", limit: int = 30) -> list[dict]:
    """Consolidaciones YA aplicadas (lo que se le enseñó a Camila), más nuevas primero.
    Para la pestaña de Historial: cada una con fecha, cuántas lecciones y el bloque."""
    from app.database import SessionLocal
    from app.models.camila_revision import CamilaConsolidacion
    db = SessionLocal()
    try:
        rows = (db.query(CamilaConsolidacion)
                .filter(CamilaConsolidacion.source == source,
                        CamilaConsolidacion.estado == "aplicada")
                .order_by(CamilaConsolidacion.aplicada_at.desc()).limit(limit).all())
        return [{
            "id": c.id, "n_lecciones": c.n_lecciones,
            "aplicada_at": c.aplicada_at.isoformat() if c.aplicada_at else None,
            "bloque": c.bloque_propuesto,
        } for c in rows]
    finally:
        db.close()


def _bloque_vigente(db, source: str) -> str:
    from app.models.camila_revision import CamilaConsolidacion
    ultima = (db.query(CamilaConsolidacion)
              .filter(CamilaConsolidacion.source == source,
                      CamilaConsolidacion.estado == "aplicada")
              .order_by(CamilaConsolidacion.aplicada_at.desc()).first())
    return ultima.bloque_propuesto if ultima else ""


# ── proponer (consolidación por IA) ───────────────────────────────────────────

def _prompt_base(source: str) -> str:
    """Prompt completo ACTUAL de Camila SIN la sección de aprendizajes (esa la
    reescribimos nosotros). Sirve de contexto para no duplicar/contradecir lo que
    ya está en el prompt base. "" si no se puede leer (cae al comportamiento viejo)."""
    try:
        _, prompt, _ = _leer_prompt(source)
    except Exception as e:
        print(f"[CAMILA-APRENDIZAJE] no pude leer prompt base: {type(e).__name__}: {e}")
        return ""
    if MARKER_START in prompt and MARKER_END in prompt:
        pre = prompt.split(MARKER_START)[0]
        post = prompt.split(MARKER_END, 1)[1]
        prompt = pre.rstrip() + "\n" + post.lstrip()
    return prompt.strip()


def proponer(source: str = "etiguel", notify: bool = True) -> dict:
    from app.database import SessionLocal
    from app.models.camila_revision import CamilaConsolidacion
    db = SessionLocal()
    try:
        pend = _pendientes(db, source)
        if not pend:
            return {"source": source, "ok": False, "motivo": "sin_lecciones"}
        vigente = _bloque_vigente(db, source)
        base_prompt = _prompt_base(source)

        lecciones_txt = "\n".join(
            f"- [{r.categoria}] {r.titulo}. Qué corregir: {r.sugerencia or '(ver detalle)'}"
            + (f" Nota de Sebi: {r.nota_sebi.strip()}" if r.nota_sebi else "")
            for r in pend
        )
        system = (
            "Sos el consolidador de aprendizajes de Camila (agente de WhatsApp de un "
            "negocio). Recibís el BLOQUE VIGENTE de guidelines y LECCIONES NUEVAS "
            "(casos donde Camila respondió mal, confirmados por el dueño). Tu tarea es "
            "producir el NUEVO bloque de guidelines para el prompt de Camila:\n"
            "- Integrá las lecciones nuevas con lo vigente.\n"
            "- DEDUPLICÁ y GENERALIZÁ: varios casos parecidos = UNA regla clara, no una por caso.\n"
            "- Resolvé contradicciones quedándote con la intención del dueño.\n"
            "- Mantenelo CORTO y accionable: reglas concretas en imperativo, en español "
            "argentino, agrupadas por tema si conviene. Sin relleno ni explicaciones.\n"
            "- Es un bloque que se inserta dentro del prompt de Camila, así que escribilo "
            "como instrucciones directas a ella.\n"
            "- Te paso también el PROMPT BASE actual de Camila (todo lo que ya está activo, "
            "fuera de este bloque) SOLO como contexto: NO lo reescribas ni lo repitas. NO "
            "agregues reglas que ya estén dichas ahí (evitás duplicar). Si una lección nueva "
            "CONTRADICE el prompt base, reformulá la regla para que sea coherente con la "
            "intención del dueño (no opuesta) en vez de pisarla.\n\n"
            "Respondé SOLO con el texto del bloque (markdown simple con viñetas), sin "
            "encabezado de sección, sin ``` y sin comentarios alrededor."
        )
        user = (
            (f"PROMPT BASE ACTUAL DE CAMILA (contexto, ya activo, NO reescribir ni repetir):\n"
             f"{base_prompt}\n\n" if base_prompt else "")
            + f"BLOQUE VIGENTE (esto SÍ lo reemplazás):\n{vigente or '(vacío, es la primera vez)'}\n\n"
            + f"LECCIONES NUEVAS ({len(pend)}):\n{lecciones_txt}"
        )
        bloque = (_post(system, user, max_tokens=1800, funcion="Consolidación aprendizajes", source=source) or "").strip()
        if not bloque:
            return {"source": source, "ok": False, "motivo": "ia_no_disponible"}

        # Reemplaza cualquier propuesta abierta anterior (siempre 1 vigente).
        anterior = _propuesta_abierta(db, source)
        if anterior:
            anterior.estado = "descartada"
        cons = CamilaConsolidacion(
            source=source, estado="propuesta", bloque_propuesto=bloque,
            bloque_anterior=vigente, n_lecciones=len(pend),
            lecciones_ids=json.dumps([r.id for r in pend]),
        )
        db.add(cons)
        db.commit()
        db.refresh(cons)
        out = _cons_dict(cons)
    finally:
        db.close()

    if notify:
        try:
            from app.services import push
            push.notificar_global(
                "calidad_revision",
                f"🎓 Especialista Negocio: propuesta para enseñarle a Camila ({out['n_lecciones']} lecciones)",
                "Revisá y aprobá el bloque de aprendizajes en Monitoreo → Calidad.",
                {"tipo": "calidad", "source": source, "nav": "calidad"},
            )
        except Exception as e:
            print(f"[CAMILA-APRENDIZAJE] push: {type(e).__name__}: {e}")
    return {"source": source, "ok": True, "propuesta": out}


def maybe_proponer(source: str = "etiguel") -> None:
    """Gatillo por umbral: si hay >= UMBRAL pendientes y no hay propuesta abierta,
    consolida y avisa. Se llama después de confirmar una lección 'acierto'."""
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        if _propuesta_abierta(db, source):
            return
        if len(_pendientes(db, source)) < UMBRAL_LECCIONES:
            return
    finally:
        db.close()
    try:
        proponer(source, notify=True)
    except Exception as e:
        print(f"[CAMILA-APRENDIZAJE] maybe_proponer: {type(e).__name__}: {e}")


# ── aplicar a Camila (escribe el prompt vía /camila-config) ───────────────────

def _src_cfg(source: str):
    from app.services import camila_audit
    cfg = camila_audit.SOURCES[source]
    return cfg["base"], cfg["token_fn"]()


def _leer_prompt(source: str) -> tuple[int, str, dict]:
    """Devuelve (idx del agente en agents.list, systemPromptOverride actual, cfg)."""
    base, token = _src_cfg(source)
    r = requests.get(f"{base}/fs/read", params={"path": ".openclaw/openclaw.json", "max_bytes": 5_000_000},
                     headers={"User-Agent": _UA, "X-Deploy-Token": token}, timeout=30)
    r.raise_for_status()
    cfg = json.loads(r.json().get("content", "{}"))
    lista = cfg.get("agents", {}).get("list", [])
    agente_id = _AGENT_ID.get(source, source)
    for i, a in enumerate(lista):
        if a.get("id") == agente_id:
            return i, (a.get("systemPromptOverride") or ""), cfg
    raise RuntimeError(f"no encontré el agente '{agente_id}' en openclaw.json")


def _upsert_seccion(prompt: str, bloque: str) -> str:
    seccion = f"{MARKER_START}\n# Aprendizajes del negocio\n{bloque.strip()}\n{MARKER_END}"
    if MARKER_START in prompt and MARKER_END in prompt:
        pre = prompt.split(MARKER_START)[0]
        post = prompt.split(MARKER_END, 1)[1]
        return (pre.rstrip() + "\n\n" + seccion + post).strip() + "\n"
    return prompt.rstrip() + "\n\n" + seccion + "\n"


def aplicar_a_camila(source: str, bloque: str) -> dict:
    """Inserta/reemplaza la sección de aprendizajes en el prompt de Camila vía
    /camila-config (config-set: auto-backupea openclaw.json y reinicia el gateway)."""
    idx, prompt_actual, _ = _leer_prompt(source)
    nuevo = _upsert_seccion(prompt_actual, bloque)
    base, token = _src_cfg(source)
    r = requests.post(
        f"{base}/camila-config",
        headers={"User-Agent": _UA, "X-Deploy-Token": token, "Content-Type": "application/json"},
        json={"ops": [{"type": "config-set",
                       "path": f"agents.list.{idx}.systemPromptOverride",
                       "value": nuevo}]},
        timeout=40,
    )
    r.raise_for_status()
    data = r.json()
    if not data.get("ok"):
        raise RuntimeError(f"camila-config no ok: {str(data)[:200]}")
    return {"ok": True, "backup": data.get("backup"), "chars": len(nuevo)}


def aprobar(cons_id: int) -> dict:
    """Aprueba una propuesta: la aplica al prompt de Camila y marca las lecciones
    como incorporadas. Si el write a Camila falla, NO marca nada (queda propuesta)."""
    from app.database import SessionLocal
    from app.models.camila_revision import CamilaConsolidacion, CamilaRevision
    db = SessionLocal()
    try:
        c = db.get(CamilaConsolidacion, cons_id)
        if not c:
            return {"ok": False, "motivo": "no_existe"}
        if c.estado != "propuesta":
            return {"ok": False, "motivo": f"estado_{c.estado}"}
        try:
            res = aplicar_a_camila(c.source, c.bloque_propuesto)
        except Exception as e:
            return {"ok": False, "motivo": "no_se_pudo_aplicar", "error": f"{type(e).__name__}: {e}"}
        ahora = datetime.now(timezone.utc)
        c.estado = "aplicada"
        c.aplicada_at = ahora
        for rid in json.loads(c.lecciones_ids or "[]"):
            r = db.get(CamilaRevision, rid)
            if r and r.incorporada_at is None:
                r.incorporada_at = ahora
        db.commit()
        return {"ok": True, "aplicado": res, "cons_id": cons_id}
    finally:
        db.close()


def descartar(cons_id: int) -> dict:
    from app.database import SessionLocal
    from app.models.camila_revision import CamilaConsolidacion
    db = SessionLocal()
    try:
        c = db.get(CamilaConsolidacion, cons_id)
        if not c or c.estado != "propuesta":
            return {"ok": False}
        c.estado = "descartada"
        db.commit()
        return {"ok": True}
    finally:
        db.close()


# ── loop de respaldo semanal ──────────────────────────────────────────────────

def start():
    def loop():
        time.sleep(360)
        from app.database import SessionLocal
        last_prop = None
        while True:
            hoy = datetime.now(_BA).strftime("%Y-%m-%d")
            for source in _AGENT_ID:
                try:
                    db = SessionLocal()
                    try:
                        pend = _pendientes(db, source)
                        abierta = _propuesta_abierta(db, source)
                    finally:
                        db.close()
                    # Respaldo semanal: si hay pendientes y no hay propuesta abierta,
                    # proponer aunque no se haya alcanzado el umbral.
                    if pend and not abierta and last_prop != hoy:
                        proponer(source, notify=True)
                except Exception as e:
                    print(f"[CAMILA-APRENDIZAJE] loop {source}: {type(e).__name__}: {e}")
            last_prop = hoy
            time.sleep(DIAS_TOPE * 24 * 3600)

    threading.Thread(target=loop, daemon=True, name="camila-aprendizaje").start()
