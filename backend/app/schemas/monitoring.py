from __future__ import annotations
from datetime import datetime

from pydantic import BaseModel


class ServiceHealthOut(BaseModel):
    slug: str
    nombre: str
    descripcion: str | None = None
    grupo: str
    estado: str  # up | down | warn | unknown
    last_check: datetime | None = None
    last_ok: datetime | None = None
    since: datetime | None = None
    latency_ms: int | None = None
    detalle: str | None = None
    critico: bool = True


class MonitorResumen(BaseModel):
    up: int = 0
    down: int = 0
    warn: int = 0
    unknown: int = 0
    total: int = 0


class MonitoringStatusOut(BaseModel):
    servicios: list[ServiceHealthOut]
    interval_seconds: int
    last_run: datetime | None = None
    resumen: MonitorResumen


class IntervalUpdate(BaseModel):
    interval_seconds: int
