"""Ingesta del espejo de Etiguel (APP.7).

El webhook de Camila (otro sistema, sobre Monday) postea acá cada vez que
contacta/conversa con un lead o prospect, para que Sebi lo vea en la app sin
entrar a Monday. Autenticado con un token compartido (no JWT: es server→server),
por eso vive fuera del router /admin (que exige superadmin)."""
from datetime import datetime, timezone

from pydantic import BaseModel
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

import json

from app.core.config import settings
from app.database import get_db
from app.models.agent_error import AgentError
from app.models.consulta import Consulta
from app.models.etiguel_mirror import EtiguelMirror, EtiguelMirrorMensaje
from app.models.pregunta_claude import PreguntaClaude
from app.models.test_run import TestRun
from app.schemas.admin import AgentErrorIn, AvisoIn, ConsultaIn, EtiguelMirrorIn, PreguntaClaudeIn, TestRunIn
from app.models.tenant import Tenant, TenantConfig
from app.services import email as email_svc
from app.services import push
from app.services.preguntas_claude import preguntas_al_cel_activo

router = APIRouter(prefix="/ingest", tags=["ingest"])


def _check_token(x_mirror_token: str | None):
    esperado = settings.ETIGUEL_MIRROR_TOKEN or settings.WEBHOOK_TOKEN
    if not x_mirror_token or x_mirror_token != esperado:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token inválido")


def _resolver_dueno(x_mirror_token: str | None, db: Session):
    """Resuelve el dueño de una consulta a partir del token (multi-tenant):
    - token global (Etiguel) → (True, None, None)
    - webhook_token de un cliente → (False, Tenant, TenantConfig)
    El token es la autoridad (no se confía en tenant_id del payload). 403 si no matchea."""
    if not x_mirror_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token inválido")
    global_tok = settings.ETIGUEL_MIRROR_TOKEN or settings.WEBHOOK_TOKEN
    if x_mirror_token == global_tok:
        return True, None, None
    cfg = db.query(TenantConfig).filter(TenantConfig.webhook_token == x_mirror_token).first()
    if cfg:
        tenant = db.get(Tenant, cfg.tenant_id)
        if tenant:
            return False, tenant, cfg
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token inválido")


@router.post("/test-run", status_code=status.HTTP_201_CREATED)
def ingest_test_run(
    body: TestRunIn,
    x_mirror_token: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Registra una corrida de los tests visuales (la postea el reporter al
    terminar). Autenticado con el token global. Devuelve el id creado."""
    _check_token(x_mirror_token)
    run = TestRun(
        origen=body.origen or "local",
        total=body.total,
        pasaron=body.pasaron,
        fallaron=body.fallaron,
        duracion_ms=body.duracion_ms,
        detalle=[d.model_dump() for d in body.detalle],
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    # Si algo salió ROJO, avisar por push (con el detalle de qué falló).
    if run.fallaron > 0:
        lineas = []
        for d in run.detalle:
            if d.get("estado") == "failed":
                err = (d.get("error") or "").strip().split("\n")[0][:180]
                lineas.append(f"✗ {d.get('archivo') or ''} :: {d.get('nombre')}\n   {err}")
        push.notificar_aviso_async(
            f"🔴 Tests visuales: {run.fallaron} fallaron",
            f"{run.pasaron}/{run.total} OK · origen {run.origen}. Tocá para ver el detalle.",
            {"tipo": "test_run", "run_id": run.id},
            detalle="\n\n".join(lineas) or None,
        )
    return {"id": run.id}


@router.post("/etiguel-mirror")
def ingest_etiguel_mirror(
    body: EtiguelMirrorIn,
    x_mirror_token: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Upsert de un item espejado por (tipo, item_id). Si vienen direccion+texto,
    agrega el mensaje. Idempotente y best-effort: el webhook no debe romperse si
    esto falla."""
    _check_token(x_mirror_token)
    if body.tipo not in ("lead", "prospect"):
        raise HTTPException(status_code=400, detail="tipo debe ser 'lead' o 'prospect'")

    ahora = datetime.now(timezone.utc)

    mirror = (
        db.query(EtiguelMirror)
        .filter(EtiguelMirror.tipo == body.tipo, EtiguelMirror.item_id == str(body.item_id))
        .first()
    )
    if mirror is None:
        mirror = EtiguelMirror(tipo=body.tipo, item_id=str(body.item_id))
        db.add(mirror)

    estado_anterior = mirror.estado  # para detectar transición a "interesado" (#44 Etiguel)

    # Actualiza datos si vienen (no pisa con None).
    if body.nombre is not None:
        mirror.nombre = body.nombre
    if body.telefono is not None:
        mirror.telefono = body.telefono
    if body.email is not None:
        mirror.email = body.email
    if body.estado is not None:
        mirror.estado = body.estado
    if body.prox_contacto is not None:
        # "" (sin fecha en Monday) → limpiar; 'YYYY-MM-DD' → setear.
        mirror.prox_contacto = body.prox_contacto.strip() or None
    mirror.ultima_actividad = ahora
    db.flush()  # asegura mirror.id para el mensaje

    agregado = False
    if body.direccion in ("in", "out") and (body.texto or "").strip():
        texto = body.texto.strip()
        # Dedup liviano: evita duplicar si el último mensaje es idéntico (reintentos).
        ultimo = (
            db.query(EtiguelMirrorMensaje)
            .filter(EtiguelMirrorMensaje.mirror_id == mirror.id)
            .order_by(EtiguelMirrorMensaje.id.desc())
            .first()
        )
        if not (ultimo and ultimo.direccion == body.direccion and ultimo.texto == texto):
            db.add(EtiguelMirrorMensaje(
                mirror_id=mirror.id, direccion=body.direccion, texto=texto, fecha=ahora
            ))
            agregado = True

    # Cuántos mensajes 'in' tenía este lead ANTES del que acabamos de agregar.
    # OJO: SessionLocal usa autoflush=False y el db.add() de arriba todavía NO se
    # flusheó (el commit recién pasa abajo), así que este count NO incluye el
    # mensaje actual → es el conteo de inbounds PREVIOS. Por eso "primera
    # respuesta" = no había ninguno antes = n_in == 0.
    n_in = (
        db.query(EtiguelMirrorMensaje)
        .filter(EtiguelMirrorMensaje.mirror_id == mirror.id, EtiguelMirrorMensaje.direccion == "in")
        .count()
    )
    nombre_lead = mirror.nombre
    mirror_id = mirror.id  # para el deep-link de la push (abrir este lead)
    db.commit()

    # ── Push diferenciado de Etiguel (#44), respetando los toggles por cliente ──
    try:
        # Mensaje entrante nuevo: el 1° 'in' = primera respuesta; los siguientes = mensaje entrante.
        # n_in cuenta los inbounds PREVIOS (no el actual), así que primera
        # respuesta ⇔ n_in == 0. Usar <= 1 disparaba "respuesta" también en el
        # 2° mensaje (n_in==1) → push duplicado.
        if agregado and body.direccion == "in":
            evento = "respuesta" if n_in == 0 else "mensaje_entrante"
            push.notificar_evento_etiguel_async(evento, nombre_lead or "un lead", body.texto, mirror_id=mirror_id)
        # Transición de estado a "interesado".
        nuevo = (body.estado or "")
        if nuevo and "interes" in nuevo.lower() and "interes" not in (estado_anterior or "").lower():
            push.notificar_evento_etiguel_async("interesado", nombre_lead or "un lead", None, mirror_id=mirror_id)
    except Exception:
        pass

    return {"ok": True, "tipo": mirror.tipo, "item_id": mirror.item_id, "mensaje_agregado": agregado}


@router.post("/aviso")
def ingest_aviso(
    body: AvisoIn,
    x_mirror_token: str | None = Header(None),
):
    """Aviso genérico → push a todos los devices. Reemplaza los mails de
    notificación (primer contacto, consulta de Camila, alertas técnicas).
    Best-effort: el que llama no debe romperse si esto falla."""
    _check_token(x_mirror_token)
    data = {"tipo": "aviso"}
    if body.categoria:
        data["categoria"] = body.categoria
    try:
        push.notificar_aviso_async(body.title[:120], body.body[:300], data,
                                   detalle=body.detalle)
    except Exception:
        pass
    return {"ok": True}


@router.post("/claude-termino")
def ingest_claude_termino(
    body: AvisoIn,
    x_mirror_token: str | None = Header(None),
):
    """Lo dispara el hook Stop de Claude Code (workspace de Prospia) cada vez que
    Claude termina un turno. Push del evento opt-in `claude_termino` (default OFF):
    solo llega a los devices que lo prendieron. Best-effort, no bloquea el turno."""
    _check_token(x_mirror_token)
    try:
        push.notificar_global_async(
            "claude_termino",
            body.title[:120] or "Claude terminó una tarea",
            body.body[:300] or "",
            detalle=(body.detalle or None),
        )
    except Exception:
        pass
    return {"ok": True}


@router.post("/agent-error")
def ingest_agent_error(
    body: AgentErrorIn,
    x_mirror_token: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """El outbound-guard reporta acá un error de Camila que bloqueó (no llegó al
    cliente), para que lo veamos en la app y nos llegue un push. Devuelve el
    `id` = el #número con el que se identifica."""
    _check_token(x_mirror_token)
    err = AgentError(
        contenido=(body.contenido or "")[:5000],
        fuente=body.fuente or "etiguel",
        agente=body.agente,
        telefono=body.telefono,
        patron=body.patron,
    )
    db.add(err)
    db.commit()
    db.refresh(err)
    # Push de alerta (no bloquea; best-effort).
    try:
        push.notificar_error_async(err.id, err.fuente, err.contenido)
    except Exception:
        pass
    return {"ok": True, "id": err.id}


@router.get("/agent-errors")
def listar_agent_errors(
    estado: str | None = None,
    cola_estado: str | None = None,
    x_mirror_token: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Lista de errores para que Claude levante la cola. Auth: token.
    Con `?estado=reportado` devuelve la cola que Sebi marcó para revisar.
    Con `?cola_estado=pendiente` devuelve la cola de procesamiento FIFO (lo que Sebi
    tildó y mandó a Procesar) — el más viejo primero."""
    _check_token(x_mirror_token)
    q = db.query(AgentError)
    if estado:
        q = q.filter(AgentError.estado == estado)
    if cola_estado:
        q = q.filter(AgentError.cola_estado == cola_estado)
        errs = q.order_by(AgentError.cola_orden.asc()).all()
    else:
        errs = q.order_by(AgentError.fecha.desc()).all()
    return [
        {
            "id": e.id, "estado": e.estado, "fuente": e.fuente, "agente": e.agente,
            "telefono": e.telefono, "patron": e.patron, "contenido": e.contenido,
            "fecha": e.fecha.isoformat() if e.fecha else None,
            "cola_estado": e.cola_estado, "cola_resultado": e.cola_resultado,
            "cola_orden": e.cola_orden.isoformat() if e.cola_orden else None,
        }
        for e in errs
    ]


@router.patch("/agent-error/{error_id}")
def patch_agent_error(
    error_id: int,
    body: dict,
    x_mirror_token: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Cambia el estado de un error. Lo usa Claude para avanzar la cola: al resolver
    uno marca `cola_estado=procesado` + `cola_resultado` (resumen); Sebi confirma
    después → fixed. Auth: token. Body: {"estado"?, "cola_estado"?, "cola_resultado"?}."""
    _check_token(x_mirror_token)
    err = db.get(AgentError, error_id)
    if not err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No existe ese error")
    body = body or {}
    estado = body.get("estado")
    cola_estado = body.get("cola_estado")
    cola_resultado = body.get("cola_resultado")
    if estado is None and cola_estado is None and cola_resultado is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="mandá 'estado', 'cola_estado' o 'cola_resultado'")
    if estado is not None:
        if estado not in ("nuevo", "reportado", "fixed"):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail=f"estado inválido: {estado}")
        err.estado = estado
        err.resuelto = (estado == "fixed")
        if estado == "fixed":
            err.cola_estado = None
            err.cola_orden = None
    if cola_estado is not None:
        nuevo = (cola_estado or "").strip() or None
        if nuevo not in (None, "pendiente", "procesado", "standby"):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail=f"cola_estado inválido: {nuevo}")
        err.cola_estado = nuevo
        if nuevo and err.cola_orden is None:
            err.cola_orden = datetime.now(timezone.utc)
        elif nuevo is None:
            err.cola_orden = None
    if cola_resultado is not None:
        err.cola_resultado = cola_resultado or None
    db.commit()
    return {"ok": True, "id": error_id, "estado": err.estado, "cola_estado": err.cola_estado}


@router.delete("/agent-error/{error_id}")
def delete_agent_error(
    error_id: int,
    x_mirror_token: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Borra un error ya resuelto. Lo llama Claude cuando el problema se solucionó
    (procedimiento: Sebi pasa el #número, se arregla, se borra). Auth: token."""
    _check_token(x_mirror_token)
    err = db.get(AgentError, error_id)
    if not err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No existe ese error")
    db.delete(err)
    db.commit()
    return {"ok": True, "borrado": error_id}


@router.post("/consulta")
def ingest_consulta(
    body: ConsultaIn,
    x_mirror_token: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """El plugin camila-consulta-push reporta acá una pregunta que el agente no supo
    responder (señal CAMILA_CONSULTA|num|pregunta). El TOKEN define el dueño:
    - token global (Etiguel) → tenant_id None, fuente 'etiguel', avisa por PUSH a Sebi.
    - webhook_token de un cliente → ese tenant, avisa por EMAIL al cliente.
    Quien contesta entra a Preguntas (Sebi en app/web; el cliente en su web) y la
    respuesta vuelve a su Camila. Devuelve el `id` = el #número de la consulta."""
    es_etiguel, tenant, cfg = _resolver_dueno(x_mirror_token, db)
    c = Consulta(
        pregunta=(body.pregunta or "")[:5000],
        telefono=body.telefono,
        fuente="etiguel" if es_etiguel else (tenant.nombre if tenant else "cliente"),
        agente=body.agente,
        tenant_id=None if es_etiguel else tenant.id,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    try:
        if es_etiguel:
            # Etiguel lo contesta Sebi → push con deep-link a Preguntas.
            push.notificar_consulta_async(c.id, c.fuente, c.telefono, c.pregunta)
        else:
            # Cliente: avisa por email al destinatario que cargó en el relevamiento.
            destino = (cfg.notif_consultas_email or "").strip() if cfg else ""
            if destino:
                email_svc.aviso_consulta(destino, c.fuente, c.telefono, c.pregunta)
            else:
                print(f"[CONSULTA] tenant {tenant.id} sin notif_consultas_email; consulta {c.id} sin aviso")
    except Exception as e:
        print(f"[CONSULTA] aviso falló: {type(e).__name__}: {e}")
    return {"ok": True, "id": c.id}


# ── Preguntas de Claude Code (switch "Preguntas al cel") ──────────────────────
@router.get("/preguntas-modo")
def preguntas_modo(x_mirror_token: str | None = Header(None), db: Session = Depends(get_db)):
    """El MCP local consulta si el switch está prendido (para decidir si ruteás la
    pregunta al cel o usás la cajita nativa de la terminal). Auth: token global."""
    _check_token(x_mirror_token)
    return {"activo": preguntas_al_cel_activo(db)}


@router.post("/pregunta-claude")
def ingest_pregunta_claude(
    body: PreguntaClaudeIn,
    x_mirror_token: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """El MCP local `preguntar_a_sebi` postea acá una pregunta de Claude. Si el
    switch está APAGADO, no crea nada y devuelve {"mode":"local"} (Claude usa la
    cajita nativa). Si está PRENDIDO, persiste la pregunta, dispara el push con
    deep-link a la pantalla de opciones y devuelve {"mode":"remote","id":...} para
    que el MCP haga long-poll a GET /ingest/pregunta-claude/{id}. Auth: token global."""
    _check_token(x_mirror_token)
    if not preguntas_al_cel_activo(db):
        return {"mode": "local"}
    items = body.normalizadas()
    if not items:
        raise HTTPException(status_code=422, detail="Mandá al menos una pregunta")
    preguntas = [{
        "header": (it.header or None) and it.header[:80],
        "pregunta": (it.pregunta or "")[:5000],
        "opciones": [{"label": o.label[:200], "description": o.description} for o in it.opciones],
        "multiselect": bool(it.multiselect),
    } for it in items]
    primera = preguntas[0]
    p = PreguntaClaude(
        preguntas=json.dumps(preguntas, ensure_ascii=False),
        # resumen / compat: 1ª pregunta
        header=primera["header"],
        pregunta=primera["pregunta"],
        opciones=json.dumps(primera["opciones"], ensure_ascii=False),
        multiselect=primera["multiselect"],
        contexto=(body.contexto or None) and body.contexto[:5000],
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    try:
        push.notificar_pregunta_claude_async(p.id, primera["header"], primera["pregunta"],
                                              len(primera["opciones"]), len(preguntas))
    except Exception as e:
        print(f"[PREGUNTA-CLAUDE] push falló: {type(e).__name__}: {e}")
    return {"mode": "remote", "id": p.id}


@router.get("/pregunta-claude/{pregunta_id}")
def poll_pregunta_claude(
    pregunta_id: int,
    x_mirror_token: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Long-poll del MCP: devuelve estado + respuestas. Cuando estado ==
    'respondida', `respuestas` es la lista alineada con las preguntas y `elegida`
    el resumen legible. Auth: token global."""
    _check_token(x_mirror_token)
    p = db.get(PreguntaClaude, pregunta_id)
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No existe esa pregunta")
    from app.services.preguntas_claude import _parse_json_list, _preguntas_de
    return {
        "id": p.id,
        "estado": p.estado,
        "elegida": p.elegida,
        "respuestas": _parse_json_list(p.respuestas) if p.respuestas else None,
        "preguntas": _preguntas_de(p),
    }


class GuardCheckIn(BaseModel):
    content: str = ""


@router.post("/guard-check")
def guard_check(body: GuardCheckIn, x_mirror_token: str | None = Header(None)):
    """Guardia semántica de salida de Camila. El outbound-guard del bot manda acá cada
    mensaje que está por enviar (que pasó los patrones); devolvemos {block: bool}. Si el
    switch está apagado, no llama a la IA (block=false). Auth: token global de ingest."""
    _check_token(x_mirror_token)
    from app.services import camila_guard
    if not camila_guard.habilitado():
        return {"block": False, "enabled": False}
    # Hoy sólo el bot de Etiguel llega acá (token global) → el costo se atribuye a 'etiguel'.
    return {"block": camila_guard.es_interno(body.content, source="etiguel"), "enabled": True}
