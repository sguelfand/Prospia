"""Endpoints self-scoped del usuario logueado (cliente normal o superadmin
impersonando). Operan SIEMPRE sobre el tenant del propio usuario — no son
endpoints de admin. Sirven a la sección "Información del negocio" de la
Configuración del cliente.

  GET /me/info-negocio        → esquema (config) + valores guardados + archivos
  PUT /me/info-negocio        → guarda values + extra del cliente
  GET /me/archivo/{id}        → descarga un archivo del relevamiento del tenant
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import requests
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.database import get_db
from app.models.agent_error import AgentError
from app.models.consulta import Consulta
from app.models.intake_submission import IntakeSubmission
from app.models.tenant import Tenant, TenantConfig
from app.models.user import User
from app.schemas.admin import ConsultaOut, ConsultaResponder, ConsultasEliminar
from app.services import ayuda_ai
from app.services import info_negocio as info_negocio_svc
from app.services import intake_ai
from app.services.intake_schema import secciones_config

router = APIRouter(prefix="/me", tags=["me"])


class InfoNegocioUpdate(BaseModel):
    values: dict = {}
    extra: list = []


class AsistirBody(BaseModel):
    texto: str = ""


def _relay_respuesta_tenant(cfg: TenantConfig, telefono: str, respuesta: str) -> None:
    """Relaya la respuesta del cliente a SU propia Camila (sessions_send al gateway
    del tenant) con RESPONDER_CONSULTA|num|texto, para que la reenvíe al cliente.
    Levanta 502/422 si no se puede entregar (así no se marca 'contestada' algo que
    no salió)."""
    if not telefono:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="La consulta no tiene teléfono, no se puede entregar la respuesta")
    gw_url = (cfg.openclaw_gateway_url or "").strip()
    gw_tok = (cfg.openclaw_gateway_token or "").strip()
    session_key = (cfg.openclaw_session_id or "").strip()
    if not (gw_url and gw_tok and session_key):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Tu asistente todavía no está configurado para recibir respuestas (falta gateway).")
    target = telefono.lstrip("+").replace(" ", "").replace("-", "")
    try:
        r = requests.post(
            gw_url,
            headers={"Authorization": f"Bearer {gw_tok}", "Content-Type": "application/json"},
            json={"tool": "sessions_send",
                  "args": {"sessionKey": session_key, "message": f"RESPONDER_CONSULTA|{target}|{respuesta}"}},
            timeout=15,
        )
    except requests.exceptions.Timeout:
        return  # el agente tarda > timeout; el mensaje ya quedó encolado (esperado)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail=f"No se pudo contactar a tu asistente: {type(e).__name__}")
    if r.status_code >= 300:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail=f"Tu asistente rechazó la respuesta (HTTP {r.status_code})")


@router.get("/consultas", response_model=list[ConsultaOut])
def listar_mis_consultas(
    estado: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Consultas que la Camila de ESTE cliente escaló (scoped al tenant del usuario)."""
    q = db.query(Consulta).filter(Consulta.tenant_id == user.tenant_id)
    if estado:
        q = q.filter(Consulta.estado == estado)
    return q.order_by(Consulta.fecha.desc()).all()


@router.post("/consultas/{consulta_id}/responder", response_model=ConsultaOut)
def responder_mi_consulta(
    consulta_id: int,
    body: ConsultaResponder,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """El cliente contesta una consulta de su propia Camila. Relaya a su gateway y
    recién si entrega OK la marca 'contestada' (502 si falla → queda pendiente)."""
    c = db.get(Consulta, consulta_id)
    if not c or c.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No existe esa consulta")
    respuesta = (body.respuesta or "").strip()
    if not respuesta:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="La respuesta está vacía")
    cfg = _config_del_usuario(db, user)
    c.respuesta = respuesta
    _relay_respuesta_tenant(cfg, c.telefono, respuesta)  # 502 si no entregó → no marca contestada
    c.estado = "contestada"
    c.fecha_respuesta = datetime.now(timezone.utc)
    db.commit()
    db.refresh(c)
    return c


@router.delete("/consultas/{consulta_id}", status_code=status.HTTP_204_NO_CONTENT)
def borrar_mi_consulta(
    consulta_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    c = db.get(Consulta, consulta_id)
    if c and c.tenant_id == user.tenant_id:
        db.delete(c)
        db.commit()


@router.post("/consultas/eliminar", status_code=status.HTTP_204_NO_CONTENT)
def eliminar_mis_consultas(
    body: ConsultasEliminar,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if body.ids:
        (db.query(Consulta)
         .filter(Consulta.tenant_id == user.tenant_id, Consulta.id.in_(body.ids))
         .delete(synchronize_session=False))
        db.commit()


def _config_del_usuario(db: Session, user: User) -> TenantConfig:
    cfg = db.query(TenantConfig).filter(TenantConfig.tenant_id == user.tenant_id).first()
    if not cfg:
        # Crear la fila de config si el tenant todavía no la tiene.
        cfg = TenantConfig(tenant_id=user.tenant_id, info_negocio={})
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


@router.get("/info-negocio")
def get_info_negocio(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cfg = _config_del_usuario(db, user)
    return info_negocio_svc.build_response(db, user.tenant_id, cfg)


@router.put("/info-negocio")
def put_info_negocio(
    body: InfoNegocioUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cfg = _config_del_usuario(db, user)
    updated_at = info_negocio_svc.save(db, cfg, body.values, body.extra)
    return {"ok": True, "updated_at": updated_at}


@router.post("/info-negocio/asistir")
def asistir_info_negocio(
    body: AsistirBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Toma el texto libre que escribió el cliente en "Agregar información" y, con
    IA (Haiku), propone cómo repartirlo en los casilleros. NO guarda nada: devuelve
    la propuesta para que el cliente la revise/confirme antes de guardar."""
    cfg = _config_del_usuario(db, user)
    valores = (cfg.info_negocio or {}).get("values", {})
    return intake_ai.clasificar_texto(body.texto, secciones_config(), valores)


@router.get("/archivo/{archivo_id}")
def descargar_archivo(
    archivo_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Descarga un archivo del relevamiento, verificando que pertenezca al tenant
    del usuario (no se puede pedir archivos de otro cliente)."""
    subs = (
        db.query(IntakeSubmission)
        .filter(IntakeSubmission.tenant_id == user.tenant_id)
        .all()
    )
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


# ── Asistente de ayuda + reporte de errores (Haiku, solo para el cliente) ──────

class AyudaBody(BaseModel):
    mensajes: list[dict] = []          # historial [{role, content}]
    pantalla_titulo: str = ""          # nombre legible de la pantalla activa
    pantalla_funciones: str = ""       # qué se puede hacer en esa pantalla


class ReporteBody(BaseModel):
    mensajes: list[dict] = []
    pantalla_titulo: str = ""


@router.post("/ayuda")
def ayuda_uso(
    body: AyudaBody,
    user: User = Depends(get_current_user),
):
    """Chat de ayuda contextual ("¿cómo uso esto?"). Acotado a cómo usar Prospia y
    a las funciones de la pantalla donde está el cliente."""
    resp = ayuda_ai.ayuda_chat(body.mensajes, body.pantalla_titulo, body.pantalla_funciones)
    if resp is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="La ayuda no está disponible en este momento.")
    return {"respuesta": resp}


@router.post("/reportar-error")
def reportar_error(
    body: ReporteBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Chat que toma un error reportado por el cliente. Cuando Haiku ya tiene la
    info necesaria, carga el ticket en la cola de errores (AgentError, fuente =
    slug del tenant, estado 'reportado') y le confirma al cliente. Devuelve la
    respuesta para el chat y, si se cargó, el id del ticket."""
    out = ayuda_ai.reporte_chat(body.mensajes, body.pantalla_titulo)
    if not out.get("listo"):
        return {"respuesta": out.get("respuesta", ""), "cargado": False}

    t = out["ticket"]
    tenant = db.get(Tenant, user.tenant_id)
    slug = (tenant.slug if tenant else "cliente")[:30]
    contenido = (
        f"[Reporte del cliente] {t.get('titulo', '')}\n"
        f"Pantalla/función: {t.get('pantalla', '')}\n\n"
        f"{t.get('resumen', '')}\n\n"
        f"Reportado por: usuario '{getattr(user, 'email', '') or user.id}' (tenant {slug})."
    )
    err = AgentError(
        fuente=slug,
        agente="cliente",
        telefono=None,
        patron="reporte_cliente",
        contenido=contenido,
        # estado por default = 'nuevo': entra al sector "Nuevos" para que Sebi lo
        # lea y recién al "Reportar" pase a la cola que reviso. NO directo a reportado.
    )
    db.add(err)
    db.commit()
    db.refresh(err)
    # Push de alerta a la app (mismo canal que los errores de Camila; best-effort).
    try:
        from app.services import push
        push.notificar_error_async(err.id, err.fuente, err.contenido)
    except Exception:
        pass
    return {"respuesta": out.get("respuesta", ""), "cargado": True, "ticket_id": err.id}
