from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PushEventMute(Base):
    """Silencio de un TIPO DE EVENTO de push para un device puntual (#38). Igual
    semántica que PushMute pero por evento en vez de por cliente: la PRESENCIA de
    una fila = ese device tiene SILENCIADO ese evento. Sin fila = evento activo
    (default activado). Por device (expo_token), no por usuario.

    eventos válidos: interesado | respuesta | error_camila | standby |
    cola_terminada | necesita_autorizacion (ver EVENTOS_PUSH en push.py)."""
    __tablename__ = "push_event_mutes"
    __table_args__ = (UniqueConstraint("expo_token", "evento", name="uq_push_event_mute_device_evento"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    expo_token: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    evento: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
