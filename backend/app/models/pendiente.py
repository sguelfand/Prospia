from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Pendiente(Base):
    """Una cosa pendiente de hacer (cross-proyecto). Lo carga Sebi desde la app
    o desde la web (prospia.app/pendientes.html). Campos base: texto + prioridad
    + área. Campos ricos (opcionales) = las secciones del tracker original:
    contexto, qué armar, consideraciones, depende, alcance (texto multilínea)."""
    __tablename__ = "pendientes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    texto: Mapped[str] = mapped_column(Text, nullable=False)
    prioridad: Mapped[str] = mapped_column(String(10), default="media")   # alta | media | baja
    area: Mapped[str] = mapped_column(String(20), default="app")          # app | web | etiguel
    hecho: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    fecha: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    # Detalle rico (opcional) — secciones que se ven al desplegar el ítem.
    contexto: Mapped[str | None] = mapped_column(Text, nullable=True)
    que_armar: Mapped[str | None] = mapped_column(Text, nullable=True)
    consideraciones: Mapped[str | None] = mapped_column(Text, nullable=True)
    depende: Mapped[str | None] = mapped_column(Text, nullable=True)
    alcance: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Cola de procesamiento: Sebi tilda pendientes y los manda a procesar.
    # cola_estado: NULL = no encolado | "pendiente" = en cola esperando |
    # "procesado" = Claude lo resolvió pero falta que Sebi lo confirme (→ hecho) |
    # "standby" = Claude lo frenó por falta de info; Sebi tiene que destrabarlo.
    cola_estado: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    cola_orden: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # momento de encolado → FIFO
