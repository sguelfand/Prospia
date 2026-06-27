"""Capa de administración cross-tenant. Solo super-admin.

Alimenta la app Android de administración: ver todos los clientes (tenants)
de Prospia con sus KPIs, el detalle de stats de cualquiera, y los
totales agregados. Etiguel (que vive en Monday, no en esta base) se suma
como una "fuente" más en la Fase 4 vía un adapter."""
from datetime import date, datetime, timedelta, timezone

import requests
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, extract, func
from sqlalchemy.orm import Session

from app.core.auth import create_access_token, hash_password
from app.core.config import settings
from app.core.deps import get_superadmin
from app.database import get_db
from app.models.agent_error import AgentError
from app.models.aviso import Aviso
from app.models.consulta import Consulta
from app.models.device import Device
from app.models.etiguel_mirror import EtiguelMirror, EtiguelMirrorMensaje
from app.models.historial import ProspectHistorial
from app.models.mensaje import ProspectMensaje
from app.models.pendiente import Pendiente
from app.models.prospect import ESTADOS, Prospect
from app.models.push_mute import PushMute
from app.models.push_event_mute import PushEventMute
from app.models.push_cliente_evento import PushClienteEvento
from app.models.rubro import Rubro
from app.models.tenant import Tenant, TenantConfig
from app.models.termino import Termino
from app.models.user import User
from app.routers.prospects import _enrich
from app.schemas.admin import (
    AdminOverview,
    AgentErrorOut,
    AgentErrorResolve,
    ConsultaOut,
    ConsultaResponder,
    ConsultasEliminar,
    PreguntaClaudeOut,
    PreguntaClaudeResponder,
    PreguntasModoOut,
    PreguntasModoUpdate,
    ClienteComparativa,
    ClienteConfigOut,
    ClienteConfigUpdate,
    ClienteResumen,
    DashboardComparativa,
    DeviceIn,
    EtiguelLead,
    AvisoOut,
    AvisosEliminar,
    BloquearOut,
    BloquearProspectOut,
    EtiguelMirrorItem,
    EtiguelMirrorMensajeOut,
    EventoOut,
    FiltrosCliente,
    ImpersonateOut,
    OpcionFiltro,
    ColaIn,
    ClienteNotifPrefsOut,
    ClienteNotifPrefUpdate,
    DeviceOut,
    NotifEvento,
    NotifPrefUpdate,
    NotifPrefsOut,
    NotifyIn,
    PendienteIn,
    PendienteOut,
    PendienteUpdate,
    PushPrefIn,
    PushPrefOut,
    ResetPasswordOut,
    ResetNumeroPruebaIn,
    ResetNumeroPruebaOut,
    ResetNumeroPruebaTenantOut,
)
from app.models.intake_submission import IntakeSubmission
from app.schemas.dashboard import DashboardStats
from app.schemas.prospect import HistorialOut, MensajeOut, ProspectsPage
from app.services import etiguel_monday
from app.services import info_negocio as info_negocio_svc
from app.services import intake_ai
from app.services import push
from app.services.intake_schema import secciones_config
from app.services.stats import compute_stats

import os

from fastapi.responses import FileResponse
from pydantic import BaseModel

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


@router.get("/clientes/{tenant_id}/prospects/{prospect_id}")
def prospect_detalle(tenant_id: int, prospect_id: int, db: Session = Depends(get_db)):
    """Un prospect enriquecido (deep-link desde una push → abrir su ficha)."""
    return _enrich(_prospect_de_tenant(db, tenant_id, prospect_id))


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
        bot_numero_whatsapp=cfg.bot_numero_whatsapp,
        envio_auto_habilitado=cfg.envio_auto_habilitado,
        envio_tope_diario=cfg.envio_tope_diario,
        envio_delay_seg=cfg.envio_delay_seg,
        envio_hora_inicio=cfg.envio_hora_inicio,
        envio_hora_fin=cfg.envio_hora_fin,
        wa_templates=list(cfg.wa_templates or []),
        cadencia_dias=dict(cfg.cadencia_dias or {}),
        cadencia_max_contactos=cfg.cadencia_max_contactos,
        cadencia_dias_cancelar=cfg.cadencia_dias_cancelar,
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

    if body.password and body.password.strip() and user:
        user.password_hash = hash_password(body.password.strip())

    for campo in (
        "negocio_nombre", "negocio_que_vende", "negocio_propuesta_valor",
        "negocio_zona", "pais", "sitio_web", "deriva_nombre", "deriva_whatsapp",
        "bot_numero_whatsapp",
    ):
        val = getattr(body, campo)
        if val is not None:
            v = val.strip()
            setattr(cfg, campo, v or None)

    # Contacto/envío + cadencia (numéricos / bool)
    for campo in (
        "envio_auto_habilitado", "envio_tope_diario", "envio_delay_seg",
        "envio_hora_inicio", "envio_hora_fin",
        "cadencia_max_contactos", "cadencia_dias_cancelar",
    ):
        val = getattr(body, campo)
        if val is not None:
            setattr(cfg, campo, val)

    if body.wa_templates is not None:
        cfg.wa_templates = [t.strip() for t in body.wa_templates if t and t.strip()]

    if body.cadencia_dias is not None:
        cfg.cadencia_dias = {str(k): int(v) for k, v in body.cadencia_dias.items()}

    db.commit()
    return get_cliente_config(tenant_id, db)


# ── Información del negocio (relevamiento) de un cliente ──────────────────────
# Mismo schema y storage que /me/info-negocio (el cliente lo edita en su propia
# Configuración), pero scoped por tenant_id para que el superadmin lo vea/edite
# desde Admin clientes. Ambos editan el MISMO TenantConfig.info_negocio → se
# actualizan mutuamente.
class InfoNegocioUpdate(BaseModel):
    values: dict = {}
    extra: list = []


class AsistirBody(BaseModel):
    texto: str = ""


@router.get("/clientes/{tenant_id}/info-negocio")
def get_cliente_info_negocio(tenant_id: int, db: Session = Depends(get_db)):
    _tenant_prospia(db, tenant_id)
    cfg = _config_de(db, tenant_id)
    db.commit()
    return info_negocio_svc.build_response(db, tenant_id, cfg)


@router.put("/clientes/{tenant_id}/info-negocio")
def put_cliente_info_negocio(
    tenant_id: int, body: InfoNegocioUpdate, db: Session = Depends(get_db)
):
    _tenant_prospia(db, tenant_id)
    cfg = _config_de(db, tenant_id)
    updated_at = info_negocio_svc.save(db, cfg, body.values, body.extra)
    return {"ok": True, "updated_at": updated_at}


@router.post("/clientes/{tenant_id}/info-negocio/asistir")
def asistir_cliente_info_negocio(
    tenant_id: int, body: AsistirBody, db: Session = Depends(get_db)
):
    """IA que reparte el texto libre en los casilleros. No guarda: devuelve propuesta."""
    _tenant_prospia(db, tenant_id)
    cfg = _config_de(db, tenant_id)
    db.commit()
    valores = (cfg.info_negocio or {}).get("values", {})
    return intake_ai.clasificar_texto(body.texto, secciones_config(), valores)


@router.get("/clientes/{tenant_id}/archivo/{archivo_id}")
def descargar_cliente_archivo(tenant_id: int, archivo_id: str, db: Session = Depends(get_db)):
    """Descarga un archivo del relevamiento del cliente (verifica que sea del tenant)."""
    _tenant_prospia(db, tenant_id)
    subs = db.query(IntakeSubmission).filter(IntakeSubmission.tenant_id == tenant_id).all()
    for sub in subs:
        for a in (sub.archivos or []):
            if a.get("id") == archivo_id:
                path = a.get("path")
                if not path or not os.path.exists(path):
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Archivo no disponible")
                return FileResponse(
                    path,
                    media_type=a.get("content_type") or "application/octet-stream",
                    filename=a.get("nombre_original") or "archivo",
                )
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Archivo no encontrado")


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


@router.post("/clientes/{tenant_id}/impersonate", response_model=ImpersonateOut)
def impersonate_cliente(tenant_id: int, db: Session = Depends(get_db)):
    """'Ver como cliente': emite un token de la sesión del usuario nivel 2 de ese
    cliente, para que el superadmin vea la web tal cual la ve el cliente."""
    tenant = _tenant_prospia(db, tenant_id)
    user = _user_principal(db, tenant_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="El cliente no tiene usuario")
    token = create_access_token({"sub": str(user.id), "tenant_id": user.tenant_id})
    return ImpersonateOut(access_token=token, cliente=tenant.nombre)


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
            prox_contacto=m.prox_contacto,
            ultima_actividad=m.ultima_actividad,
            cant_mensajes=len(m.mensajes),
            bloqueado=bool(m.bloqueado),
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


@router.post("/etiguel/reset-numero-prueba", response_model=ResetNumeroPruebaOut)
def reset_numero_prueba(body: ResetNumeroPruebaIn, db: Session = Depends(get_db)):
    """Reinicia una prueba de Camila: borra todo rastro de un número de teléfono
    de prueba para poder re-testear desde cero.

    Hace dos cosas (best-effort):
      (a) Borra de la DB de Prospia el espejo del número: filas de etiguel_mirror
          cuyo teléfono matchee por los últimos 10 dígitos + sus mensajes.
      (b) Llama al webhook de Etiguel POST /reset-numero-prueba (X-Deploy-Token,
          token leído de monitor_settings) para limpiar la memoria local de Camila.

    Si el webhook falla, igual se reporta lo borrado de la DB y el error."""
    from app.services import monitoring

    digits = "".join(c for c in (body.telefono or "") if c.isdigit())[-10:]
    if len(digits) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Teléfono inválido: se necesitan al menos 10 dígitos.",
        )

    # (a) Borrar el espejo en la DB de Prospia (match por últimos 10 dígitos).
    #     Usamos un patrón sobre solo-dígitos del teléfono para tolerar formatos
    #     guardados con +, espacios o guiones.
    mirrors = [
        m for m in db.query(EtiguelMirror).all()
        if m.telefono and "".join(c for c in m.telefono if c.isdigit()).endswith(digits)
    ]
    mensajes_borrados = 0
    for m in mirrors:
        mensajes_borrados += (
            db.query(EtiguelMirrorMensaje)
            .filter(EtiguelMirrorMensaje.mirror_id == m.id)
            .delete(synchronize_session=False)
        )
        db.delete(m)
    db.commit()
    db_borrado = {"mirrors": len(mirrors), "mensajes": mensajes_borrados}

    # (b) Limpiar la memoria local de Camila vía el webhook (best-effort).
    webhook_ok = False
    webhook_respuesta: dict | None = None
    webhook_error: str | None = None
    token = monitoring._etiguel_token()
    if not token:
        webhook_error = "Token de Etiguel no configurado (monitor_settings / env)."
    else:
        try:
            r = requests.post(
                "https://webhook.etiguel.net/reset-numero-prueba",
                headers={
                    "X-Deploy-Token": token,
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Content-Type": "application/json",
                },
                json={"telefono": body.telefono},
                timeout=15,
            )
            if r.status_code == 200:
                try:
                    webhook_respuesta = r.json()
                    webhook_ok = bool(webhook_respuesta.get("ok", True))
                except Exception:
                    webhook_respuesta = {"raw": r.text[:500]}
                    webhook_ok = True
            else:
                webhook_error = f"HTTP {r.status_code}: {r.text[:300]}"
        except Exception as e:
            webhook_error = f"{type(e).__name__}: {e}"

    return ResetNumeroPruebaOut(
        telefono=body.telefono,
        digits=digits,
        db_borrado=db_borrado,
        webhook_ok=webhook_ok,
        webhook_respuesta=webhook_respuesta,
        webhook_error=webhook_error,
    )


def _etiguel_bloquear(mirror_id: int, bloquear: bool, db: Session) -> BloquearOut:
    """Bloquea/desbloquea el número de un item espejado de Etiguel. Le pega al
    webhook de Camila (POST /bloquear|/desbloquear, X-Deploy-Token) que escribe la
    lista negra (blacklist.json/.md) que leen los plugins, y refleja el estado en
    la DB de Prospia. Si el webhook falla, NO marca el espejo como bloqueado (el
    bloqueo real vive en Camila): así el botón no miente."""
    from app.services import monitoring

    mirror = db.get(EtiguelMirror, mirror_id)
    if not mirror:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No encontrado")
    if not mirror.telefono:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="El item no tiene teléfono para bloquear.")
    digits = "".join(c for c in mirror.telefono if c.isdigit())

    token = monitoring._etiguel_token()
    if not token:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Token de Etiguel no configurado.")

    endpoint = "bloquear" if bloquear else "desbloquear"
    webhook_ok = False
    webhook_error: str | None = None
    blacklist_total: int | None = None
    try:
        r = requests.post(
            f"https://webhook.etiguel.net/{endpoint}",
            headers={
                "X-Deploy-Token": token,
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Content-Type": "application/json",
            },
            json={"telefono": mirror.telefono},
            timeout=15,
        )
        if r.status_code == 200:
            data = r.json()
            webhook_ok = bool(data.get("ok", True))
            bl = data.get("blacklist")
            blacklist_total = len(bl) if isinstance(bl, list) else None
        else:
            webhook_error = f"HTTP {r.status_code}: {r.text[:300]}"
    except Exception as e:
        webhook_error = f"{type(e).__name__}: {e}"

    if webhook_ok:
        mirror.bloqueado = bloquear
        mirror.bloqueado_en = datetime.now(timezone.utc) if bloquear else None
        db.commit()
    else:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"No se pudo {'bloquear' if bloquear else 'desbloquear'} en Camila: {webhook_error}",
        )

    return BloquearOut(
        telefono=mirror.telefono,
        digits=digits,
        bloqueado=bloquear,
        webhook_ok=webhook_ok,
        blacklist_total=blacklist_total,
        webhook_error=webhook_error,
    )


@router.post("/etiguel/mirror/{mirror_id}/bloquear", response_model=BloquearOut)
def etiguel_mirror_bloquear(mirror_id: int, db: Session = Depends(get_db)):
    """Manda el número de este lead/prospect a la lista negra: Camila deja de
    escucharlo y de responderle, y no se lo vuelve a contactar."""
    return _etiguel_bloquear(mirror_id, True, db)


@router.post("/etiguel/mirror/{mirror_id}/desbloquear", response_model=BloquearOut)
def etiguel_mirror_desbloquear(mirror_id: int, db: Session = Depends(get_db)):
    """Saca el número de la lista negra: Camila vuelve a atenderlo normalmente."""
    return _etiguel_bloquear(mirror_id, False, db)


@router.post("/clientes/{tenant_id}/reset-numero-prueba", response_model=ResetNumeroPruebaTenantOut)
def reset_numero_prueba_cliente(tenant_id: int, body: ResetNumeroPruebaIn, db: Session = Depends(get_db)):
    """Reinicia una prueba del bot de un CLIENTE (tenant): borra todo rastro de un
    número de prueba. Tenant-aware:
      (a) Borra de la DB de Prospia los prospects de ESE tenant cuyo teléfono o
          whatsapp matchee por los últimos 10 dígitos + sus mensajes e historial.
      (b) Si el tenant tiene su webhook de bot configurado (webhook_url +
          webhook_deploy_token), le pega POST {webhook_url}/reset-numero-prueba
          para limpiar la memoria local del bot. Si el bot todavía NO está
          conectado → solo DB, estado 'no_conectado' (la infra queda lista para
          cuando se conecte; ver implementador, paso 11)."""
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No existe ese cliente.")

    digits = "".join(c for c in (body.telefono or "") if c.isdigit())[-10:]
    if len(digits) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Teléfono inválido: se necesitan al menos 10 dígitos.",
        )

    # (a) Borrar del tenant: prospects (match por últimos 10 dígitos en telefono o
    #     whatsapp) + sus mensajes e historial (FKs a prospects.id).
    def _match(p) -> bool:
        for campo in (p.telefono, p.whatsapp):
            if campo and "".join(c for c in campo if c.isdigit()).endswith(digits):
                return True
        return False

    prospects = [
        p for p in db.query(Prospect).filter(Prospect.tenant_id == tenant_id).all() if _match(p)
    ]
    mensajes_borrados = 0
    for p in prospects:
        mensajes_borrados += (
            db.query(ProspectMensaje)
            .filter(ProspectMensaje.prospect_id == p.id)
            .delete(synchronize_session=False)
        )
        db.query(ProspectHistorial).filter(
            ProspectHistorial.prospect_id == p.id
        ).delete(synchronize_session=False)
        db.delete(p)
    db.commit()
    db_borrado = {"prospects": len(prospects), "mensajes": mensajes_borrados}

    # (b) Limpiar la memoria local del bot vía su webhook (solo si está conectado).
    cfg = tenant.config
    url = (cfg.webhook_url or "").strip() if cfg else ""
    token = (cfg.webhook_deploy_token or "").strip() if cfg else ""
    webhook_estado = "no_conectado"
    webhook_respuesta: dict | None = None
    webhook_error: str | None = None
    if url and token:
        try:
            r = requests.post(
                url.rstrip("/") + "/reset-numero-prueba",
                headers={
                    "X-Deploy-Token": token,
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Content-Type": "application/json",
                },
                json={"telefono": body.telefono},
                timeout=15,
            )
            if r.status_code == 200:
                try:
                    webhook_respuesta = r.json()
                except Exception:
                    webhook_respuesta = {"raw": r.text[:500]}
                webhook_estado = "ok"
            else:
                webhook_estado = "error"
                webhook_error = f"HTTP {r.status_code}: {r.text[:300]}"
        except Exception as e:
            webhook_estado = "error"
            webhook_error = f"{type(e).__name__}: {e}"

    return ResetNumeroPruebaTenantOut(
        tenant_id=tenant_id,
        cliente=tenant.nombre,
        telefono=body.telefono,
        digits=digits,
        db_borrado=db_borrado,
        webhook_estado=webhook_estado,
        webhook_respuesta=webhook_respuesta,
        webhook_error=webhook_error,
    )


def _bloquear_prospect_cliente(tenant_id: int, prospect_id: int, bloquear: bool, db: Session) -> BloquearProspectOut:
    """Bloquea/desbloquea un prospect de un CLIENTE. SOLO superadmin (todo el router
    /admin lo está) → solo Sebi lo hace desde la app; la web del cliente (que usa
    /prospects con token de tenant) no tiene esta acción. Tenant-aware:
      - Marca prospect.bloqueado en la DB (corta cadencia + contacto; lo hace Prospia).
      - Si el tenant tiene su webhook de bot conectado (webhook_url + deploy_token),
        le pega POST {webhook_url}/bloquear|/desbloquear para que el bot deje de
        escuchar/responder. Si no está conectado → solo DB, estado 'no_conectado'."""
    prospect = db.get(Prospect, prospect_id)
    if not prospect or prospect.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prospect no encontrado")
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No existe ese cliente.")

    numero = prospect.whatsapp or prospect.telefono

    # (a) DB primero: el bloqueo de cadencia/contacto lo controla Prospia y vale
    #     aunque el bot no esté conectado.
    prospect.bloqueado = bloquear
    prospect.bloqueado_en = datetime.now(timezone.utc) if bloquear else None
    db.add(ProspectHistorial(
        prospect_id=prospect.id, tenant_id=tenant_id,
        tipo="bloqueado" if bloquear else "desbloqueado",
        detalle="Bloqueado por el admin (lista negra)" if bloquear else "Desbloqueado por el admin",
    ))
    db.commit()

    # (b) Avisar al bot del tenant vía su webhook (best-effort, igual que el reset).
    cfg = tenant.config
    url = (cfg.webhook_url or "").strip() if cfg else ""
    token = (cfg.webhook_deploy_token or "").strip() if cfg else ""
    webhook_estado = "no_conectado"
    webhook_error: str | None = None
    if url and token and numero:
        endpoint = "bloquear" if bloquear else "desbloquear"
        try:
            r = requests.post(
                url.rstrip("/") + "/" + endpoint,
                headers={
                    "X-Deploy-Token": token,
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Content-Type": "application/json",
                },
                json={"telefono": numero},
                timeout=15,
            )
            if r.status_code == 200:
                webhook_estado = "ok"
            else:
                webhook_estado = "error"
                webhook_error = f"HTTP {r.status_code}: {r.text[:300]}"
        except Exception as e:
            webhook_estado = "error"
            webhook_error = f"{type(e).__name__}: {e}"

    return BloquearProspectOut(
        prospect_id=prospect.id,
        tenant_id=tenant_id,
        telefono=numero,
        bloqueado=bloquear,
        webhook_estado=webhook_estado,
        webhook_error=webhook_error,
    )


@router.post("/clientes/{tenant_id}/prospects/{prospect_id}/bloquear", response_model=BloquearProspectOut)
def bloquear_prospect_cliente(tenant_id: int, prospect_id: int, db: Session = Depends(get_db)):
    """Manda el prospect a la lista negra: no se lo re-contacta y el bot del cliente
    deja de escucharlo/responderle (si su webhook está conectado). Solo superadmin."""
    return _bloquear_prospect_cliente(tenant_id, prospect_id, True, db)


@router.post("/clientes/{tenant_id}/prospects/{prospect_id}/desbloquear", response_model=BloquearProspectOut)
def desbloquear_prospect_cliente(tenant_id: int, prospect_id: int, db: Session = Depends(get_db)):
    """Saca el prospect de la lista negra: vuelve a la cadencia normal. Solo superadmin."""
    return _bloquear_prospect_cliente(tenant_id, prospect_id, False, db)


ESTADOS_ERROR = ("nuevo", "reportado", "fixed")


def _set_estado_error(err: AgentError, estado: str) -> None:
    """Aplica un estado al error y sincroniza el flag legacy `resuelto`."""
    err.estado = estado
    err.resuelto = (estado == "fixed")


@router.get("/errores", response_model=list[AgentErrorOut])
def listar_errores(
    incluir_resueltos: bool = Query(True),
    estado: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Errores de Camila capturados por el outbound-guard, más reciente arriba.
    El `id` es el #número con el que Sebi los identifica. Filtrable por `estado`."""
    q = db.query(AgentError)
    if estado:
        q = q.filter(AgentError.estado == estado)
    elif not incluir_resueltos:
        q = q.filter(AgentError.estado != "fixed")
    return q.order_by(AgentError.fecha.desc()).all()


@router.patch("/errores/{error_id}", response_model=AgentErrorOut)
def resolver_error(error_id: int, body: AgentErrorResolve, db: Session = Depends(get_db)):
    """Cambia el estado de un error (botón Reportar de la app/web, o tilde legacy).
    Mandá `estado` (nuevo|reportado|fixed). `resuelto` se acepta por compatibilidad."""
    err = db.get(AgentError, error_id)
    if not err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No existe ese error")
    if body.estado is not None:
        if body.estado not in ESTADOS_ERROR:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail=f"estado inválido: {body.estado}")
        _set_estado_error(err, body.estado)
    elif body.resuelto is not None:
        _set_estado_error(err, "fixed" if body.resuelto else "nuevo")
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


# ── Consultas: preguntas que Camila escaló (no supo qué responder) ───────────
def _relay_respuesta_a_camila(consulta: Consulta) -> None:
    """Manda la respuesta de Sebi al webhook de Etiguel, que se la pasa a Camila
    (RESPONDER_CONSULTA|num|texto) para que la reenvíe al cliente. Levanta
    HTTPException(502) si no se pudo entregar (así la UI avisa y no marca
    'contestada' algo que no salió)."""
    if not consulta.telefono:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="La consulta no tiene teléfono, no se puede entregar la respuesta")
    if not settings.ETIGUEL_DEPLOY_TOKEN:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Falta ETIGUEL_DEPLOY_TOKEN en el backend")
    url = settings.ETIGUEL_WEBHOOK_URL.rstrip("/") + "/responder-consulta"
    try:
        r = requests.post(
            url,
            json={"numero": consulta.telefono, "respuesta": consulta.respuesta},
            headers={
                "X-Deploy-Token": settings.ETIGUEL_DEPLOY_TOKEN,
                "Content-Type": "application/json",
                # El WAF de Cloudflare del webhook rechaza requests sin User-Agent de browser.
                "User-Agent": "Mozilla/5.0 (Prospia backend)",
            },
            timeout=15,
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail=f"No se pudo contactar el webhook de Camila: {type(e).__name__}")
    if r.status_code >= 300:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail=f"El webhook rechazó la respuesta (HTTP {r.status_code})")


@router.get("/consultas", response_model=list[ConsultaOut])
def listar_consultas(
    estado: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Preguntas que Camila escaló porque no supo qué responder, más reciente
    arriba. Filtrable por `estado` (pendiente|contestada)."""
    q = db.query(Consulta)
    if estado:
        q = q.filter(Consulta.estado == estado)
    return q.order_by(Consulta.fecha.desc()).all()


@router.post("/consultas/{consulta_id}/responder", response_model=ConsultaOut)
def responder_consulta(consulta_id: int, body: ConsultaResponder, db: Session = Depends(get_db)):
    """Sebi contesta una consulta desde la app/web. Guarda la respuesta, la relaya
    al webhook (que se la pasa a Camila para reenviarla al cliente) y recién si la
    entrega salió OK la marca 'contestada'. Si la entrega falla, levanta 502 y la
    consulta queda 'pendiente' (la respuesta tipeada no se pierde, se reintenta)."""
    c = db.get(Consulta, consulta_id)
    if not c:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No existe esa consulta")
    respuesta = (body.respuesta or "").strip()
    if not respuesta:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="La respuesta está vacía")
    c.respuesta = respuesta
    _relay_respuesta_a_camila(c)  # 502 si no se entregó → no marca contestada
    c.estado = "contestada"
    c.fecha_respuesta = datetime.now(timezone.utc)
    db.commit()
    db.refresh(c)
    return c


@router.delete("/consultas/{consulta_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_consulta(consulta_id: int, db: Session = Depends(get_db)):
    """Borra una consulta desde la app/web (swipe o botón borrar)."""
    c = db.get(Consulta, consulta_id)
    if c:
        db.delete(c)
        db.commit()


@router.post("/consultas/eliminar", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_consultas(body: ConsultasEliminar, db: Session = Depends(get_db)):
    """Borra las consultas tildadas (multi-select de la app/web)."""
    if body.ids:
        db.query(Consulta).filter(Consulta.id.in_(body.ids)).delete(synchronize_session=False)
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
        # Confirmar un "procesado" → sale de la cola al darse por hecho.
        if body.hecho:
            p.cola_estado = None
    # cola_estado: "" o null → sacar de cola | otro valor → setear estado.
    if body.cola_estado is not None:
        nuevo = body.cola_estado.strip() or None
        if nuevo in (None, "pendiente", "procesado", "standby"):
            p.cola_estado = nuevo
            if nuevo and p.cola_orden is None:
                p.cola_orden = datetime.now(timezone.utc)
            elif nuevo is None:
                p.cola_orden = None
    # Campos ricos: si vienen en el body (no None), se actualizan; "" → NULL.
    for campo in ("contexto", "que_armar", "consideraciones", "depende", "alcance"):
        val = getattr(body, campo)
        if val is not None:
            setattr(p, campo, val.strip() or None)
    # Conclusión: lo que hizo Claude al procesarlo ("" → NULL).
    if body.cola_resultado is not None:
        p.cola_resultado = body.cola_resultado.strip() or None
    db.commit()
    db.refresh(p)
    return p


@router.post("/pendientes/cola", response_model=list[PendienteOut])
def encolar_pendientes(body: ColaIn, db: Session = Depends(get_db)):
    """Tildar pendientes y mandarlos a la cola de procesamiento. Marca cada uno
    (que no esté hecho ni ya encolado) como cola_estado='pendiente' con su
    cola_orden = ahora → la cola se procesa FIFO (el más viejo primero)."""
    if not body.ids:
        return []
    items = db.query(Pendiente).filter(Pendiente.id.in_(body.ids)).all()
    ahora = datetime.now(timezone.utc)
    for p in items:
        if p.hecho or p.cola_estado is not None:
            continue
        p.cola_estado = "pendiente"
        p.cola_orden = ahora
    db.commit()
    return _cola_items(db)


@router.get("/cola", response_model=list[PendienteOut])
def listar_cola(db: Session = Depends(get_db)):
    """La cola de procesamiento, FIFO (más viejo primero). Incluye los que
    esperan ('pendiente'), los ya resueltos sin confirmar ('procesado') y los
    frenados por falta de info ('standby'). Lo lee Claude para avanzar la cola."""
    return _cola_items(db)


def _cola_items(db: Session):
    estados = ("pendiente", "procesado", "standby")
    orden_estado = case(
        (Pendiente.cola_estado == "pendiente", 0),
        (Pendiente.cola_estado == "standby", 1),
        (Pendiente.cola_estado == "procesado", 2),
        else_=3,
    )
    return (
        db.query(Pendiente)
        .filter(Pendiente.cola_estado.in_(estados))
        .order_by(orden_estado, Pendiente.cola_orden.asc())
        .all()
    )


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


# ── Notificaciones por cliente y por evento (#44) ────────────────────────────
@router.get("/clientes/{tenant_id}/notif-prefs", response_model=ClienteNotifPrefsOut)
def get_cliente_notif_prefs(tenant_id: int, expo_token: str = Query(...), db: Session = Depends(get_db)):
    """Estado de cada evento (interesado / primera respuesta / cada mensaje
    entrante) para ESTE cliente y device. Sin fila → default por evento."""
    rows = {
        r.evento: r.enabled
        for r in db.query(PushClienteEvento).filter(
            PushClienteEvento.expo_token == expo_token,
            PushClienteEvento.tenant_id == tenant_id,
        ).all()
    }
    eventos = [
        NotifEvento(
            evento=k, label=label,
            enabled=rows[k] if k in rows else push.DEFAULT_CLIENTE_EVENTO.get(k, True),
        )
        for k, label in push.EVENTOS_CLIENTE
    ]
    return ClienteNotifPrefsOut(tenant_id=tenant_id, eventos=eventos)


@router.put("/clientes/{tenant_id}/notif-prefs", response_model=ClienteNotifPrefsOut)
def set_cliente_notif_pref(tenant_id: int, body: ClienteNotifPrefUpdate, db: Session = Depends(get_db)):
    """Activa/desactiva un evento de push de un cliente para un device (upsert)."""
    if body.evento not in [k for k, _ in push.EVENTOS_CLIENTE]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Evento desconocido")
    row = (
        db.query(PushClienteEvento)
        .filter(
            PushClienteEvento.expo_token == body.expo_token,
            PushClienteEvento.tenant_id == tenant_id,
            PushClienteEvento.evento == body.evento,
        )
        .first()
    )
    if row:
        row.enabled = body.enabled
    else:
        db.add(PushClienteEvento(expo_token=body.expo_token, tenant_id=tenant_id, evento=body.evento, enabled=body.enabled))
    db.commit()
    return get_cliente_notif_prefs(tenant_id=tenant_id, expo_token=body.expo_token, db=db)


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


# ── Notificaciones por evento, por dispositivo (#38) ──────────────────────────
@router.get("/devices", response_model=list[DeviceOut])
def listar_devices(db: Session = Depends(get_db)):
    """Dispositivos registrados para push. Lo usa la web para configurar los
    toggles de cada uno (la web no es un device de push)."""
    return [DeviceOut(expo_token=d.expo_token, platform=d.platform) for d in db.query(Device).all()]


@router.get("/notif-prefs", response_model=NotifPrefsOut)
def get_notif_prefs(expo_token: str = Query(...), db: Session = Depends(get_db)):
    """Estado de cada evento de push para un device. Para los opt-out (la mayoría):
    sin fila = activado. Para los opt-in (EVENTOS_PUSH_DEFAULT_OFF): con fila =
    activado, sin fila = apagado."""
    con_fila = {
        e for (e,) in db.query(PushEventMute.evento)
        .filter(PushEventMute.expo_token == expo_token)
        .all()
    }
    device = db.query(Device).filter(Device.expo_token == expo_token).first()
    eventos = [
        NotifEvento(
            evento=k,
            label=label,
            enabled=(k in con_fila) if k in push.EVENTOS_PUSH_DEFAULT_OFF else (k not in con_fila),
        )
        for k, label in push.EVENTOS_PUSH
    ]
    return NotifPrefsOut(expo_token=expo_token, platform=device.platform if device else None, eventos=eventos)


@router.put("/notif-prefs", response_model=NotifPrefsOut)
def set_notif_pref(body: NotifPrefUpdate, db: Session = Depends(get_db)):
    """Activa/desactiva un evento de push para un device. Idempotente. Para los
    opt-out (mayoría): la fila es el mute (enabled=false la crea). Para los opt-in
    (EVENTOS_PUSH_DEFAULT_OFF): la fila es la suscripción (enabled=true la crea)."""
    if body.evento not in push.EVENTOS_PUSH_KEYS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Evento desconocido")
    existente = (
        db.query(PushEventMute)
        .filter(PushEventMute.expo_token == body.expo_token, PushEventMute.evento == body.evento)
        .first()
    )
    # opt-in → la fila significa "activado"; opt-out → significa "silenciado".
    default_off = body.evento in push.EVENTOS_PUSH_DEFAULT_OFF
    quiere_fila = body.enabled if default_off else (not body.enabled)
    if quiere_fila:
        if not existente:
            db.add(PushEventMute(expo_token=body.expo_token, evento=body.evento))
            db.commit()
    else:
        if existente:
            db.delete(existente)
            db.commit()
    return get_notif_prefs(expo_token=body.expo_token, db=db)


@router.post("/notify")
def notify(body: NotifyIn):
    """Dispara un push de evento global (standby / cola_terminada /
    necesita_autorizacion), respetando los toggles por dispositivo. Lo usa Claude
    al procesar la cola de pendientes."""
    if body.evento not in push.EVENTOS_PUSH_KEYS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Evento desconocido")
    n = push.notificar_global(body.evento, body.title[:120], body.body[:300])
    return {"enviado_a_devices": n}


# ── Preguntas de Claude Code (switch "Preguntas al cel") ──────────────────────
@router.get("/preguntas-modo", response_model=PreguntasModoOut)
def get_preguntas_modo(db: Session = Depends(get_db)):
    """Estado del switch "Preguntas al cel" (lo muestra el toggle de ajustes)."""
    from app.services.preguntas_claude import preguntas_al_cel_activo
    return {"activo": preguntas_al_cel_activo(db)}


@router.patch("/preguntas-modo", response_model=PreguntasModoOut)
def set_preguntas_modo(body: PreguntasModoUpdate, db: Session = Depends(get_db)):
    """Sebi prende/apaga el switch desde la app. Con ON, las preguntas de Claude
    Code van al cel; con OFF, vuelven a la cajita nativa de la terminal."""
    from app.services.preguntas_claude import set_preguntas_al_cel
    return {"activo": set_preguntas_al_cel(db, body.activo)}


@router.get("/preguntas-claude", response_model=list[PreguntaClaudeOut])
def listar_preguntas_claude(estado: str | None = Query(None), db: Session = Depends(get_db)):
    """Preguntas de Claude (pendientes arriba). Filtrable por estado
    (pendiente|respondida|cancelada). Alimenta la pantalla de Preguntas de Claude."""
    from app.models.pregunta_claude import PreguntaClaude
    from app.services.preguntas_claude import pregunta_to_dict
    q = db.query(PreguntaClaude)
    if estado:
        q = q.filter(PreguntaClaude.estado == estado)
    return [pregunta_to_dict(p) for p in q.order_by(PreguntaClaude.fecha.desc()).limit(50).all()]


@router.get("/preguntas-claude/{pregunta_id}", response_model=PreguntaClaudeOut)
def get_pregunta_claude(pregunta_id: int, db: Session = Depends(get_db)):
    """Una pregunta puntual (la app la abre desde el deep-link del push)."""
    from app.models.pregunta_claude import PreguntaClaude
    from app.services.preguntas_claude import pregunta_to_dict
    p = db.get(PreguntaClaude, pregunta_id)
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No existe esa pregunta")
    return pregunta_to_dict(p)


@router.post("/preguntas-claude/{pregunta_id}/responder", response_model=PreguntaClaudeOut)
def responder_pregunta_claude(pregunta_id: int, body: PreguntaClaudeResponder, db: Session = Depends(get_db)):
    """Sebi responde la tanda desde el cel (una respuesta por pregunta). Guarda y
    marca 'respondida'; el MCP la levanta en su próximo poll y Claude continúa.
    Si ya estaba respondida, devuelve tal cual (idempotente)."""
    import json as _json
    from app.models.pregunta_claude import PreguntaClaude
    from app.services.preguntas_claude import pregunta_to_dict, resumen_respuestas, _preguntas_de
    p = db.get(PreguntaClaude, pregunta_id)
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No existe esa pregunta")
    respuestas = [(r or "").strip() for r in (body.respuestas or [])]
    preguntas = _preguntas_de(p)
    if not respuestas or len(respuestas) != len(preguntas) or any(not r for r in respuestas):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="Respondé todas las preguntas")
    if p.estado == "pendiente":
        p.respuestas = _json.dumps(respuestas, ensure_ascii=False)
        p.elegida = resumen_respuestas(preguntas, respuestas)  # resumen / compat
        p.estado = "respondida"
        p.fecha_respuesta = datetime.now(timezone.utc)
        db.commit()
        db.refresh(p)
    return pregunta_to_dict(p)


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


# ── Avisos: historial de push REALES (#42) ───────────────────────────────────
@router.get("/avisos", response_model=list[AvisoOut])
def listar_avisos(db: Session = Depends(get_db), limit: int = 200):
    """Historial de los push reales enviados (últimos 3 días), más recientes
    primero. Alimenta la pantalla de Avisos de la app."""
    limit = max(1, min(limit, 500))
    corte = datetime.now(timezone.utc) - timedelta(days=3)
    return (
        db.query(Aviso)
        .filter(Aviso.fecha >= corte)
        .order_by(Aviso.fecha.desc())
        .limit(limit)
        .all()
    )


@router.post("/avisos/eliminar", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_avisos(body: AvisosEliminar, db: Session = Depends(get_db)):
    """Borra los avisos tildados (botón Eliminar de la app)."""
    if body.ids:
        db.query(Aviso).filter(Aviso.id.in_(body.ids)).delete(synchronize_session=False)
        db.commit()
