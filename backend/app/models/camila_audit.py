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


class CamilaAuditMensual(Base):
    """Rollup mensual por source (para el gráfico histórico lineal). Una fila por
    (source, mes 'YYYY-MM'). `data` (JSON) tiene totales del mes + por_modelo +
    conversaciones (distintos teléfonos) + costo partido mensajes/errores."""
    __tablename__ = "camila_audit_mensual"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    mes: Mapped[str] = mapped_column(String(7), nullable=False, index=True)  # YYYY-MM
    costo_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    conversaciones: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    llamadas: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    data: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class CamilaOportunidad(Base):
    """Oportunidad de mejora FIJA: se acumula y queda 'abierta' hasta que Sebi
    avise y se marque 'resuelta'. NO se borra ni cambia en cada recálculo del
    auditor (ese era el problema: las oportunidades cambiaban solas). Dedup por
    (source, tipo, clave) — clave = teléfono de la conversación o '' para las de
    config. Si una resuelta se vuelve a detectar, se re-abre."""
    __tablename__ = "camila_oportunidad"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    tipo: Mapped[str] = mapped_column(String(40), nullable=False)
    clave: Mapped[str] = mapped_column(String(80), nullable=False, default="")  # tel o ''
    severidad: Mapped[str] = mapped_column(String(10), nullable=False, default="media")
    titulo: Mapped[str] = mapped_column(String(200), nullable=False)
    detalle: Mapped[str] = mapped_column(Text, nullable=False, default="")
    estado: Mapped[str] = mapped_column(String(10), nullable=False, default="abierta", index=True)  # abierta|resuelta
    primera_vez: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    ultima_vez: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    resuelta_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
