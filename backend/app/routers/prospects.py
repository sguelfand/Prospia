from __future__ import annotations
import threading

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.database import get_db
from app.models.historial import ProspectHistorial
from app.models.prospect import ESTADOS, Prospect
from app.models.user import User
from app.schemas.prospect import AgendarContactoBody, HistorialCreate, HistorialOut, HistorialUpdate, InteresResumenBody, ProspectClasificacionUpdate, ProspectEstadoUpdate, ProspectOut, ProspectsPage
from app.services import contact as contact_service

router = APIRouter(prefix="/prospects", tags=["prospects"])


def _enrich(p: Prospect) -> ProspectOut:
    out = ProspectOut.model_validate(p)
    out.termino_texto = p.termino.texto if p.termino else None
    out.rubro_nombre = p.rubro.nombre if p.rubro else None
    return out


def _validar_webhook_tenant(db: Session, prospect: Prospect, x_webhook_token: str):
    """Aísla el webhook por tenant: el token recibido tiene que coincidir con el
    webhook_token configurado en el tenant DUEÑO del prospect. Así el token de un
    cliente no sirve para tocar prospects de otro (gap G1)."""
    from app.models.tenant import TenantConfig
    config = db.query(TenantConfig).filter(TenantConfig.tenant_id == prospect.tenant_id).first()
    if not config or not config.webhook_token or x_webhook_token != config.webhook_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token inválido")


@router.get("", response_model=ProspectsPage)
def list_prospects(
    estado: str | None = Query(None),
    termino_id: int | None = Query(None),
    rubro_id: int | None = Query(None),
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

    prospect.estado = "interesado"
    prospect.prox_contacto = None  # ya no aplica cadencia
    db.add(ProspectHistorial(
        prospect_id=prospect.id, tenant_id=prospect.tenant_id,
        tipo="interesado", detalle=body.resumen or "Cliente interesado (sin resumen)",
    ))
    db.commit()
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
