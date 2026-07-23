export interface Prospect {
  id: number
  nombre: string
  url: string | null
  email: string | null
  telefono: string | null
  whatsapp: string | null
  estado: string
  termino_id: number | null
  termino_texto: string | null
  rubro_id: number | null
  rubro_nombre: string | null
  cant_contactos: number
  cant_mensajes: number
  ult_contacto: string | null
  prox_contacto: string | null
  prox_contacto_estimado?: string | null  // '~AAAA-MM-DD' estimado de reactivación (Bug C)
  clasificacion: 'ALTO' | 'MEDIO' | 'BAJO' | 'CANCELADO' | null
  clasificacion_detalle: string | null
  clasificacion_verificada: boolean
  envio_no_confirmado: boolean   // chip "envío sin confirmar" (verificación WA)
  created_at: string
}

export interface ProspectsPage {
  items: Prospect[]
  total: number
  page: number
  page_size: number
}

export interface HistorialEntry {
  id: number
  fecha: string
  tipo: string
  detalle: string | null
}

export interface Mensaje {
  id: number
  direccion: 'in' | 'out'
  texto: string
  fecha: string
}

export interface Termino {
  id: number
  texto: string
  encontrados: number
  interesados: number
  scraper_running: boolean
  created_at: string
}

export interface DashboardStats {
  total_prospects: number
  por_estado:     { estado: string; count: number }[]
  por_estado_mes: { estado: string; count: number }[]
  por_termino:    { termino: string; termino_id: number; encontrados: number; en_conversacion: number; interesados: number }[]
  por_mes:        { mes: string; encontrados: number; interesados: number; no_le_interesa: number }[]
  mes_actual: {
    prospects:       number
    en_conversacion: number
    interesados:     number
    tasa_respuesta:  number
    tasa_conversion: number
  }
}

export interface ClienteComparativa {
  tenant_id: number
  nombre: string
  fuente: string
  total_prospects: number
  contactados: number
  en_conversacion: number
  interesados: number
  interesados_mes: number
  tasa_respuesta: number
  tasa_conversion: number
}

export interface DashboardComparativa {
  total_clientes: number
  total_prospects: number
  en_conversacion: number
  interesados: number
  interesados_mes: number
  clientes: ClienteComparativa[]
}

export const ESTADOS: Record<string, { label: string; color: string }> = {
  sin_contactar:   { label: 'Sin contactar',    color: '#94a3b8' },
  en_cola:         { label: 'En cola',           color: '#3b82f6' },
  contactado:      { label: 'Contactado',        color: '#f59e0b' },
  en_conversacion: { label: 'En conversación',   color: '#8b5cf6' },
  interesado:      { label: 'Interesado',        color: '#22c55e' },
  no_le_interesa:  { label: 'No le interesa',    color: '#6b7280' },
  cancelado:       { label: 'Cancelado',         color: '#dc2626' },
}

export const HISTORIAL_TIPOS: Record<string, { label: string; color: string }> = {
  contactado_wa:    { label: 'WA enviado',          color: '#22c55e' },
  contactado_email: { label: 'Email enviado',        color: '#3b82f6' },
  estado_cambiado:  { label: 'Estado cambiado',      color: '#94a3b8' },
  en_cola_auto:     { label: 'Re-encolado auto',     color: '#f59e0b' },
  en_conversacion:  { label: 'En conversación',      color: '#8b5cf6' },
  cancelado_auto:   { label: 'Cancelado auto',       color: '#dc2626' },
}
