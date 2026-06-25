"""Ingesta del espejo de Etiguel (APP.7).

El webhook de Camila (otro sistema, sobre Monday) postea acá cada vez que
contacta/conversa con un lead o prospect, para que Sebi lo vea en la app sin
entrar a Monday. Autenticado con un token compartido (no JWT: es server→server),
por eso vive fuera del router /admin (que exige superadmin)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database import get_db
from app.models.agent_error import AgentError
from app.models.etiguel_mirror import EtiguelMirror, EtiguelMirrorMensaje
from app.schemas.admin import AgentErrorIn, AvisoIn, EtiguelMirrorIn
from app.services import push

router = APIRouter(prefix="/ingest", tags=["ingest"])


def _check_token(x_mirror_token: str | None):
    esperado = settings.ETIGUEL_MIRROR_TOKEN or settings.WEBHOOK_TOKEN
    if not x_mirror_token or x_mirror_token != esperado:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token inválido")


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
    db.commit()

    # ── Push diferenciado de Etiguel (#44), respetando los toggles por cliente ──
    try:
        # Mensaje entrante nuevo: el 1° 'in' = primera respuesta; los siguientes = mensaje entrante.
        # n_in cuenta los inbounds PREVIOS (no el actual), así que primera
        # respuesta ⇔ n_in == 0. Usar <= 1 disparaba "respuesta" también en el
        # 2° mensaje (n_in==1) → push duplicado.
        if agregado and body.direccion == "in":
            evento = "respuesta" if n_in == 0 else "mensaje_entrante"
            push.notificar_evento_etiguel_async(evento, nombre_lead or "un lead", body.texto)
        # Transición de estado a "interesado".
        nuevo = (body.estado or "")
        if nuevo and "interes" in nuevo.lower() and "interes" not in (estado_anterior or "").lower():
            push.notificar_evento_etiguel_async("interesado", nombre_lead or "un lead", None)
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
        push.notificar_aviso_async(body.title[:120], body.body[:300], data)
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
    x_mirror_token: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Lista de errores para que Claude levante la cola. Auth: token.
    Con `?estado=reportado` devuelve solo la cola que Sebi marcó para revisar."""
    _check_token(x_mirror_token)
    q = db.query(AgentError)
    if estado:
        q = q.filter(AgentError.estado == estado)
    errs = q.order_by(AgentError.fecha.desc()).all()
    return [
        {
            "id": e.id, "estado": e.estado, "fuente": e.fuente, "agente": e.agente,
            "telefono": e.telefono, "patron": e.patron, "contenido": e.contenido,
            "fecha": e.fecha.isoformat() if e.fecha else None,
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
    """Cambia el estado de un error. Lo usa Claude para marcar `fixed` cuando
    soluciona un error de la cola reportada. Auth: token. Body: {"estado": "fixed"}."""
    _check_token(x_mirror_token)
    err = db.get(AgentError, error_id)
    if not err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No existe ese error")
    estado = (body or {}).get("estado")
    if estado not in ("nuevo", "reportado", "fixed"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f"estado inválido: {estado}")
    err.estado = estado
    err.resuelto = (estado == "fixed")
    db.commit()
    return {"ok": True, "id": error_id, "estado": estado}


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
