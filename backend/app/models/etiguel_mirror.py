from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class EtiguelMirror(Base):
    """Espejo en la app de un lead/prospect de Etiguel (que vive en Monday) que
    Camila contactó. Se carga/actualiza desde el webhook de Camila a partir del
    momento en que hay contacto/conversación, así Sebi lo ve en la app sin entrar
    a Monday (APP.7). Identidad = (tipo, item_id de Monday)."""
    __tablename__ = "etiguel_mirror"
    __table_args__ = (UniqueConstraint("tipo", "item_id", name="uq_etiguel_mirror_tipo_item"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tipo: Mapped[str] = mapped_column(String(20), nullable=False)        # "lead" | "prospect"
    item_id: Mapped[str] = mapped_column(String(40), nullable=False)     # id del item en Monday
    nombre: Mapped[str | None] = mapped_column(String(255))
    telefono: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(255))
    estado: Mapped[str | None] = mapped_column(String(60))
    # Próximo contacto agendado (cadencia automática o callback pedido). 'YYYY-MM-DD'.
    prox_contacto: Mapped[str | None] = mapped_column(String(20))
    # Lista negra: si está bloqueado, Camila no lo escucha ni le responde, y no
    # se lo vuelve a contactar. El bloqueo real vive en el webhook/plugins de
    # Camila (blacklist.json); este campo es el espejo para mostrar el estado en
    # la app y togglear el botón Bloquear/Desbloquear.
    bloqueado: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    bloqueado_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Última actividad (último contacto o mensaje): ordena la lista, más reciente arriba.
    ultima_actividad: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    mensajes: Mapped[list["EtiguelMirrorMensaje"]] = relationship(
        back_populates="mirror", cascade="all, delete-orphan"
    )


class EtiguelMirrorMensaje(Base):
    """Un mensaje espejado de la conversación de Camila con un item de Etiguel."""
    __tablename__ = "etiguel_mirror_mensajes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mirror_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("etiguel_mirror.id", ondelete="CASCADE"), nullable=False, index=True
    )
    direccion: Mapped[str] = mapped_column(String(3), nullable=False)   # "in" | "out"
    texto: Mapped[str] = mapped_column(Text, nullable=False)
    fecha: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    mirror: Mapped["EtiguelMirror"] = relationship(back_populates="mensajes")
