from __future__ import annotations
from datetime import datetime

from pydantic import BaseModel


class ProspectOut(BaseModel):
    id: int
    nombre: str
    url: str | None
    email: str | None
    telefono: str | None
    whatsapp: str | None
    estado: str
    termino_id: int | None
    termino_texto: str | None = None
    rubro_id: int | None
    rubro_nombre: str | None = None
    cant_contactos: int
    ult_contacto: datetime | None
    prox_contacto: datetime | None = None   # callback agendado
    clasificacion: str | None           # ALTO | MEDIO | BAJO
    clasificacion_detalle: str | None
    clasificacion_verificada: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ProspectEstadoUpdate(BaseModel):
    estado: str


class ProspectClasificacionUpdate(BaseModel):
    clasificacion: str | None = None          # ALTO | MEDIO | BAJO
    clasificacion_detalle: str | None = None
    clasificacion_verificada: bool | None = None


class ProspectsPage(BaseModel):
    items: list[ProspectOut]
    total: int
    page: int
    page_size: int


class HistorialOut(BaseModel):
    id: int
    fecha: datetime
    tipo: str
    detalle: str | None

    model_config = {"from_attributes": True}


class HistorialCreate(BaseModel):
    tipo: str
    detalle: str | None = None
    fecha: datetime | None = None  # si no se manda, se usa now()


class HistorialUpdate(BaseModel):
    tipo: str | None = None
    detalle: str | None = None
    fecha: datetime | None = None


# ── Webhooks que llama Camila (Grupo B) ───────────────────────────────────────
class AgendarContactoBody(BaseModel):
    fecha: datetime          # cuándo re-contactar (callback pedido por el cliente)
    resumen: str | None = None


class InteresResumenBody(BaseModel):
    resumen: str | None = None   # resumen de la charla que deja Camila
