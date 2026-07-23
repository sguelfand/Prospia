from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CamilaTriage(Base):
    """Estado + log del filtro rápido (triage) del monitor de calidad en TIEMPO REAL.

    Cada vez que una conversación se aquieta (Camila habló último y pasó el debounce),
    un modelo BARATO (default MiniMax por OpenRouter) le da un vistazo y devuelve un
    semáforo verde|amarillo|rojo. Amarillo/rojo escala al JUEZ completo (Sonnet) que,
    si corresponde, crea una CamilaRevision + push — igual que el especialista batch.

    Guardamos una fila POR (source, mirror_id): `last_msg_id` marca hasta dónde ya
    revisamos esa conversación (no re-triageamos lo mismo). Además queda como registro
    de qué dejó pasar el triage → la auditoría Opus en sesión cruza esto para detectar
    'escapes' (charlas que el triage marcó verde pero en realidad tenían un problema) y
    calibrar el filtro."""
    __tablename__ = "camila_triage"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(60), nullable=False, index=True, default="etiguel")
    mirror_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    telefono: Mapped[str | None] = mapped_column(String(50))
    nombre: Mapped[str | None] = mapped_column(String(255))

    # Hasta qué id de mensaje ya miramos esta conversación (para no repetir el triage).
    last_msg_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Último veredicto del filtro: verde | amarillo | rojo.
    veredicto: Mapped[str] = mapped_column(String(10), nullable=False, default="verde")
    motivo: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # ¿Escaló al juez? ¿El juez terminó creando una revisión?
    escalado: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    genero_revision: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Qué motor hizo el triage (para trazabilidad si cambiamos de modelo).
    modelo: Mapped[str | None] = mapped_column(String(80))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc), index=True,
    )
