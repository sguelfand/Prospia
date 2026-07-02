from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AgentError(Base):
    """Un error de un agente (Camila & co.) que el outbound-guard interceptó antes
    de que llegara al cliente. Lo capturamos para poder revisarlo y arreglarlo.

    El `id` es el NÚMERO con el que Sebi lo identifica ("error #5"). Procedimiento:
    Sebi lo ve en la app → me pasa el número → lo resolvemos → lo borro."""
    __tablename__ = "agent_errors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # el "#número"
    fuente: Mapped[str] = mapped_column(String(30), default="etiguel")   # etiguel | <tenant>
    agente: Mapped[str | None] = mapped_column(String(60))               # "Camila" / agentId
    telefono: Mapped[str | None] = mapped_column(String(50))             # a quién iba dirigido
    patron: Mapped[str | None] = mapped_column(String(120))              # qué patrón lo marcó como error
    contenido: Mapped[str] = mapped_column(Text, nullable=False)         # el texto del error (descripción corta)
    detalle: Mapped[str | None] = mapped_column(Text)                    # extra: transcripción de la imagen adjunta (carga manual)
    # Ciclo de vida que maneja Sebi+Claude: 'nuevo' (recién capturado, solo alerta)
    # → 'reportado' (Sebi tocó "Reportar" en la app/web → entra a la cola que reviso)
    # → 'fixed' (Claude lo solucionó). `resuelto` queda sincronizado (resuelto ⇔ fixed)
    # para compatibilidad con consumidores viejos.
    estado: Mapped[str] = mapped_column(String(20), default="nuevo", server_default="nuevo", index=True)
    resuelto: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    fecha: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    # ── cola de procesamiento (mismo patrón que Pendiente): Sebi tilda varios y los
    # manda a procesar; Claude los levanta FIFO, los arregla y los marca 'procesado'.
    #   cola_estado: NULL (no encolado) | 'pendiente' (esperando) | 'procesado'
    #     (Claude terminó, falta que Sebi confirme→fixed) | 'standby' (frenado por falta de info)
    #   cola_orden: timestamp de encolado → orden FIFO
    #   cola_resultado: resumen de lo que Claude hizo (lo ve Sebi al confirmar)
    cola_estado: Mapped[str | None] = mapped_column(String(20), index=True)
    cola_orden: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cola_resultado: Mapped[str | None] = mapped_column(Text)
