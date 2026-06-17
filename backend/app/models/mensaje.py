from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ProspectMensaje(Base):
    """Espejo de la conversación de WhatsApp entre Camila y el prospect.

    Lo alimenta el plugin de OpenClaw (prospia-chat-logger) SIN pasar por el LLM:
    cada mensaje entrante (direccion='in') y saliente (direccion='out') se loguea
    acá vía POST /prospects/chat-log. La ficha del prospect lo muestra como un chat
    estilo WhatsApp. No agrega costo de tokens: solo copia texto ya existente."""
    __tablename__ = "prospect_mensajes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    prospect_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("prospects.id"), nullable=False, index=True
    )
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id"), nullable=False)
    direccion: Mapped[str] = mapped_column(String(3), nullable=False)  # 'in' | 'out'
    texto: Mapped[str] = mapped_column(Text, nullable=False)
    # Id del mensaje en WhatsApp/OpenClaw si viene: sirve para idempotencia (no
    # duplicar el mismo mensaje si el plugin reintenta el POST).
    wa_msg_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    fecha: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    prospect: Mapped["Prospect"] = relationship(back_populates="mensajes")  # noqa: F821
