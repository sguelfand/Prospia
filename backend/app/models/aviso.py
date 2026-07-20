from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Aviso(Base):
    """Registro persistido de un push REAL enviado (#42). Cada vez que el backend
    manda una notificación (interesado, primera respuesta, error, mensaje
    entrante, cola terminada, etc.) se guarda acá para que la pantalla de Avisos
    de la app muestre el historial real (antes los push eran efímeros). Se borran
    automáticamente los de más de 3 días."""
    __tablename__ = "avisos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tipo: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Conclusión completa (texto largo) que se ve al tocar "Detalle" en la app.
    # Solo la usan los avisos que la traen (p.ej. claude_termino); el resto la deja NULL.
    detalle: Mapped[str | None] = mapped_column(Text, nullable=True)
    tenant_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # cliente, si aplica
    cliente: Mapped[str | None] = mapped_column(String(160), nullable=True)  # nombre del tenant
    prospect_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Deep-link a una sesión de Claude (avisos sesion_espera/sesion_termino) → botón "Ver".
    sesion_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fecha: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
