from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PushClienteEvento(Base):
    """Preferencia de push POR (device, cliente, evento) (#44). A diferencia de
    PushMute (todo/nada por cliente) y PushEventMute (global por evento), este
    permite togglear cada evento de forma independiente PARA UN CLIENTE.

    eventos: interesado | respuesta | mensaje_entrante. `enabled` explícito (si no
    hay fila, se usa el default: interesado/respuesta = ON, mensaje_entrante = OFF
    para no inundar). Se combina con el toggle global (PushEventMute): se manda el
    push sólo si el evento está activo globalmente Y para ese cliente."""
    __tablename__ = "push_cliente_evento"
    __table_args__ = (UniqueConstraint("expo_token", "tenant_id", "evento", name="uq_push_cli_evt"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    expo_token: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    evento: Mapped[str] = mapped_column(String(40), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
