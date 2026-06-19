from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Pendiente(Base):
    """Una cosa pendiente de hacer (cross-proyecto). Lo carga Sebi desde la app
    o se migran los que ya estaban en el tracker HTML local. Modelo simple:
    texto + prioridad + área (para dónde es)."""
    __tablename__ = "pendientes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    texto: Mapped[str] = mapped_column(Text, nullable=False)
    prioridad: Mapped[str] = mapped_column(String(10), default="media")   # alta | media | baja
    area: Mapped[str] = mapped_column(String(20), default="app")          # app | web | etiguel
    hecho: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    fecha: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
