from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Device(Base):
    """Dispositivo registrado para recibir push (la app de administración).
    Un super-admin puede tener varios (celular, tablet). El expo_token es el
    identificador que da Expo para mandarle notificaciones a ese aparato."""
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    expo_token: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    platform: Mapped[str | None] = mapped_column(String(20), nullable=True)  # android | ios
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
