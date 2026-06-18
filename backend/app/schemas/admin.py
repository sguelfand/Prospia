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


class EtiguelLead(BaseModel):
    """Un lead de Etiguel (board Leads de Monday), filtrado y con los campos que
    pidió Sebi: estado, origen, fecha creación, teléfono, descripción, nombre, email."""
    descripcion: str          # el "elemento" / name del item en Monday
    nombre: str | None
    estado: str
    origen: str | None
    fecha_creacion: str | None
    telefono: str | None
    email: str | None


class OpcionFiltro(BaseModel):
    """Una opción seleccionable en el panel de filtros (término o rubro)."""
    id: int
    label: str


class FiltrosCliente(BaseModel):
    """Opciones disponibles para filtrar los prospects de un cliente. Alimenta el
    botón 'Filtrar' de la vista de cliente en la app admin."""
    estados: list[str]                 # estados posibles (fijos)
    terminos: list[OpcionFiltro]       # términos del tenant
    rubros: list[OpcionFiltro]         # rubros del tenant
    meses: list[str]                   # meses con prospects (YYYY-MM), desc


class PushPrefIn(BaseModel):
    """La app setea si un device quiere o no push de un cliente."""
    expo_token: str
    enabled: bool


class PushPrefOut(BaseModel):
    """Estado del push de un cliente para un device."""
    enabled: bool


class ClienteComparativa(BaseModel):
    """Métricas comparables de un cliente para el dashboard (APP.6)."""
    tenant_id: int
    nombre: str
    fuente: str
    total_prospects: int
    contactados: int
    en_conversacion: int
    interesados: int
    interesados_mes: int
    tasa_respuesta: float    # respondieron / contactados * 100
    tasa_conversion: float   # interesados / contactados * 100


class DashboardComparativa(BaseModel):
    """Dashboard agregado: totales globales + métricas por cliente en un request."""
    total_clientes: int
    total_prospects: int
    en_conversacion: int
    interesados: int
    interesados_mes: int
    clientes: list[ClienteComparativa]


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
