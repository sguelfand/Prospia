from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Termino(Base):
    __tablename__ = "terminos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id"), nullable=False)
    texto: Mapped[str] = mapped_column(String(255), nullable=False)
    encontrados: Mapped[int] = mapped_column(Integer, default=0)
    interesados: Mapped[int] = mapped_column(Integer, default=0)
    scraper_running: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    tenant: Mapped["Tenant"] = relationship(back_populates="terminos")  # noqa: F821
    prospects: Mapped[list["Prospect"]] = relationship(back_populates="termino")  # noqa: F821
