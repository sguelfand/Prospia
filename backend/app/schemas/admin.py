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


# ── Notificaciones por evento, por dispositivo (#38) ──────────────────────────
class DeviceOut(BaseModel):
    """Un dispositivo registrado para push (lo lista la web para configurarlo)."""
    expo_token: str
    platform: str | None = None


class NotifEvento(BaseModel):
    """Un evento de push con su estado (on/off) para un device."""
    evento: str
    label: str
    enabled: bool


class NotifPrefsOut(BaseModel):
    """Preferencias de notificación de un device: lista de eventos con su estado."""
    expo_token: str
    platform: str | None = None
    eventos: list[NotifEvento]


class NotifPrefUpdate(BaseModel):
    """Activa/desactiva un evento de push para un device."""
    expo_token: str
    evento: str
    enabled: bool


class ClienteNotifPrefsOut(BaseModel):
    """Preferencias de notificación de un device PARA UN CLIENTE (#44)."""
    tenant_id: int
    eventos: list[NotifEvento]


class ClienteNotifPrefUpdate(BaseModel):
    """Activa/desactiva un evento de push de un cliente para un device (#44)."""
    expo_token: str
    evento: str
    enabled: bool


class NotifyIn(BaseModel):
    """Dispara un push de evento global (lo usa Claude / un proceso interno)."""
    evento: str
    title: str
    body: str


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


class EtiguelMirrorIn(BaseModel):
    """Payload que manda el webhook de Camila para espejar un lead/prospect de
    Etiguel (APP.7). Si vienen direccion+texto, además agrega ese mensaje."""
    tipo: str                          # "lead" | "prospect"
    item_id: str                       # id del item en Monday
    nombre: str | None = None
    telefono: str | None = None
    email: str | None = None
    estado: str | None = None
    prox_contacto: str | None = None   # 'YYYY-MM-DD' próximo contacto; "" = limpiar
    direccion: str | None = None       # "in" | "out" (opcional: solo si hay mensaje)
    texto: str | None = None


class EtiguelMirrorMensajeOut(BaseModel):
    id: int
    direccion: str
    texto: str
    fecha: datetime

    model_config = {"from_attributes": True}


class EtiguelMirrorItem(BaseModel):
    """Un lead/prospect de Etiguel espejado, para la lista de la app."""
    id: int
    tipo: str
    item_id: str
    nombre: str | None
    telefono: str | None
    email: str | None
    estado: str | None
    prox_contacto: str | None = None
    ultima_actividad: datetime
    cant_mensajes: int


class AgentErrorIn(BaseModel):
    """Payload del plugin outbound-guard cuando bloquea un error de Camila."""
    contenido: str
    fuente: str = "etiguel"
    agente: str | None = None
    telefono: str | None = None
    patron: str | None = None


class AvisoIn(BaseModel):
    """Aviso genérico para push a la app (reemplaza mails de notificación).
    Lo postean el webhook y OpenClaw/Camila. categoria: primer_contacto |
    consulta | forward | smoke | apify | otro."""
    title: str
    body: str
    categoria: str | None = None


class AgentErrorOut(BaseModel):
    id: int                  # el "#número"
    fuente: str
    agente: str | None
    telefono: str | None
    patron: str | None
    contenido: str
    estado: str              # nuevo | reportado | fixed
    resuelto: bool
    fecha: datetime

    model_config = {"from_attributes": True}


class AgentErrorResolve(BaseModel):
    """PATCH del panel (app/web). Mandá `estado` (nuevo|reportado|fixed) — es lo
    que usa el botón Reportar. `resuelto` queda por compatibilidad: si solo viene
    `resuelto`, se traduce a estado fixed/nuevo."""
    estado: str | None = None
    resuelto: bool | None = None


class PendienteIn(BaseModel):
    """Alta de un pendiente desde la app o la web."""
    texto: str
    prioridad: str = "media"   # alta | media | baja
    area: str = "app"          # app | web | etiguel
    contexto: str | None = None
    que_armar: str | None = None
    consideraciones: str | None = None
    depende: str | None = None
    alcance: str | None = None


class PendienteUpdate(BaseModel):
    """Edición parcial de un pendiente (cualquier campo opcional)."""
    texto: str | None = None
    prioridad: str | None = None
    area: str | None = None
    hecho: bool | None = None
    contexto: str | None = None
    que_armar: str | None = None
    consideraciones: str | None = None
    depende: str | None = None
    alcance: str | None = None
    # cola: NULL = sacar de cola | "pendiente" | "procesado" | "standby"
    cola_estado: str | None = None
    cola_resultado: str | None = None


class ColaIn(BaseModel):
    """Tildar pendientes y mandarlos a la cola de procesamiento."""
    ids: list[int]


class PendienteOut(BaseModel):
    id: int
    texto: str
    prioridad: str
    area: str
    hecho: bool
    fecha: datetime
    contexto: str | None = None
    que_armar: str | None = None
    consideraciones: str | None = None
    depende: str | None = None
    alcance: str | None = None
    cola_estado: str | None = None
    cola_orden: datetime | None = None
    cola_resultado: str | None = None

    model_config = {"from_attributes": True}


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


class AvisoOut(BaseModel):
    """Un push real guardado (#42), para el historial de la pantalla Avisos."""
    id: int
    tipo: str
    title: str
    body: str
    tenant_id: int | None = None
    cliente: str | None = None
    prospect_id: int | None = None
    fecha: datetime

    model_config = {"from_attributes": True}


class AvisosEliminar(BaseModel):
    ids: list[int]


# ── Admin clientes: ver/editar la config esencial de un cliente (nivel 1) ──
class ClienteConfigOut(BaseModel):
    """Config esencial de un cliente para el editor de Admin clientes."""
    tenant_id: int
    nombre: str               # nombre del cliente (tenant)
    slug: str
    user_id: int | None       # usuario de login del cliente (si tiene)
    usuario: str | None       # su login
    user_nombre: str | None
    # Negocio / contacto (TenantConfig)
    negocio_nombre: str | None
    negocio_que_vende: str | None
    negocio_propuesta_valor: str | None
    negocio_zona: str | None
    pais: str | None
    sitio_web: str | None
    deriva_nombre: str | None
    deriva_whatsapp: str | None
    bot_numero_whatsapp: str | None
    # Contacto y envío
    envio_auto_habilitado: bool
    envio_tope_diario: int
    envio_delay_seg: int
    envio_hora_inicio: int
    envio_hora_fin: int
    wa_templates: list[str]
    # Cadencia de re-contacto
    cadencia_dias: dict
    cadencia_max_contactos: int
    cadencia_dias_cancelar: int


class ClienteConfigUpdate(BaseModel):
    nombre: str | None = None
    usuario: str | None = None
    user_nombre: str | None = None
    password: str | None = None    # si viene no vacío, setea nueva contraseña
    negocio_nombre: str | None = None
    negocio_que_vende: str | None = None
    negocio_propuesta_valor: str | None = None
    negocio_zona: str | None = None
    pais: str | None = None
    sitio_web: str | None = None
    deriva_nombre: str | None = None
    deriva_whatsapp: str | None = None
    bot_numero_whatsapp: str | None = None
    # Contacto y envío
    envio_auto_habilitado: bool | None = None
    envio_tope_diario: int | None = None
    envio_delay_seg: int | None = None
    envio_hora_inicio: int | None = None
    envio_hora_fin: int | None = None
    wa_templates: list[str] | None = None
    # Cadencia
    cadencia_dias: dict | None = None
    cadencia_max_contactos: int | None = None
    cadencia_dias_cancelar: int | None = None


class ResetPasswordOut(BaseModel):
    password: str             # la pass a la que se reseteó (default)


class ImpersonateOut(BaseModel):
    """Token para 'ver como cliente': sesión del usuario nivel 2 de ese tenant."""
    access_token: str
    cliente: str              # nombre del cliente que se está viendo
