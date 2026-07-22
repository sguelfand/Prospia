from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, String, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ClientePricing(Base):
    """Parámetros comerciales de un cliente (pantalla Precios). Una fila por
    `source` (mismo identificador que camila_audit: 'etiguel', y cada cliente
    nuevo al cablear su bot). Guarda lo que Sebi quiere COBRAR y la estimación
    de costo por conversación con su origen, para calcular margen contra los
    costos reales del monitor de Tokens."""
    __tablename__ = "cliente_pricing"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(60), nullable=False, unique=True, index=True)
    abono_mensual_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    conversaciones_dia: Mapped[float | None] = mapped_column(Float, nullable=True)
    costo_conv_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    # De dónde sale costo_conv_usd: 'medido' (datos reales del monitor) |
    # 'simulado' (corrida Test LLM del cliente) | 'estimado_etiguel' (default
    # para clientes sin datos propios — lleva leyenda en la pantalla).
    costo_conv_origen: Mapped[str] = mapped_column(String(20), nullable=False,
                                                   default="estimado_etiguel")
    motor_primario: Mapped[str | None] = mapped_column(String(120), nullable=True)
    motor_fallback: Mapped[str | None] = mapped_column(String(120), nullable=True)
    notas: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc))


class ServicioCosto(Base):
    """Catálogo de TODOS los servicios que generan costo. Regla fija: cada
    función/servicio nuevo que gaste plata se registra acá (y se le avisa a Sebi
    qué representa por cliente). `costo_mensual_usd` en None = dato faltante que
    la pantalla Precios pide completar."""
    __tablename__ = "servicio_costo"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    # 'fijo_compartido' (estructura: Hetzner, dominio) | 'fijo_cliente' (por cada
    # cliente: hosting OpenClaw, número WA) | 'variable' (escala con el uso:
    # tokens, Apify — se calcula, no se carga a mano).
    tipo: Mapped[str] = mapped_column(String(20), nullable=False)
    # None = aplica a todos los clientes (plantilla); un source concreto =
    # instancia con monto propio de ese cliente.
    source: Mapped[str | None] = mapped_column(String(60), nullable=True, index=True)
    costo_mensual_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    detalle: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc))
