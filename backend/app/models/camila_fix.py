from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CamilaFix(Base):
    """Registro de un arreglo MANUAL de Camila (lo que Sebi/Claude arregla a mano,
    fuera del loop automático de aprendizaje). Sirve de "changelog de fixes" para
    que el Especialista de Calidad lo consulte ANTES de reportar y no cargue una
    oportunidad de mejora ya resuelta (duplicada).

    - `telefono`: número del cliente cuya conversación motivó el fix (opcional; un
      fix puede ser general, sin número).
    - `descripcion`: qué se arregló (el cambio hecho a mano).
    - `source`: tenant/origen ('etiguel' por defecto).
    """
    __tablename__ = "camila_fixes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(60), default="etiguel", index=True)
    telefono: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    descripcion: Mapped[str] = mapped_column(Text, nullable=False)
    categoria: Mapped[str | None] = mapped_column(String(30), nullable=True)  # opcional: misma taxonomía que camila_revision
    creado_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
