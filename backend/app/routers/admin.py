"""Capa de administración cross-tenant. Solo super-admin.

Alimenta la app Android de administración: ver todos los clientes (tenants)
de Prospia con sus KPIs, el detalle de stats de cualquiera, y los
totales agregados. Etiguel (que vive en Monday, no en esta base) se suma
como una "fuente" más en la Fase 4 vía un adapter."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import extract, func
from sqlalchemy.orm import Session

from app.core.deps import get_superadmin
from app.database import get_db
from app.models.device import Device
from app.models.historial import ProspectHistorial
from app.models.prospect import Prospect
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.admin import AdminOverview, ClienteResumen, DeviceIn, EventoOut
from app.schemas.dashboard import DashboardStats
from app.services.stats import compute_stats

# Tipos de historial que se muestran como "avisos" (y disparan push)
EVENTO_TIPOS = ("en_conversacion", "interesado")

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(get_superadmin)])


def _conteos_por_tenant(db: Session, estado: str | None = None, solo_mes: bool = False):
    """Devuelve {tenant_id: count} de prospects, con filtros opcionales."""
    q = db.query(Prospect.tenant_id, func.count(Prospect.id)).group_by(Prospect.tenant_id)
    if estado is not None:
        q = q.filter(Prospect.estado == estado)
    if solo_mes:
        hoy = date.today()
        q = q.filter(
            extract("year", Prospect.created_at) == hoy.year,
            extract("month", Prospect.created_at) == hoy.month,
        )
    return dict(q.all())


@router.get("/clientes", response_model=list[ClienteResumen])
def listar_clientes(db: Session = Depends(get_db)):
    tenants = db.query(Tenant).order_by(Tenant.nombre).all()

    totales       = _conteos_por_tenant(db)
    en_conv       = _conteos_por_tenant(db, estado="en_conversacion")
    interesados   = _conteos_por_tenant(db, estado="interesado")
    interes_mes   = _conteos_por_tenant(db, estado="interesado", solo_mes=True)
    ultimos = dict(
        db.query(Prospect.tenant_id, func.max(Prospect.created_at))
        .group_by(Prospect.tenant_id)
        .all()
    )

    return [
        ClienteResumen(
            tenant_id=t.id,
            nombre=t.nombre,
            slug=t.slug,
            total_prospects=totales.get(t.id, 0),
            en_conversacion=en_conv.get(t.id, 0),
            interesados=interesados.get(t.id, 0),
            interesados_mes=interes_mes.get(t.id, 0),
            ultimo_prospect=ultimos.get(t.id),
        )
        for t in tenants
    ]


@router.get("/clientes/{tenant_id}/stats", response_model=DashboardStats)
def stats_cliente(tenant_id: int, db: Session = Depends(get_db)):
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    return compute_stats(db, tenant_id)


@router.get("/overview", response_model=AdminOverview)
def overview(db: Session = Depends(get_db)):
    hoy = date.today()
    total_clientes = db.query(func.count(Tenant.id)).scalar() or 0
    total_prospects = db.query(func.count(Prospect.id)).scalar() or 0
    en_conv = (
        db.query(func.count(Prospect.id))
        .filter(Prospect.estado == "en_conversacion")
        .scalar() or 0
    )
    interesados = (
        db.query(func.count(Prospect.id))
        .filter(Prospect.estado == "interesado")
        .scalar() or 0
    )
    interes_mes = (
        db.query(func.count(Prospect.id))
        .filter(
            Prospect.estado == "interesado",
            extract("year", Prospect.created_at) == hoy.year,
            extract("month", Prospect.created_at) == hoy.month,
        )
        .scalar() or 0
    )
    return AdminOverview(
        total_clientes=total_clientes,
        total_prospects=total_prospects,
        en_conversacion=en_conv,
        interesados=interesados,
        interesados_mes=interes_mes,
    )


@router.post("/devices", status_code=status.HTTP_204_NO_CONTENT)
def registrar_device(
    body: DeviceIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_superadmin),
):
    """La app registra su push token de Expo. Idempotente: si el token ya existe
    se actualiza el dueño/plataforma en vez de duplicar."""
    device = db.query(Device).filter(Device.expo_token == body.expo_token).first()
    if device:
        device.user_id = current_user.id
        device.platform = body.platform
    else:
        db.add(Device(expo_token=body.expo_token, user_id=current_user.id, platform=body.platform))
    db.commit()


@router.get("/eventos", response_model=list[EventoOut])
def listar_eventos(db: Session = Depends(get_db), limit: int = 100):
    """Feed de avisos: primeras respuestas e interesados de todos los clientes,
    más recientes primero. Alimenta la pantalla de Avisos (y es el respaldo por
    si te perdiste el push)."""
    limit = max(1, min(limit, 300))
    rows = (
        db.query(ProspectHistorial, Prospect.nombre, Tenant.id, Tenant.nombre)
        .join(Prospect, ProspectHistorial.prospect_id == Prospect.id)
        .join(Tenant, ProspectHistorial.tenant_id == Tenant.id)
        .filter(ProspectHistorial.tipo.in_(EVENTO_TIPOS))
        .order_by(ProspectHistorial.fecha.desc())
        .limit(limit)
        .all()
    )
    return [
        EventoOut(
            id=h.id,
            fecha=h.fecha,
            tipo=h.tipo,
            tenant_id=tid,
            cliente=tnombre,
            prospect_id=h.prospect_id,
            prospect_nombre=pnombre,
            detalle=h.detalle,
        )
        for h, pnombre, tid, tnombre in rows
    ]
