from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class IntakeSubmission(Base):
    """Envío crudo del formulario de relevamiento de un cliente. Guarda el payload
    completo (respuestas) + la lista de archivos subidos (metadata; los binarios
    viven en el volumen de uploads). Una fila por submit; el más reciente por
    tenant es el que se muestra/procesa. La versión "viva" y editable del negocio
    se consolida en TenantConfig.info_negocio."""
    __tablename__ = "intake_submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id"), nullable=False)
    slug: Mapped[str] = mapped_column(String(60), nullable=False)

    # Respuestas: {"values": {<field_id>: valor}, "extra": [...], "meta": {...}}
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    # Archivos subidos: [{"id","campo","nombre_original","path","content_type","size"}]
    archivos: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))

    # Estado de procesamiento: pendiente → procesado (lo consolidé en info_negocio)
    estado: Mapped[str] = mapped_column(String(20), default="pendiente", server_default="pendiente")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
