from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Consulta(Base):
    """Una pregunta que un agente (Camila & co.) escaló porque no supo qué
    responderle a un cliente. La emite con la señal `CAMILA_CONSULTA|num|pregunta`
    → el plugin la postea acá → Sebi (superadmin) la contesta desde la app/web →
    la respuesta se relaya al webhook (`RESPONDER_CONSULTA|num|texto`) → el agente
    la reenvía al cliente.

    El `id` es el #número con el que se identifica la consulta.

    Tenant-aware desde el día 1 (`fuente`/`tenant_id`): hoy solo se usa Etiguel y
    la UI es superadmin-only, pero a futuro cada cliente contesta SUS consultas
    sin necesidad de migrar la tabla."""
    __tablename__ = "consultas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # el "#número"
    fuente: Mapped[str] = mapped_column(String(30), default="etiguel")   # etiguel | <tenant slug>
    tenant_id: Mapped[int | None] = mapped_column(Integer, index=True)   # scoping futuro multi-tenant
    agente: Mapped[str | None] = mapped_column(String(60))               # "Camila" / agentId
    telefono: Mapped[str | None] = mapped_column(String(50))             # cliente que preguntó
    pregunta: Mapped[str] = mapped_column(Text, nullable=False)          # lo que preguntó el cliente
    respuesta: Mapped[str | None] = mapped_column(Text)                  # lo que Sebi/cliente contestó
    # pendiente (sin contestar) → contestada (respondida y entregada al agente)
    estado: Mapped[str] = mapped_column(String(20), default="pendiente", server_default="pendiente", index=True)
    fecha: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    fecha_respuesta: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
