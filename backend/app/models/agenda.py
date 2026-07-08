from __future__ import annotations
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AgendaItem(Base):
    """Una tarea programada con fecha (agenda de Sebi). FUENTE ÚNICA compartida
    entre Claude y la app: reemplaza al viejo AGENDA.md local.
    - Claude la escribe/lee (hook SessionStart) para recordarle a Sebi lo de hoy.
    - La app la muestra y hace ABM (alta/baja/modificación).
    `origen`: quién la cargó (claude | sebi). `hecho` + `hecho_fecha` = completada.
    """
    __tablename__ = "agenda_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    fecha: Mapped[date] = mapped_column(Date, nullable=False, index=True)  # día programado
    descripcion: Mapped[str] = mapped_column(Text, nullable=False)
    hecho: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    hecho_fecha: Mapped[date | None] = mapped_column(Date, nullable=True)
    origen: Mapped[str] = mapped_column(String(10), default="sebi")  # claude | sebi
    creado_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    actualizado_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
