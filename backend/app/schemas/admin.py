from datetime import datetime

from pydantic import BaseModel


class ClienteResumen(BaseModel):
    """KPIs resumidos de un cliente (tenant) para la lista del admin."""
    tenant_id: int
    nombre: str
    slug: str
    total_prospects: int
    en_conversacion: int          # estado actual == en_conversacion
    interesados: int              # estado actual == interesado
    interesados_mes: int          # interesados creados este mes
    ultimo_prospect: datetime | None  # created_at del prospect más reciente
    fuente: str = "plataforma"    # "plataforma" | "etiguel" (adapter Monday, Fase 4)


class AdminOverview(BaseModel):
    """Totales agregados de todos los clientes juntos."""
    total_clientes: int
    total_prospects: int
    en_conversacion: int
    interesados: int
    interesados_mes: int


class DeviceIn(BaseModel):
    """Registro de un dispositivo para push (lo manda la app al loguear)."""
    expo_token: str
    platform: str | None = None


class EventoOut(BaseModel):
    """Un evento del feed de Avisos: primera respuesta o interesado."""
    id: int
    fecha: datetime
    tipo: str                 # "en_conversacion" | "interesado"
    tenant_id: int
    cliente: str              # nombre del tenant
    prospect_id: int
    prospect_nombre: str
    detalle: str | None
    fuente: str = "plataforma"
