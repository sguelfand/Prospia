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
    contenido: Mapped[str] = mapped_column(Text, nullable=False)         # el texto del error
    # Ciclo de vida que maneja Sebi+Claude: 'nuevo' (recién capturado, solo alerta)
    # → 'reportado' (Sebi tocó "Reportar" en la app/web → entra a la cola que reviso)
    # → 'fixed' (Claude lo solucionó). `resuelto` queda sincronizado (resuelto ⇔ fixed)
    # para compatibilidad con consumidores viejos.
    estado: Mapped[str] = mapped_column(String(20), default="nuevo", server_default="nuevo", index=True)
    resuelto: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    fecha: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
