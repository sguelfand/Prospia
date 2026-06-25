"""Endpoints PÚBLICOS (sin login) del relevamiento de clientes.

  GET  /public/intake-schema        → esquema de campos para el formulario
  GET  /public/intake/{slug}        → metadata del cliente (nombre) para el form
  POST /public/intake/{slug}        → recibe respuestas + archivos del cliente

El slug identifica al tenant. No requiere token: el formulario es un link que se
le pasa al cliente. Lo que entra queda en intake_submissions (pendiente de
procesar) y dispara un push al dueño (Sebi). Los binarios van al volumen de
uploads; en la DB solo guardamos metadata."""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi import Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.intake_submission import IntakeSubmission
from app.models.tenant import Tenant, TenantConfig
from app.services import push
from app.services.intake_schema import secciones_publicas

router = APIRouter(prefix="/public", tags=["public"])

UPLOADS_DIR = os.environ.get("UPLOADS_DIR", "/app/uploads")
# Límite defensivo por archivo (25 MB) y por cantidad, para que el endpoint
# público no se use como depósito.
MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_FILES = 40


def _safe_name(name: str) -> str:
    base = os.path.basename(name or "archivo")
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base)
    return base[:120] or "archivo"


@router.get("/intake-schema")
def intake_schema():
    """Esquema de secciones/campos del formulario (fuente única)."""
    return {"secciones": secciones_publicas()}


@router.get("/intake/{slug}")
def intake_meta(slug: str, db: Session = Depends(get_db)):
    """Datos mínimos del cliente para encabezar el formulario."""
    tenant = db.query(Tenant).filter(Tenant.slug == slug).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    return {"slug": tenant.slug, "nombre": tenant.nombre}


@router.post("/intake/{slug}", status_code=status.HTTP_201_CREATED)
async def intake_submit(
    slug: str,
    payload: str = Form(...),
    archivos: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
):
    """Recibe el formulario completo. `payload` es un JSON string con
    {"values": {...}, "extra": [...], "meta": {...}}. `archivos` son los uploads;
    cada uno trae su id de campo en el filename con prefijo `<campo>::<nombre>`."""
    tenant = db.query(Tenant).filter(Tenant.slug == slug).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")

    try:
        data = json.loads(payload)
        if not isinstance(data, dict):
            raise ValueError
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payload inválido")

    values = data.get("values") or {}
    extra = data.get("extra") or []
    meta = data.get("meta") or {}

    if len(archivos) > MAX_FILES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Demasiados archivos")

    # Guardar archivos en el volumen: uploads/intake/<slug>/<submission_uuid>/
    sub_uuid = uuid.uuid4().hex
    dest_dir = os.path.join(UPLOADS_DIR, "intake", _safe_name(slug), sub_uuid)
    archivos_meta: list[dict] = []
    for up in archivos:
        if not up or not up.filename:
            continue
        # El front prefija el filename con "<campo>::<nombre real>" para saber a
        # qué campo del formulario pertenece cada archivo.
        raw = up.filename
        campo, _, nombre = raw.partition("::")
        if not nombre:
            campo, nombre = "archivos", raw
        contenido = await up.read()
        if len(contenido) > MAX_FILE_BYTES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Archivo demasiado grande: {nombre}")
        os.makedirs(dest_dir, exist_ok=True)
        file_id = uuid.uuid4().hex
        safe = _safe_name(nombre)
        disk_path = os.path.join(dest_dir, f"{file_id}_{safe}")
        with open(disk_path, "wb") as fh:
            fh.write(contenido)
        archivos_meta.append({
            "id": file_id,
            "campo": campo,
            "nombre_original": nombre,
            "path": disk_path,
            "content_type": up.content_type,
            "size": len(contenido),
        })

    sub = IntakeSubmission(
        tenant_id=tenant.id,
        slug=tenant.slug,
        payload={"values": values, "extra": extra, "meta": meta},
        archivos=archivos_meta,
        estado="pendiente",
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    # Consolidar las respuestas en info_negocio para que el cliente las vea (y las
    # edite) en su Configuración apenas completa. El análisis fino (mapear a
    # tenant_config + calificar prospects) lo hacemos aparte sobre IntakeSubmission.
    cfg = db.query(TenantConfig).filter(TenantConfig.tenant_id == tenant.id).first()
    if not cfg:
        cfg = TenantConfig(tenant_id=tenant.id)
        db.add(cfg)
    info = dict(cfg.info_negocio or {})
    info["values"] = values
    info["extra"] = extra
    info["intake_at"] = datetime.now(timezone.utc).isoformat()
    info["updated_at"] = info["intake_at"]
    cfg.info_negocio = info
    db.commit()

    # Avisar al dueño (push a todos los devices) que el cliente completó el form.
    n_campos = len([v for v in values.values() if v not in (None, "", [], {})])
    push.notificar_aviso_async(
        f"📋 Relevamiento completado — {tenant.nombre}",
        f"{tenant.nombre} completó el formulario ({n_campos} datos, {len(archivos_meta)} archivo/s).",
        {"tipo": "intake", "tenant_id": tenant.id, "submission_id": sub.id},
    )

    return {"ok": True, "submission_id": sub.id, "recibido_at": datetime.now(timezone.utc).isoformat()}
