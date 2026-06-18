from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PushMute(Base):
    """Silencio de push de un cliente para un device puntual. La preferencia es
    POR DEVICE (expo_token), no por usuario: cada celular decide qué clientes
    quiere escuchar. La PRESENCIA de una fila = ese device tiene SILENCIADO ese
    tenant. Sin fila = push activo (default activado para clientes nuevos).

    tenant_id se guarda como entero crudo (no FK) para poder representar también
    a Etiguel, que vive fuera de esta base (tenant_id sentinela -1)."""
    __tablename__ = "push_mutes"
    __table_args__ = (UniqueConstraint("expo_token", "tenant_id", name="uq_push_mute_device_tenant"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    expo_token: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
