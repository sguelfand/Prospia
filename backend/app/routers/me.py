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

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.database import get_db
from app.models.intake_submission import IntakeSubmission
from app.models.tenant import TenantConfig
from app.models.user import User
from app.services import info_negocio as info_negocio_svc
from app.services import intake_ai
from app.services.intake_schema import secciones_config

router = APIRouter(prefix="/me", tags=["me"])


class InfoNegocioUpdate(BaseModel):
    values: dict = {}
    extra: list = []


class AsistirBody(BaseModel):
    texto: str = ""


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
