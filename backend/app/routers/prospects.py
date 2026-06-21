from __future__ import annotations
import threading

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.database import get_db
from app.models.historial import ProspectHistorial
from app.models.mensaje import ProspectMensaje
from app.models.prospect import ESTADOS, Prospect
from app.models.user import User
from app.schemas.prospect import AgendarContactoBody, ChatLogBody, HistorialCreate, HistorialOut, HistorialUpdate, InteresResumenBody, MensajeOut, ProspectClasificacionUpdate, ProspectEstadoUpdate, ProspectOut, ProspectsPage
from app.services import contact as contact_service
from app.services import push

router = APIRouter(prefix="/prospects", tags=["prospects"])


def _enrich(p: Prospect) -> ProspectOut:
    out = ProspectOut.model_validate(p)
    out.termino_texto = p.termino.texto if p.termino else None
    out.rubro_nombre = p.rubro.nombre if p.rubro else None
    out.cant_mensajes = len(p.mensajes)
    return out


def _validar_webhook_tenant(db: Session, prospect: Prospect, x_webhook_token: str):
    """Aísla el webhook por tenant: el token recibido tiene que coincidir con el
    webhook_token configurado en el tenant DUEÑO del prospect. Así el token de un
    cliente no sirve para tocar prospects de otro (gap G1)."""
    from app.models.tenant import TenantConfig
    config = db.query(TenantConfig).filter(TenantConfig.tenant_id == prospect.tenant_id).first()
    if not config or not config.webhook_token or x_webhook_token != config.webhook_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token inválido")


def _tenant_id_por_token(db: Session, x_webhook_token: str) -> int:
    """Resuelve el tenant dueño de un webhook_token. Lo usa el chat-log, que llega
    solo con teléfono (no con prospect_id), así que primero identificamos el tenant
    por su token y después buscamos el prospect dentro de ese tenant."""
    from app.models.tenant import TenantConfig
    config = (
        db.query(TenantConfig)
        .filter(TenantConfig.webhook_token == x_webhook_token)
        .first()
    )
    if not config or not x_webhook_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token inválido")
    return config.tenant_id


def _norm_telefono(valor: str | None) -> str:
    """Normaliza a solo dígitos y se queda con los últimos 10 (núcleo del número,
    sin prefijos de país/celular que varían: +54, 9, 0, 15). Sirve para machear el
    teléfono que reporta WhatsApp contra el whatsapp guardado del prospect, que
    puede estar cargado en formatos distintos."""
    digitos = "".join(c for c in (valor or "") if c.isdigit())
    return digitos[-10:] if len(digitos) >= 10 else digitos


def _buscar_prospect_por_telefono(db: Session, tenant_id: int, telefono: str) -> Prospect | None:
    objetivo = _norm_telefono(telefono)
    if not objetivo:
        return None
    candidatos = (
        db.query(Prospect)
        .filter(Prospect.tenant_id == tenant_id)
        .filter((Prospect.whatsapp.isnot(None)) | (Prospect.telefono.isnot(None)))
        .all()
    )
    for p in candidatos:
        if _norm_telefono(p.whatsapp) == objetivo or _norm_telefono(p.telefono) == objetivo:
            return p
    return None


@router.get("", response_model=ProspectsPage)
def list_prospects(
    estado: str | None = Query(None),
    termino_id: int | None = Query(None),
    rubro_id: int | None = Query(None),
    mes: str | None = Query(None),  # YYYY-MM: filtra por mes de created_at
    q: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Prospect).filter(Prospect.tenant_id == current_user.tenant_id)

    if estado:
        query = query.filter(Prospect.estado == estado)
    if termino_id:
        query = query.filter(Prospect.termino_id == termino_id)
    if rubro_id:
        query = query.filter(Prospect.rubro_id == rubro_id)
    if mes:
        query = query.filter(func.to_char(Prospect.created_at, "YYYY-MM") == mes)
    if q:
        like = f"%{q}%"
        query = query.filter(
            Prospect.nombre.ilike(like)
            | Prospect.email.ilike(like)
            | Prospect.url.ilike(like)
        )

    total = query.count()
    items = (
        query.order_by(Prospect.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return ProspectsPage(
        items=[_enrich(p) for p in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.patch("/{prospect_id}/clasificacion", response_model=ProspectOut)
def update_clasificacion(
    prospect_id: int,
    body: ProspectClasificacionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    prospect = db.get(Prospect, prospect_id)
    if not prospect or prospect.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Prospect no encontrado")
    if body.clasificacion is not None:
        prospect.clasificacion = body.clasificacion
    if body.clasificacion_detalle is not None:
        prospect.clasificacion_detalle = body.clasificacion_detalle
    if body.clasificacion_verificada is not None:
        prospect.clasificacion_verificada = body.clasificacion_verificada
    db.commit()
    db.refresh(prospect)
    return _enrich(prospect)


@router.patch("/{prospect_id}/estado", response_model=ProspectOut)
def update_estado(
    prospect_id: int,
    body: ProspectEstadoUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.estado not in ESTADOS:
        raise HTTPException(status_code=400, detail=f"Estado inválido. Válidos: {ESTADOS}")
    prospect = db.get(Prospect, prospect_id)
    if not prospect or prospect.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Prospect no encontrado")

    if prospect.estado != body.estado:
        entry = ProspectHistorial(
            prospect_id=prospect.id,
            tenant_id=prospect.tenant_id,
            tipo="estado_cambiado",
            detalle=f"{prospect.estado} → {body.estado}",
        )
        db.add(entry)
        prospect.estado = body.estado

    db.commit()
    db.refresh(prospect)
    return _enrich(prospect)


@router.post("/{prospect_id}/contactar")
def contactar(
    prospect_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    prospect = db.get(Prospect, prospect_id)
    if not prospect or prospect.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Prospect no encontrado")
    if not prospect.whatsapp and not prospect.email:
        raise HTTPException(status_code=400, detail="El prospect no tiene WhatsApp ni email")

    threading.Thread(
        target=contact_service.contactar_prospect,
        args=(prospect_id,),
        daemon=True,
    ).start()

    return {"ok": True, "message": "Contacto iniciado en background"}


@router.post("/{prospect_id}/en-conversacion")
def marcar_en_conversacion(
    prospect_id: int,
    x_webhook_token: str = Header(...),
    db: Session = Depends(get_db),
):
    """Endpoint para que Camila (OpenClaw) marque un prospect como en conversación."""
    prospect = db.get(Prospect, prospect_id)
    if not prospect:
        raise HTTPException(status_code=404, detail="Prospect no encontrado")

    _validar_webhook_tenant(db, prospect, x_webhook_token)

    if prospect.estado != "en_conversacion":
        entry = ProspectHistorial(
            prospect_id=prospect.id,
            tenant_id=prospect.tenant_id,
            tipo="en_conversacion",
            detalle="Cliente respondió — Camila atiende la conversación",
        )
        db.add(entry)
        prospect.estado = "en_conversacion"
        db.commit()
        push.notificar_evento_async(prospect.id, "en_conversacion")

    return {"ok": True}


@router.post("/{prospect_id}/agendar-contacto")
def agendar_contacto(
    prospect_id: int,
    body: AgendarContactoBody,
    x_webhook_token: str = Header(...),
    db: Session = Depends(get_db),
):
    """Camila agenda un callback en una fecha pedida por el cliente ("llamame el 15").
    Setea prox_contacto y pausa la cadencia; el cadence job re-encola cuando vence."""
    prospect = db.get(Prospect, prospect_id)
    if not prospect:
        raise HTTPException(status_code=404, detail="Prospect no encontrado")
    _validar_webhook_tenant(db, prospect, x_webhook_token)

    prospect.prox_contacto = body.fecha
    detalle = f"Callback agendado para {body.fecha.date().isoformat()}"
    if body.resumen:
        detalle += f" — {body.resumen}"
    db.add(ProspectHistorial(
        prospect_id=prospect.id, tenant_id=prospect.tenant_id,
        tipo="callback_agendado", detalle=detalle,
    ))
    db.commit()
    return {"ok": True, "prox_contacto": body.fecha.isoformat()}


@router.post("/{prospect_id}/interesado")
def marcar_interesado(
    prospect_id: int,
    body: InteresResumenBody,
    x_webhook_token: str = Header(...),
    db: Session = Depends(get_db),
):
    """Camila marca al prospect como interesado, con el resumen de la charla."""
    prospect = db.get(Prospect, prospect_id)
    if not prospect:
        raise HTTPException(status_code=404, detail="Prospect no encontrado")
    _validar_webhook_tenant(db, prospect, x_webhook_token)

    ya_interesado = prospect.estado == "interesado"
    prospect.estado = "interesado"
    prospect.prox_contacto = None  # ya no aplica cadencia
    db.add(ProspectHistorial(
        prospect_id=prospect.id, tenant_id=prospect.tenant_id,
        tipo="interesado", detalle=body.resumen or "Cliente interesado (sin resumen)",
    ))
    db.commit()
    if not ya_interesado:
        push.notificar_evento_async(prospect.id, "interesado", body.resumen)
    return {"ok": True}


@router.post("/{prospect_id}/no-interesa")
def marcar_no_interesa(
    prospect_id: int,
    body: InteresResumenBody,
    x_webhook_token: str = Header(...),
    db: Session = Depends(get_db),
):
    """Camila marca al prospect como no interesado, con el resumen de la charla."""
    prospect = db.get(Prospect, prospect_id)
    if not prospect:
        raise HTTPException(status_code=404, detail="Prospect no encontrado")
    _validar_webhook_tenant(db, prospect, x_webhook_token)

    prospect.estado = "no_le_interesa"
    prospect.prox_contacto = None
    db.add(ProspectHistorial(
        prospect_id=prospect.id, tenant_id=prospect.tenant_id,
        tipo="no_le_interesa", detalle=body.resumen or "Cliente no interesado (sin resumen)",
    ))
    db.commit()
    return {"ok": True}


@router.get("/{prospect_id}/historial", response_model=list[HistorialOut])
def get_historial(
    prospect_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    prospect = db.get(Prospect, prospect_id)
    if not prospect or prospect.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Prospect no encontrado")

    return (
        db.query(ProspectHistorial)
        .filter(ProspectHistorial.prospect_id == prospect_id)
        .order_by(ProspectHistorial.fecha.desc())
        .all()
    )


@router.get("/{prospect_id}/mensajes", response_model=list[MensajeOut])
def get_mensajes(
    prospect_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Hilo de conversación WhatsApp del prospect (orden cronológico, para el chat)."""
    prospect = db.get(Prospect, prospect_id)
    if not prospect or prospect.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Prospect no encontrado")

    return (
        db.query(ProspectMensaje)
        .filter(ProspectMensaje.prospect_id == prospect_id)
        .order_by(ProspectMensaje.fecha.asc(), ProspectMensaje.id.asc())
        .all()
    )


@router.post("/chat-log")
def chat_log(
    body: ChatLogBody,
    x_webhook_token: str = Header(...),
    db: Session = Depends(get_db),
):
    """Recibe del plugin de OpenClaw cada mensaje de WhatsApp (entrante y saliente)
    para espejar la conversación. NO pasa por el LLM: es texto ya existente.

    Resuelve el tenant por el token y el prospect por teléfono. Idempotente sobre
    wa_msg_id (si viene): reintentos del plugin no duplican mensajes."""
    if body.direccion not in ("in", "out"):
        raise HTTPException(status_code=400, detail="direccion debe ser 'in' u 'out'")

    tenant_id = _tenant_id_por_token(db, x_webhook_token)

    texto = (body.texto or "").strip()
    if not texto:
        return {"ok": True, "skipped": "texto vacío"}

    prospect = _buscar_prospect_por_telefono(db, tenant_id, body.telefono)
    if not prospect:
        # No reventamos: el plugin no debe reintentar infinito por un número que no
        # está en la base (ej. un inbound puro que todavía no es prospect).
        return {"ok": False, "skipped": "prospect no encontrado para ese teléfono"}

    if body.wa_msg_id:
        existente = (
            db.query(ProspectMensaje)
            .filter(ProspectMensaje.prospect_id == prospect.id)
            .filter(ProspectMensaje.wa_msg_id == body.wa_msg_id)
            .first()
        )
        if existente:
            return {"ok": True, "duplicado": True, "id": existente.id}

    from datetime import datetime, timezone
    msg = ProspectMensaje(
        prospect_id=prospect.id,
        tenant_id=tenant_id,
        direccion=body.direccion,
        texto=texto[:4000],
        wa_msg_id=body.wa_msg_id,
        fecha=body.fecha or datetime.now(timezone.utc),
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    # Push por cada mensaje entrante (#44), respeta el toggle global + por cliente.
    if body.direccion == "in":
        try:
            push.notificar_evento_async(prospect.id, "mensaje_entrante", texto)
        except Exception:
            pass
    return {"ok": True, "id": msg.id, "prospect_id": prospect.id}


@router.post("/{prospect_id}/historial", response_model=HistorialOut, status_code=201)
def create_historial(
    prospect_id: int,
    body: HistorialCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    prospect = db.get(Prospect, prospect_id)
    if not prospect or prospect.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Prospect no encontrado")

    from datetime import datetime, timezone
    entry = ProspectHistorial(
        prospect_id=prospect_id,
        tenant_id=current_user.tenant_id,
        tipo=body.tipo,
        detalle=body.detalle,
        fecha=body.fecha or datetime.now(timezone.utc),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.patch("/historial/{entry_id}", response_model=HistorialOut)
def update_historial(
    entry_id: int,
    body: HistorialUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = db.get(ProspectHistorial, entry_id)
    if not entry or entry.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Entrada no encontrada")

    if body.tipo is not None:
        entry.tipo = body.tipo
    if body.detalle is not None:
        entry.detalle = body.detalle
    if body.fecha is not None:
        entry.fecha = body.fecha

    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/historial/{entry_id}", status_code=204)
def delete_historial(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = db.get(ProspectHistorial, entry_id)
    if not entry or entry.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Entrada no encontrada")

    db.delete(entry)
    db.commit()
