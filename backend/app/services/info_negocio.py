"""Lógica compartida de "Información del negocio" (relevamiento).

La usan tanto los endpoints self-scoped del cliente (`/me/info-negocio`) como
los de admin (`/admin/clientes/{id}/info-negocio`). Ambos editan el MISMO
`TenantConfig.info_negocio` (JSONB), así que cliente y superadmin ven y
actualizan la misma fuente de verdad.

Al guardar, se espejan los campos operativos del relevamiento a las columnas de
`TenantConfig` que lee el bot/scraper/clasificador (p.ej. `pais` lo usa la
clasificación). Solo se copian valores NO vacíos, para no pisar config existente
con un casillero del relevamiento que todavía no se completó.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.intake_submission import IntakeSubmission
from app.models.tenant import TenantConfig
from app.services.intake_schema import secciones_config

# id del campo en el relevamiento  ->  columna de TenantConfig que lee el backend.
_MIRROR = {
    "nombre_comercial": "negocio_nombre",
    "que_vende": "negocio_que_vende",
    "propuesta_valor": "negocio_propuesta_valor",
    "zona_cobertura": "negocio_zona",
    "pais": "pais",
    "sitio_web": "sitio_web",
    "deriva_nombre": "deriva_nombre",
    "deriva_whatsapp": "deriva_whatsapp",
    "numero_bot": "bot_numero_whatsapp",
    "email_notificaciones": "notif_consultas_email",
}


def archivos_del_tenant(db: Session, tenant_id: int) -> list[dict]:
    """Metadata de los archivos del último relevamiento del tenant (sin el path)."""
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


def build_response(db: Session, tenant_id: int, cfg: TenantConfig) -> dict:
    """Esquema (config) + valores guardados + archivos, para el front."""
    info = cfg.info_negocio or {}
    return {
        "secciones": secciones_config(),
        "values": info.get("values", {}),
        "extra": info.get("extra", []),
        "intake_at": info.get("intake_at"),
        "updated_at": info.get("updated_at"),
        "archivos": archivos_del_tenant(db, tenant_id),
    }


def save(db: Session, cfg: TenantConfig, values: dict, extra: list) -> str:
    """Guarda values+extra en info_negocio y espeja los operativos a columnas.
    Devuelve el updated_at ISO. Hace commit."""
    values = values or {}
    prev = dict(cfg.info_negocio or {})
    prev["values"] = values
    prev["extra"] = extra or []
    updated_at = datetime.now(timezone.utc).isoformat()
    prev["updated_at"] = updated_at
    cfg.info_negocio = prev
    # Espejo a las columnas que lee el bot (solo no vacíos).
    for campo, col in _MIRROR.items():
        v = values.get(campo)
        if isinstance(v, str) and v.strip():
            setattr(cfg, col, v.strip())
    db.commit()
    return updated_at
