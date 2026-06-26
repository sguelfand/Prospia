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

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from fastapi import Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.intake_submission import IntakeSubmission
from app.models.tenant import Tenant, TenantConfig
from app.services import info_negocio as info_negocio_svc
from app.services import intake_ai, push
from app.services.intake_schema import secciones_config, secciones_publicas

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


def _required_ids() -> list[str]:
    """Ids de los campos obligatorios (excluye archivos, que no son de texto)."""
    out: list[str] = []
    for s in secciones_publicas():
        for c in s["campos"]:
            if c.get("oblig") and c.get("tipo") != "archivo":
                out.append(c["id"])
    return out


def _es_vacio(v) -> bool:
    if isinstance(v, list):
        return len(v) == 0
    return v is None or str(v).strip() == ""


def _pct_completado(values: dict) -> int:
    """% de campos obligatorios completados, para el header del formulario."""
    req = _required_ids()
    if not req:
        return 100
    done = sum(1 for cid in req if not _es_vacio((values or {}).get(cid)))
    return round(done / len(req) * 100)


@router.get("/intake-schema")
def intake_schema():
    """Esquema de secciones/campos del formulario (fuente única)."""
    return {"secciones": secciones_publicas()}


@router.get("/intake/{slug}")
def intake_meta(slug: str, db: Session = Depends(get_db)):
    """Datos del cliente + borrador guardado, para encabezar y RESTAURAR el
    formulario (el autoguardado vive en el server, así Alan puede retomar desde
    cualquier dispositivo)."""
    tenant = db.query(Tenant).filter(Tenant.slug == slug).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    cfg = db.query(TenantConfig).filter(TenantConfig.tenant_id == tenant.id).first()
    info = (cfg.info_negocio if cfg else None) or {}
    values = info.get("values", {})
    return {
        "slug": tenant.slug,
        "nombre": tenant.nombre,
        "values": values,
        "extra": info.get("extra", []),
        "archivos": info_negocio_svc.archivos_del_tenant(db, tenant.id),
        "pct": _pct_completado(values),
    }


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


# ── Autoguardado (borrador) ───────────────────────────────────────────────────
# El formulario ya no tiene botón "Enviar": guarda solo a medida que Alan escribe.
# Cada PUT consolida en TenantConfig.info_negocio (la versión viva que ve Sebi en
# la app/web) y avisa por push una vez al empezar y una vez al llegar al 100%.

class DraftBody(BaseModel):
    values: dict = {}
    extra: list = []


def _avisar_relevamiento(db: Session, tenant: Tenant, cfg: TenantConfig, values: dict) -> int:
    """Dispara los push de hito (empezó / completó) una sola vez cada uno y deja
    constancia en info_negocio. Devuelve el % completado."""
    pct = _pct_completado(values)
    info = dict(cfg.info_negocio or {})
    avisos = dict(info.get("avisos_relevamiento") or {})
    hay_algo = any(not _es_vacio(v) for v in (values or {}).values())
    cambio = False

    if hay_algo and not avisos.get("iniciado"):
        avisos["iniciado"] = True
        cambio = True
        push.notificar_aviso_async(
            f"📝 Relevamiento en curso — {tenant.nombre}",
            f"{tenant.nombre} empezó a completar el formulario.",
            {"tipo": "intake", "hito": "iniciado", "tenant_id": tenant.id},
        )
    if pct >= 100 and not avisos.get("completado"):
        avisos["completado"] = True
        cambio = True
        if not info.get("intake_at"):
            info["intake_at"] = datetime.now(timezone.utc).isoformat()
        push.notificar_aviso_async(
            f"📋 Relevamiento completado — {tenant.nombre}",
            f"{tenant.nombre} completó todos los campos obligatorios del formulario.",
            {"tipo": "intake", "hito": "completado", "tenant_id": tenant.id},
        )

    if cambio:
        info["avisos_relevamiento"] = avisos
        cfg.info_negocio = info
        db.commit()
    return pct


@router.put("/intake/{slug}/draft")
def intake_draft(slug: str, body: DraftBody, db: Session = Depends(get_db)):
    """Autoguardado del formulario. Consolida values+extra en info_negocio (fuente
    viva) y notifica los hitos. No crea una submission por tecla."""
    tenant = db.query(Tenant).filter(Tenant.slug == slug).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    cfg = db.query(TenantConfig).filter(TenantConfig.tenant_id == tenant.id).first()
    if not cfg:
        cfg = TenantConfig(tenant_id=tenant.id)
        db.add(cfg)
        db.commit()
    updated_at = info_negocio_svc.save(db, cfg, body.values or {}, body.extra or [])
    pct = _avisar_relevamiento(db, tenant, cfg, body.values or {})
    return {"ok": True, "updated_at": updated_at, "pct": pct}


def _get_or_create_borrador(db: Session, tenant: Tenant) -> IntakeSubmission:
    """Submission 'borrador' única del tenant donde se acumulan los archivos que
    sube por el formulario (los binarios no entran en el autoguardado JSON)."""
    sub = (
        db.query(IntakeSubmission)
        .filter(IntakeSubmission.tenant_id == tenant.id, IntakeSubmission.estado == "borrador")
        .order_by(IntakeSubmission.created_at.desc())
        .first()
    )
    if not sub:
        sub = IntakeSubmission(
            tenant_id=tenant.id, slug=tenant.slug,
            payload={"values": {}, "extra": [], "meta": {"draft": True}},
            archivos=[], estado="borrador",
        )
        db.add(sub)
        db.commit()
        db.refresh(sub)
    return sub


@router.post("/intake/{slug}/archivo", status_code=status.HTTP_201_CREATED)
async def intake_archivo(
    slug: str,
    campo: str = Form(...),
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Sube UN archivo apenas Alan lo adjunta y lo guarda en el borrador del
    tenant. Devuelve su metadata para mostrarlo en la lista (con su id, para poder
    borrarlo después)."""
    tenant = db.query(Tenant).filter(Tenant.slug == slug).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    if not archivo or not archivo.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Archivo vacío")

    sub = _get_or_create_borrador(db, tenant)
    archivos = list(sub.archivos or [])
    if len(archivos) >= MAX_FILES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Demasiados archivos")

    contenido = await archivo.read()
    if len(contenido) > MAX_FILE_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Archivo demasiado grande (máx 25 MB)")

    dest_dir = os.path.join(UPLOADS_DIR, "intake", _safe_name(slug), f"draft_{sub.id}")
    os.makedirs(dest_dir, exist_ok=True)
    file_id = uuid.uuid4().hex
    nombre = archivo.filename
    safe = _safe_name(nombre)
    disk_path = os.path.join(dest_dir, f"{file_id}_{safe}")
    with open(disk_path, "wb") as fh:
        fh.write(contenido)

    meta = {
        "id": file_id, "campo": campo, "nombre_original": nombre,
        "path": disk_path, "content_type": archivo.content_type, "size": len(contenido),
    }
    sub.archivos = archivos + [meta]  # nueva lista → SQLAlchemy detecta el cambio
    db.commit()

    return {"id": file_id, "campo": campo, "nombre_original": nombre, "size": len(contenido)}


@router.delete("/intake/{slug}/archivo/{file_id}")
def intake_archivo_delete(slug: str, file_id: str, db: Session = Depends(get_db)):
    """Quita un archivo del borrador (lista + binario en disco)."""
    tenant = db.query(Tenant).filter(Tenant.slug == slug).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    sub = (
        db.query(IntakeSubmission)
        .filter(IntakeSubmission.tenant_id == tenant.id, IntakeSubmission.estado == "borrador")
        .order_by(IntakeSubmission.created_at.desc())
        .first()
    )
    archivos = list(sub.archivos or []) if sub else []
    objetivo = next((a for a in archivos if a.get("id") == file_id), None)
    if not objetivo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Archivo no encontrado")
    path = objetivo.get("path")
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass
    sub.archivos = [a for a in archivos if a.get("id") != file_id]
    db.commit()
    return {"ok": True}


class AyudaMsg(BaseModel):
    role: str = "user"
    content: str = ""


class AyudaBody(BaseModel):
    mensajes: list[AyudaMsg] = []


@router.post("/intake/{slug}/ayuda")
def intake_ayuda(slug: str, body: AyudaBody, request: Request, db: Session = Depends(get_db)):
    """Chat de ayuda del formulario (público): responde dudas del cliente sobre
    qué poner en cada campo. Acotado al formulario y con rate-limit por IP para
    que el endpoint abierto no se abuse."""
    tenant = db.query(Tenant).filter(Tenant.slug == slug).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")

    ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
          or (request.client.host if request.client else "anon"))
    if not intake_ai.rate_limit_ok(ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiadas consultas seguidas. Probá de nuevo en un rato.",
        )

    mensajes = [{"role": m.role, "content": m.content} for m in body.mensajes]
    respuesta = intake_ai.ayuda_chat(mensajes, secciones_config(), empresa=tenant.nombre)
    if respuesta is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="El asistente no está disponible en este momento.",
        )
    return {"respuesta": respuesta}
