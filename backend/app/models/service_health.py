from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ServiceHealth(Base):
    """Estado vivo de cada servicio monitoreado (webhook Etiguel, gateway de
    Camila, prospia.app, varen, DB, dependencias externas). Hay una fila por
    servicio (identificado por `slug`); el motor de monitoreo la actualiza en
    cada chequeo. Las DEFINICIONES de qué se chequea viven en
    services/monitoring.py; esta tabla guarda el último resultado para mostrarlo
    en la app/web y para detectar transiciones (OK→caído → push)."""
    __tablename__ = "service_health"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(60), unique=True, nullable=False, index=True)
    nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    grupo: Mapped[str] = mapped_column(String(40), nullable=False, default="otros")
    # estado: up | down | warn | unknown
    estado: Mapped[str] = mapped_column(String(12), nullable=False, default="unknown")
    last_check: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_ok: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # desde cuándo está en el estado actual (para "caído hace X")
    since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    detalle: Mapped[str | None] = mapped_column(Text, nullable=True)
    # critico=True → dispara push cuando pasa a caído. Externos suelen ser False.
    critico: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    orden: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class MonitorSettings(Base):
    """Config del monitoreo (fila única id=1): intervalo del chequeo automático y
    el deploy token de Etiguel (para el check del gateway de Camila vía
    /camila-config/diag). El token se guarda acá —no en el env de Coolify— para
    poder setearlo por SQL sin depender del panel; tiene fallback al env
    settings.ETIGUEL_DEPLOY_TOKEN si esta columna está vacía."""
    __tablename__ = "monitor_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=300)
    etiguel_deploy_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
