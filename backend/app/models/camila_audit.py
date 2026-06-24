from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CamilaAudit(Base):
    """Auditoría diaria de consumo de un agente Camila (tokens/costo/errores +
    oportunidades de mejora). Una fila por (source, fecha). `source` identifica al
    cliente/agente — hoy solo 'etiguel', extensible a los próximos clientes. El
    detalle completo (breakdown por modelo/sesión, top conversaciones, errores,
    oportunidades) va en `data` (JSON). Las columnas escalares son para listar/
    graficar la tendencia sin parsear el JSON."""
    __tablename__ = "camila_audit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    fecha: Mapped[str] = mapped_column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    costo_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    llamadas: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    errores: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    oportunidades: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    data: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
