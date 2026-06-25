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

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.database import get_db
from app.models.intake_submission import IntakeSubmission
from app.models.tenant import TenantConfig
from app.models.user import User
from app.services.intake_schema import secciones_config

router = APIRouter(prefix="/me", tags=["me"])


class InfoNegocioUpdate(BaseModel):
    values: dict = {}
    extra: list = []


def _config_del_usuario(db: Session, user: User) -> TenantConfig:
    cfg = db.query(TenantConfig).filter(TenantConfig.tenant_id == user.tenant_id).first()
    if not cfg:
        # Crear la fila de config si el tenant todavía no la tiene.
        cfg = TenantConfig(tenant_id=user.tenant_id, info_negocio={})
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def _archivos_del_tenant(db: Session, tenant_id: int) -> list[dict]:
    """Archivos del último relevamiento del tenant (metadata, sin el path en disco)."""
    sub = (
        db.query(IntakeSubmission)
        .filter(IntakeSubmission.tenant_id == tenant_id)
        .order_by(IntakeSubmission.created_at.desc())
        .first()
    )
    if not sub or not sub.archivos:
        return []
    return [
        {"id": a.get("id"), "campo": a.get("campo"), "nombre_original": a.get("nombre_original"),
         "content_type": a.get("content_type"), "size": a.get("size")}
        for a in sub.archivos
    ]


@router.get("/info-negocio")
def get_info_negocio(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cfg = _config_del_usuario(db, user)
    info = cfg.info_negocio or {}
    return {
        "secciones": secciones_config(),
        "values": info.get("values", {}),
        "extra": info.get("extra", []),
        "intake_at": info.get("intake_at"),
        "updated_at": info.get("updated_at"),
        "archivos": _archivos_del_tenant(db, user.tenant_id),
    }


@router.put("/info-negocio")
def put_info_negocio(
    body: InfoNegocioUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cfg = _config_del_usuario(db, user)
    prev = dict(cfg.info_negocio or {})
    prev["values"] = body.values or {}
    prev["extra"] = body.extra or []
    prev["updated_at"] = datetime.now(timezone.utc).isoformat()
    cfg.info_negocio = prev
    db.commit()
    return {"ok": True, "updated_at": prev["updated_at"]}


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
