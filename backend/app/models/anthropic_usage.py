from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AnthropicUsage(Base):
    """Un llamado a la API de Anthropic hecho por una función interna de Prospia
    (NO Camila, que va por MyClaw). Lo registran los helpers/agentes que usan la
    key de Anthropic directa (Especialista Negocio, diagnóstico de costos, intake,
    clasificación, asistente de ayuda…). Sirve para ver en Tokens cuánto cuesta
    cada función, separado del costo de Camila.

    `funcion` = etiqueta legible (ej. 'Especialista Negocio (calidad)'). Costo =
    tokens × precio OFICIAL de Anthropic (es key directa, sin el 10% off de MyClaw)."""
    __tablename__ = "anthropic_usage"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Cliente al que se le atribuye el gasto ('etiguel' o slug del tenant). NULL =
    # global/sin atribuir (funciones que no son de un cliente puntual).
    source: Mapped[str | None] = mapped_column(String(60), nullable=True, index=True)
    funcion: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    modelo: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    fecha: Mapped[str] = mapped_column(String(10), nullable=False, index=True)  # YYYY-MM-DD (BA)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_read: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_write: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    costo_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
