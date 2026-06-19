"""Capa de administración cross-tenant. Solo super-admin.

Alimenta la app Android de administración: ver todos los clientes (tenants)
de Prospia con sus KPIs, el detalle de stats de cualquiera, y los
totales agregados. Etiguel (que vive en Monday, no en esta base) se suma
como una "fuente" más en la Fase 4 vía un adapter."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, extract, func
from sqlalchemy.orm import Session

from app.core.auth import hash_password
from app.core.deps import get_superadmin
from app.database import get_db
from app.models.agent_error import AgentError
from app.models.device import Device
from app.models.etiguel_mirror import EtiguelMirror, EtiguelMirrorMensaje
from app.models.historial import ProspectHistorial
from app.models.mensaje import ProspectMensaje
from app.models.pendiente import Pendiente
from app.models.prospect import ESTADOS, Prospect
from app.models.push_mute import PushMute
from app.models.rubro import Rubro
from app.models.tenant import Tenant, TenantConfig
from app.models.termino import Termino
from app.models.user import User
from app.routers.prospects import _enrich
from app.schemas.admin import (
    AdminOverview,
    AgentErrorOut,
    AgentErrorResolve,
    ClienteComparativa,
    ClienteConfigOut,
    ClienteConfigUpdate,
    ClienteResumen,
    DashboardComparativa,
    DeviceIn,
    EtiguelLead,
    EtiguelMirrorItem,
    EtiguelMirrorMensajeOut,
    EventoOut,
    FiltrosCliente,
    OpcionFiltro,
    PendienteIn,
    PendienteOut,
    PendienteUpdate,
    PushPrefIn,
    PushPrefOut,
    ResetPasswordOut,
)
from app.schemas.dashboard import DashboardStats
from app.schemas.prospect import HistorialOut, MensajeOut, ProspectsPage
from app.services import etiguel_monday
from app.services import push
from app.services.stats import compute_stats

import logging

log = logging.getLogger("admin")

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

    clientes = [
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

    # Etiguel (Monday) como un cliente más. Si Monday falla, no rompe la lista.
    if etiguel_monday.enabled():
        try:
            clientes.append(etiguel_monday.get_resumen())
        except Exception as e:
            log.warning("No se pudo traer el resumen de Etiguel desde Monday: %s", e)

    return clientes


@router.get("/clientes/{tenant_id}/stats", response_model=DashboardStats)
def stats_cliente(tenant_id: int, db: Session = Depends(get_db)):
    if tenant_id == etiguel_monday.ETIGUEL_TENANT_ID:
        if not etiguel_monday.enabled():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Etiguel no disponible")
        return etiguel_monday.get_stats()
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    return compute_stats(db, tenant_id)


def _tenant_prospia(db: Session, tenant_id: int) -> Tenant:
    """Valida que el tenant exista y sea de Prospia (no Etiguel). Las vistas de
    prospects/mensajes/historial por ahora son solo Prospia; Etiguel va por su
    propio camino (espejo, ver APP.7 en implementaciones-pendientes)."""
    if tenant_id == etiguel_monday.ETIGUEL_TENANT_ID:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El listado de prospects de Etiguel todavía no está disponible.",
        )
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    return tenant


@router.get("/clientes/{tenant_id}/prospects", response_model=ProspectsPage)
def prospects_cliente(
    tenant_id: int,
    estado: str | None = Query(None),
    termino_id: int | None = Query(None),
    rubro_id: int | None = Query(None),
    mes: str | None = Query(None),  # YYYY-MM: filtra por mes de created_at
    q: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """Listado paginado de prospects de un cliente (cualquier tenant), con los
    mismos filtros que la vista del cliente. Alimenta APP.2 (vista por cliente)."""
    _tenant_prospia(db, tenant_id)

    query = db.query(Prospect).filter(Prospect.tenant_id == tenant_id)
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


@router.get("/clientes/{tenant_id}/filtros", response_model=FiltrosCliente)
def filtros_cliente(tenant_id: int, db: Session = Depends(get_db)):
    """Opciones para el botón 'Filtrar' de la vista de cliente: estados (fijos),
    términos y rubros del tenant, y los meses con prospects."""
    _tenant_prospia(db, tenant_id)

    terminos = (
        db.query(Termino)
        .filter(Termino.tenant_id == tenant_id)
        .order_by(Termino.texto)
        .all()
    )
    rubros = (
        db.query(Rubro)
        .filter(Rubro.tenant_id == tenant_id)
        .order_by(Rubro.nombre)
        .all()
    )
    meses = [
        m for (m,) in db.query(func.to_char(Prospect.created_at, "YYYY-MM"))
        .filter(Prospect.tenant_id == tenant_id)
        .distinct()
        .order_by(func.to_char(Prospect.created_at, "YYYY-MM").desc())
        .all()
        if m
    ]
    return FiltrosCliente(
        estados=list(ESTADOS),
        terminos=[OpcionFiltro(id=t.id, label=t.texto) for t in terminos],
        rubros=[OpcionFiltro(id=r.id, label=r.nombre) for r in rubros],
        meses=meses,
    )


def _prospect_de_tenant(db: Session, tenant_id: int, prospect_id: int) -> Prospect:
    _tenant_prospia(db, tenant_id)
    prospect = db.get(Prospect, prospect_id)
    if not prospect or prospect.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prospect no encontrado")
    return prospect


@router.get(
    "/clientes/{tenant_id}/prospects/{prospect_id}/mensajes",
    response_model=list[MensajeOut],
)
def mensajes_prospect(tenant_id: int, prospect_id: int, db: Session = Depends(get_db)):
    """Hilo de conversación con Camila (espejo WhatsApp) de un prospect, en orden
    cronológico. Variante admin de /prospects/{id}/mensajes. Alimenta APP.3."""
    _prospect_de_tenant(db, tenant_id, prospect_id)
    return (
        db.query(ProspectMensaje)
        .filter(ProspectMensaje.prospect_id == prospect_id)
        .order_by(ProspectMensaje.fecha.asc(), ProspectMensaje.id.asc())
        .all()
    )


@router.get(
    "/clientes/{tenant_id}/prospects/{prospect_id}/historial",
    response_model=list[HistorialOut],
)
def historial_prospect(tenant_id: int, prospect_id: int, db: Session = Depends(get_db)):
    """Historial de cambios de estado/eventos de un prospect. Variante admin de
    /prospects/{id}/historial. Alimenta APP.3."""
    _prospect_de_tenant(db, tenant_id, prospect_id)
    return (
        db.query(ProspectHistorial)
        .filter(ProspectHistorial.prospect_id == prospect_id)
        .order_by(ProspectHistorial.fecha.desc())
        .all()
    )


# ── Admin clientes: ver/editar config esencial + reset password (nivel 1) ──
DEFAULT_PASSWORD = "12345"  # pass por defecto; el cliente la cambia desde Configuración


def _user_principal(db: Session, tenant_id: int) -> User | None:
    """Usuario de login del cliente: el primero (por id) del tenant. Hoy cada
    cliente tiene uno; si en el futuro hay varios, se elige el más antiguo."""
    return (
        db.query(User)
        .filter(User.tenant_id == tenant_id)
        .order_by(User.id.asc())
        .first()
    )


def _config_de(db: Session, tenant_id: int) -> TenantConfig:
    """TenantConfig del cliente, creándolo si no existe."""
    cfg = db.query(TenantConfig).filter(TenantConfig.tenant_id == tenant_id).first()
    if not cfg:
        cfg = TenantConfig(tenant_id=tenant_id)
        db.add(cfg)
        db.flush()
    return cfg


@router.get("/clientes/{tenant_id}/config", response_model=ClienteConfigOut)
def get_cliente_config(tenant_id: int, db: Session = Depends(get_db)):
    """Config esencial de un cliente para el editor de Admin clientes."""
    tenant = _tenant_prospia(db, tenant_id)
    cfg = _config_de(db, tenant_id)
    db.commit()
    user = _user_principal(db, tenant_id)
    return ClienteConfigOut(
        tenant_id=tenant.id,
        nombre=tenant.nombre,
        slug=tenant.slug,
        user_id=user.id if user else None,
        usuario=user.email if user else None,
        user_nombre=user.nombre if user else None,
        negocio_nombre=cfg.negocio_nombre,
        negocio_que_vende=cfg.negocio_que_vende,
        negocio_propuesta_valor=cfg.negocio_propuesta_valor,
        negocio_zona=cfg.negocio_zona,
        pais=cfg.pais,
        sitio_web=cfg.sitio_web,
        deriva_nombre=cfg.deriva_nombre,
        deriva_whatsapp=cfg.deriva_whatsapp,
    )


@router.put("/clientes/{tenant_id}/config", response_model=ClienteConfigOut)
def update_cliente_config(
    tenant_id: int, body: ClienteConfigUpdate, db: Session = Depends(get_db)
):
    """Guarda los datos esenciales del cliente (nombre, usuario, negocio/contacto)."""
    tenant = _tenant_prospia(db, tenant_id)
    cfg = _config_de(db, tenant_id)
    user = _user_principal(db, tenant_id)

    if body.nombre is not None and body.nombre.strip():
        tenant.nombre = body.nombre.strip()

    if body.usuario is not None and user:
        nuevo = body.usuario.strip().lower()
        if nuevo and nuevo != user.email:
            tomado = (
                db.query(User)
                .filter(User.email == nuevo, User.id != user.id)
                .first()
            )
            if tomado:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ese usuario ya está en uso")
            user.email = nuevo
    if body.user_nombre is not None and user:
        user.nombre = body.user_nombre.strip() or None

    for campo in (
        "negocio_nombre", "negocio_que_vende", "negocio_propuesta_valor",
        "negocio_zona", "pais", "sitio_web", "deriva_nombre", "deriva_whatsapp",
    ):
        val = getattr(body, campo)
        if val is not None:
            v = val.strip()
            setattr(cfg, campo, v or None)

    db.commit()
    return get_cliente_config(tenant_id, db)


@router.post("/clientes/{tenant_id}/reset-password", response_model=ResetPasswordOut)
def reset_cliente_password(tenant_id: int, db: Session = Depends(get_db)):
    """Resetea la contraseña del cliente a la default (12345)."""
    _tenant_prospia(db, tenant_id)
    user = _user_principal(db, tenant_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="El cliente no tiene usuario")
    user.password_hash = hash_password(DEFAULT_PASSWORD)
    db.commit()
    return ResetPasswordOut(password=DEFAULT_PASSWORD)


@router.get("/etiguel/leads", response_model=list[EtiguelLead])
def etiguel_leads():
    """Leads de Etiguel (Monday) filtrados: fecha > 2026-05-01 y estado ∉
    {Cancelado, Rechazado}. Solo lectura."""
    if not etiguel_monday.enabled():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Etiguel no disponible")
    try:
        return etiguel_monday.get_leads()
    except Exception as e:
        log.warning("No se pudieron traer los leads de Etiguel: %s", e)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Error consultando Monday")


@router.get("/etiguel/mirror", response_model=list[EtiguelMirrorItem])
def etiguel_mirror(tipo: str | None = Query(None), db: Session = Depends(get_db)):
    """Leads/prospects de Etiguel que Camila contactó, espejados a la app (APP.7).
    Ordenados por última actividad (más reciente arriba). `tipo` opcional filtra
    'lead' o 'prospect'."""
    q = db.query(EtiguelMirror)
    if tipo in ("lead", "prospect"):
        q = q.filter(EtiguelMirror.tipo == tipo)
    items = q.order_by(EtiguelMirror.ultima_actividad.desc()).all()
    return [
        EtiguelMirrorItem(
            id=m.id,
            tipo=m.tipo,
            item_id=m.item_id,
            nombre=m.nombre,
            telefono=m.telefono,
            email=m.email,
            estado=m.estado,
            ultima_actividad=m.ultima_actividad,
            cant_mensajes=len(m.mensajes),
        )
        for m in items
    ]


@router.get("/etiguel/mirror/{mirror_id}/mensajes", response_model=list[EtiguelMirrorMensajeOut])
def etiguel_mirror_mensajes(mirror_id: int, db: Session = Depends(get_db)):
    """Conversación de Camila con un item espejado de Etiguel (orden cronológico)."""
    mirror = db.get(EtiguelMirror, mirror_id)
    if not mirror:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No encontrado")
    return (
        db.query(EtiguelMirrorMensaje)
        .filter(EtiguelMirrorMensaje.mirror_id == mirror_id)
        .order_by(EtiguelMirrorMensaje.fecha.asc(), EtiguelMirrorMensaje.id.asc())
        .all()
    )


@router.get("/errores", response_model=list[AgentErrorOut])
def listar_errores(incluir_resueltos: bool = Query(True), db: Session = Depends(get_db)):
    """Errores de Camila capturados por el outbound-guard, más reciente arriba.
    El `id` es el #número con el que Sebi los identifica."""
    q = db.query(AgentError)
    if not incluir_resueltos:
        q = q.filter(AgentError.resuelto.is_(False))
    return q.order_by(AgentError.fecha.desc()).all()


@router.patch("/errores/{error_id}", response_model=AgentErrorOut)
def resolver_error(error_id: int, body: AgentErrorResolve, db: Session = Depends(get_db)):
    """Marca/desmarca un error como resuelto (el tilde de la app)."""
    err = db.get(AgentError, error_id)
    if not err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No existe ese error")
    err.resuelto = body.resuelto
    db.commit()
    db.refresh(err)
    return err


@router.delete("/errores/{error_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_error(error_id: int, db: Session = Depends(get_db)):
    """Borra un error desde la app (swipe). Variante superadmin del DELETE de
    ingest (que usa token para que lo borre Claude)."""
    err = db.get(AgentError, error_id)
    if err:
        db.delete(err)
        db.commit()


# ── Pendientes (tracker cross-proyecto desde la app) ─────────────────────────
@router.get("/pendientes", response_model=list[PendienteOut])
def listar_pendientes(
    incluir_hechos: bool = Query(False),
    area: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Lista de pendientes. Por defecto solo los NO hechos. Orden: prioridad
    (alta→baja) y luego más reciente arriba."""
    q = db.query(Pendiente)
    if not incluir_hechos:
        q = q.filter(Pendiente.hecho.is_(False))
    if area:
        q = q.filter(Pendiente.area == area)
    orden = case(
        (Pendiente.prioridad == "alta", 0),
        (Pendiente.prioridad == "media", 1),
        (Pendiente.prioridad == "baja", 2),
        else_=3,
    )
    return q.order_by(orden, Pendiente.fecha.desc()).all()


@router.post("/pendientes", response_model=PendienteOut, status_code=status.HTTP_201_CREATED)
def crear_pendiente(body: PendienteIn, db: Session = Depends(get_db)):
    """Alta manual de un pendiente desde la app o la web (texto + prioridad +
    área + campos ricos opcionales)."""
    def _clean(v):
        v = (v or "").strip()
        return v or None
    p = Pendiente(
        texto=body.texto.strip(),
        prioridad=body.prioridad if body.prioridad in ("alta", "media", "baja") else "media",
        area=body.area if body.area in ("app", "web", "etiguel") else "app",
        contexto=_clean(body.contexto),
        que_armar=_clean(body.que_armar),
        consideraciones=_clean(body.consideraciones),
        depende=_clean(body.depende),
        alcance=_clean(body.alcance),
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@router.patch("/pendientes/{pendiente_id}", response_model=PendienteOut)
def editar_pendiente(pendiente_id: int, body: PendienteUpdate, db: Session = Depends(get_db)):
    """Edita un pendiente (texto/prioridad/área) o lo marca hecho."""
    p = db.get(Pendiente, pendiente_id)
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No existe ese pendiente")
    if body.texto is not None:
        p.texto = body.texto.strip()
    if body.prioridad in ("alta", "media", "baja"):
        p.prioridad = body.prioridad
    if body.area in ("app", "web", "etiguel"):
        p.area = body.area
    if body.hecho is not None:
        p.hecho = body.hecho
    # Campos ricos: si vienen en el body (no None), se actualizan; "" → NULL.
    for campo in ("contexto", "que_armar", "consideraciones", "depende", "alcance"):
        val = getattr(body, campo)
        if val is not None:
            setattr(p, campo, val.strip() or None)
    db.commit()
    db.refresh(p)
    return p


@router.delete("/pendientes/{pendiente_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_pendiente(pendiente_id: int, db: Session = Depends(get_db)):
    p = db.get(Pendiente, pendiente_id)
    if p:
        db.delete(p)
        db.commit()


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
    # Sumar Etiguel a los totales (si Monday responde).
    if etiguel_monday.enabled():
        try:
            e = etiguel_monday.get_resumen()
            total_clientes += 1
            total_prospects += e.total_prospects
            en_conv += e.en_conversacion
            interesados += e.interesados
            interes_mes += e.interesados_mes
        except Exception as ex:
            log.warning("No se pudo sumar Etiguel al overview: %s", ex)

    return AdminOverview(
        total_clientes=total_clientes,
        total_prospects=total_prospects,
        en_conversacion=en_conv,
        interesados=interesados,
        interesados_mes=interes_mes,
    )


# Estados que cuentan como "contactado" (el prospect ya salió de la cola) y como
# "respondió" (pasó de contactado). Sirven para las tasas del dashboard.
_CONTACTADOS = ("contactado", "en_conversacion", "interesado", "no_le_interesa", "cancelado")
_RESPONDIERON = ("en_conversacion", "interesado", "no_le_interesa")


@router.get("/comparativa", response_model=DashboardComparativa)
def comparativa(db: Session = Depends(get_db)):
    """Métricas comparables de todos los clientes en un solo request, para el
    dashboard (APP.6). Una query agrupada (tenant, estado) + cálculo en Python."""
    # conteos (tenant_id, estado) -> count
    rows = (
        db.query(Prospect.tenant_id, Prospect.estado, func.count(Prospect.id))
        .group_by(Prospect.tenant_id, Prospect.estado)
        .all()
    )
    por_tenant: dict[int, dict[str, int]] = {}
    for tid, estado, count in rows:
        por_tenant.setdefault(tid, {})[estado] = count

    interes_mes = _conteos_por_tenant(db, estado="interesado", solo_mes=True)

    clientes: list[ClienteComparativa] = []
    tot_prospects = tot_conv = tot_interes = tot_interes_mes = 0

    for t in db.query(Tenant).order_by(Tenant.nombre).all():
        estados = por_tenant.get(t.id, {})
        total = sum(estados.values())
        contactados = sum(estados.get(e, 0) for e in _CONTACTADOS)
        respondieron = sum(estados.get(e, 0) for e in _RESPONDIERON)
        en_conv = estados.get("en_conversacion", 0)
        interes = estados.get("interesado", 0)
        i_mes = interes_mes.get(t.id, 0)

        clientes.append(ClienteComparativa(
            tenant_id=t.id,
            nombre=t.nombre,
            fuente="plataforma",
            total_prospects=total,
            contactados=contactados,
            en_conversacion=en_conv,
            interesados=interes,
            interesados_mes=i_mes,
            tasa_respuesta=round(respondieron / contactados * 100, 1) if contactados else 0.0,
            tasa_conversion=round(interes / contactados * 100, 1) if contactados else 0.0,
        ))
        tot_prospects += total
        tot_conv += en_conv
        tot_interes += interes
        tot_interes_mes += i_mes

    total_clientes = len(clientes)

    # Etiguel como un cliente más (sin tasas: Monday no expone "contactados").
    if etiguel_monday.enabled():
        try:
            e = etiguel_monday.get_resumen()
            clientes.append(ClienteComparativa(
                tenant_id=e.tenant_id,
                nombre=e.nombre,
                fuente="etiguel",
                total_prospects=e.total_prospects,
                contactados=0,
                en_conversacion=e.en_conversacion,
                interesados=e.interesados,
                interesados_mes=e.interesados_mes,
                tasa_respuesta=0.0,
                tasa_conversion=0.0,
            ))
            total_clientes += 1
            tot_prospects += e.total_prospects
            tot_conv += e.en_conversacion
            tot_interes += e.interesados
            tot_interes_mes += e.interesados_mes
        except Exception as ex:
            log.warning("No se pudo sumar Etiguel a la comparativa: %s", ex)

    return DashboardComparativa(
        total_clientes=total_clientes,
        total_prospects=tot_prospects,
        en_conversacion=tot_conv,
        interesados=tot_interes,
        interesados_mes=tot_interes_mes,
        clientes=clientes,
    )


@router.get("/clientes/{tenant_id}/push", response_model=PushPrefOut)
def get_push_pref(tenant_id: int, expo_token: str = Query(...), db: Session = Depends(get_db)):
    """Estado del push de un cliente para un device puntual. Sin fila de mute =
    activado (default). Alimenta el interruptor de la vista de cliente (APP.4)."""
    muted = (
        db.query(PushMute)
        .filter(PushMute.expo_token == expo_token, PushMute.tenant_id == tenant_id)
        .first()
    )
    return PushPrefOut(enabled=muted is None)


@router.put("/clientes/{tenant_id}/push", response_model=PushPrefOut)
def set_push_pref(tenant_id: int, body: PushPrefIn, db: Session = Depends(get_db)):
    """Activa/desactiva el push de un cliente para un device. enabled=false crea
    el mute; enabled=true lo borra. Idempotente."""
    existente = (
        db.query(PushMute)
        .filter(PushMute.expo_token == body.expo_token, PushMute.tenant_id == tenant_id)
        .first()
    )
    if body.enabled:
        if existente:
            db.delete(existente)
            db.commit()
    else:
        if not existente:
            db.add(PushMute(expo_token=body.expo_token, tenant_id=tenant_id))
            db.commit()
    return PushPrefOut(enabled=body.enabled)


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


@router.post("/test-push")
def test_push():
    """Manda una notificación de prueba a todos los devices registrados.
    Sirve para verificar el circuito de push de punta a punta."""
    n = push.enviar_prueba()
    return {"enviado_a_devices": n}


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
