from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ProspectHistorial(Base):
    __tablename__ = "prospect_historial"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    prospect_id: Mapped[int] = mapped_column(Integer, ForeignKey("prospects.id"), nullable=False)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id"), nullable=False)
    fecha: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    tipo: Mapped[str] = mapped_column(String(50), nullable=False)
    detalle: Mapped[str | None] = mapped_column(Text, nullable=True)

    prospect: Mapped["Prospect"] = relationship(back_populates="historial")  # noqa: F821
