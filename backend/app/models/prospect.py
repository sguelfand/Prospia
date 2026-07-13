from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

ESTADOS = [
    "sin_contactar",
    "en_cola",
    "contactado",
    "en_conversacion",
    "interesado",
    "no_le_interesa",
    "cancelado",
]

# Cadencia de re-contacto según cantidad de contactos previos (en días)
# Tras el 4° contacto sin respuesta, el cadence job pasa el prospect a "cancelado"
# (ver CANCELAR_DIAS_TRAS_CUARTO en services/cadence.py)
CADENCIA_DIAS = {1: 7, 2: 14, 3: 90}


class Prospect(Base):
    __tablename__ = "prospects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id"), nullable=False)
    termino_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("terminos.id"))
    rubro_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("rubros.id"))

    nombre: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str | None] = mapped_column(String(500))
    email: Mapped[str | None] = mapped_column(String(255))
    telefono: Mapped[str | None] = mapped_column(String(50))
    whatsapp: Mapped[str | None] = mapped_column(String(50))
    estado: Mapped[str] = mapped_column(String(30), default="sin_contactar")
    id_scraper: Mapped[str | None] = mapped_column(String(120))
    cant_contactos: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    ult_contacto: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    prox_contacto: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # callback agendado
    clasificacion: Mapped[str | None] = mapped_column(String(10), nullable=True)   # ALTO | MEDIO | BAJO
    clasificacion_detalle: Mapped[str | None] = mapped_column(Text, nullable=True)
    clasificacion_verificada: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Verificación de envío real ("¿salió el WhatsApp?"). Al contactar por WA se
    # setea envio_pendiente_desde; el chat-log de un 'out' real lo limpia. Si pasa
    # la ventana sin 'out', el barrido avisa y marca envio_no_confirmado=True (chip
    # en web/app). Se limpia al confirmar un envío real posterior.
    envio_pendiente_desde: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    envio_no_confirmado: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Reintentos automáticos del envío sin confirmar (Parte B): el barrido re-inyecta
    # el mensaje hasta WA_CONFIRM_MAX_REINTENTOS veces antes de avisar. Se resetea a 0
    # al confirmar un 'out' real o al iniciar un contacto nuevo.
    envio_reintentos: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Reactivación de conversaciones abandonadas (#100): cliente que respondió y
    # después dejó de contestar. `reactivacion_intentos` = cuántas veces se lo
    # re-preguntó "¿viste mi mensaje?"; `reactivacion_base` = fecha del último
    # mensaje del cliente sobre la que se basan los intentos (si responde algo más
    # nuevo → revival → se resetea). NO se tocan cant_contactos/ult_contacto (para
    # no reactivar la cadencia normal, que es un flujo distinto).
    reactivacion_intentos: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    reactivacion_base: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Lista negra (solo la setea Sebi/superadmin desde la app). Si está bloqueado:
    # la cadencia no lo re-contacta, no se lo puede contactar, y el bloqueo viaja
    # al bot del tenant (deja de escucharlo/responderle) si su webhook está conectado.
    bloqueado: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    bloqueado_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    tenant: Mapped["Tenant"] = relationship(back_populates="prospects")  # noqa: F821
    termino: Mapped["Termino"] = relationship(back_populates="prospects")  # noqa: F821
    rubro: Mapped["Rubro"] = relationship(back_populates="prospects")  # noqa: F821
    historial: Mapped[list["ProspectHistorial"]] = relationship(back_populates="prospect")  # noqa: F821
    mensajes: Mapped[list["ProspectMensaje"]] = relationship(back_populates="prospect")  # noqa: F821
