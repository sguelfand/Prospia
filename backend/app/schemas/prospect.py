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
    cant_mensajes: int = 0                   # mensajes del chat (espejo WhatsApp)
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


# ── Espejo de conversación WhatsApp (chat-log) ───────────────────────────────
class ChatLogBody(BaseModel):
    """Body del webhook que manda el plugin de OpenClaw por cada mensaje WA."""
    telefono: str               # número del prospect (in: remitente / out: destinatario)
    direccion: str              # 'in' (cliente → Camila) | 'out' (Camila → cliente)
    texto: str
    wa_msg_id: str | None = None  # id del mensaje en WA/OpenClaw, para idempotencia
    fecha: datetime | None = None  # si no viene, se usa now()


class MensajeOut(BaseModel):
    id: int
    direccion: str
    texto: str
    fecha: datetime

    model_config = {"from_attributes": True}
