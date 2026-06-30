import { API_URL } from "./config";

// ── Tipos (espejo de los schemas del backend) ────────────────────────────────

export interface ClienteResumen {
  tenant_id: number;
  nombre: string;
  slug: string;
  total_prospects: number;
  en_conversacion: number;
  interesados: number;
  interesados_mes: number;
  ultimo_prospect: string | null;
  fuente: string; // "plataforma" | "etiguel"
}

export interface AdminOverview {
  total_clientes: number;
  total_prospects: number;
  en_conversacion: number;
  interesados: number;
  interesados_mes: number;
}

export interface EstadoCount {
  estado: string;
  count: number;
}

export interface TerminoStat {
  termino: string;
  encontrados: number;
  en_conversacion: number;
  interesados: number;
}

export interface MesStat {
  mes: string;
  encontrados: number;
  interesados: number;
  no_le_interesa: number;
}

export interface MesActual {
  prospects: number;
  en_conversacion: number;
  interesados: number;
  tasa_respuesta: number;
  tasa_conversion: number;
}

export interface DashboardStats {
  total_prospects: number;
  por_estado: EstadoCount[];
  por_estado_mes: EstadoCount[];
  por_termino: TerminoStat[];
  por_mes: MesStat[];
  mes_actual: MesActual;
}

export interface Evento {
  id: number;
  fecha: string;
  tipo: string; // "en_conversacion" | "interesado"
  tenant_id: number;
  cliente: string;
  prospect_id: number;
  prospect_nombre: string;
  detalle: string | null;
  fuente: string;
}

export interface EtiguelLead {
  descripcion: string;
  nombre: string | null;
  estado: string;
  origen: string | null;
  fecha_creacion: string | null;
  telefono: string | null;
  email: string | null;
}

export interface ProspectRow {
  id: number;
  nombre: string;
  url: string | null;
  email: string | null;
  telefono: string | null;
  whatsapp: string | null;
  estado: string;
  termino_id: number | null;
  termino_texto: string | null;
  rubro_id: number | null;
  rubro_nombre: string | null;
  cant_contactos: number;
  cant_mensajes: number;
  ult_contacto: string | null;
  prox_contacto: string | null;
  clasificacion: string | null;
  clasificacion_detalle: string | null;
  clasificacion_verificada: boolean;
  envio_no_confirmado: boolean;   // chip "envío sin confirmar" (verificación WA)
  bloqueado: boolean;             // lista negra (solo superadmin lo setea desde la app)
  created_at: string;
}

export interface ProspectsPage {
  items: ProspectRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface OpcionFiltro {
  id: number;
  label: string;
}

export interface FiltrosCliente {
  estados: string[];
  terminos: OpcionFiltro[];
  rubros: OpcionFiltro[];
  meses: string[];
}

export interface MensajeRow {
  id: number;
  direccion: string; // "in" | "out"
  texto: string;
  fecha: string;
}

export interface HistorialRow {
  id: number;
  fecha: string;
  tipo: string;
  detalle: string | null;
}

export interface ClienteComparativa {
  tenant_id: number;
  nombre: string;
  fuente: string;
  total_prospects: number;
  contactados: number;
  en_conversacion: number;
  interesados: number;
  interesados_mes: number;
  tasa_respuesta: number;
  tasa_conversion: number;
}

export interface DashboardComparativa {
  total_clientes: number;
  total_prospects: number;
  en_conversacion: number;
  interesados: number;
  interesados_mes: number;
  clientes: ClienteComparativa[];
}

export interface ProspectsFiltro {
  estado?: string | null;
  termino_id?: number | null;
  rubro_id?: number | null;
  mes?: string | null;
  q?: string | null;
}

export interface EtiguelMirrorItem {
  id: number;
  tipo: string; // "lead" | "prospect"
  item_id: string;
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  estado: string | null;
  prox_contacto: string | null; // 'YYYY-MM-DD' próximo contacto (cadencia/callback)
  ultima_actividad: string;
  cant_mensajes: number;
  bloqueado: boolean; // en lista negra: Camila no lo escucha ni le responde
}

export interface BloquearResult {
  telefono: string;
  digits: string;
  bloqueado: boolean;
  webhook_ok: boolean;
  blacklist_total: number | null;
  webhook_error: string | null;
}

export type EstadoError = "nuevo" | "reportado" | "fixed";

export interface AgentError {
  id: number; // el #número
  fuente: string;
  agente: string | null;
  telefono: string | null;
  patron: string | null;
  contenido: string;
  estado: EstadoError; // nuevo → reportado (Sebi) → fixed (Claude)
  resuelto: boolean;
  fecha: string;
}

export type Prioridad = "alta" | "media" | "baja";
export type Area = "app" | "web" | "etiguel";
// Estado en la cola de procesamiento (tildar + Procesar). null = no encolado.
export type ColaEstado = "pendiente" | "procesado" | "standby" | null;

// Campos ricos (opcionales) — secciones del tracker. Texto multilínea.
export interface PendienteRich {
  contexto: string | null;
  que_armar: string | null;
  consideraciones: string | null;
  depende: string | null;
  alcance: string | null;
}

export interface Pendiente extends Partial<PendienteRich> {
  id: number;
  texto: string;
  prioridad: Prioridad;
  area: Area;
  hecho: boolean;
  fecha: string;
  cola_estado?: ColaEstado;
  cola_orden?: string | null;
  cola_resultado?: string | null;
}

// tenant_id sentinela de Etiguel (coincide con el backend)
export const ETIGUEL_TENANT_ID = -1;

// ── Cliente HTTP ─────────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Handler que se dispara cuando un request AUTENTICADO recibe 401 (token vencido
// o inválido). Lo registra AuthProvider para cerrar sesión y mandar al login,
// en vez de dejar a la app trabada reintentando con un token muerto.
let onAuthError: (() => void) | null = null;
export function setAuthErrorHandler(fn: (() => void) | null) {
  onAuthError = fn;
}

async function request<T>(path: string, opts: RequestInit = {}, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, `No se pudo conectar con el servidor (${API_URL}). Revisá la IP en app.json y que el backend esté corriendo.`);
  }

  if (!res.ok) {
    let detail = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      // sin body json
    }
    // Sesión vencida/inválida en un request autenticado → avisar para cerrar sesión.
    // (No aplica al login, que no manda token y maneja su propio 401.)
    if (res.status === 401 && token) onAuthError?.();
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function login(email: string, password: string): Promise<string> {
  const data = await request<{ access_token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return data.access_token;
}

export const getOverview = (token: string) => request<AdminOverview>("/admin/overview", {}, token);

export const getClientes = (token: string) => request<ClienteResumen[]>("/admin/clientes", {}, token);

export const getClienteStats = (token: string, tenantId: number) =>
  request<DashboardStats>(`/admin/clientes/${tenantId}/stats`, {}, token);

export const getEventos = (token: string) => request<Evento[]>("/admin/eventos", {}, token);

// ── Avisos: historial de push reales (#42) ────────────────────────────────────
export interface Aviso {
  id: number;
  tipo: string;
  title: string;
  body: string;
  detalle?: string | null; // conclusión completa (botón "Detalle")
  tenant_id: number | null;
  cliente: string | null;
  prospect_id: number | null;
  fecha: string;
}

export const getAvisos = (token: string) => request<Aviso[]>("/admin/avisos", {}, token);

export const eliminarAvisos = (token: string, ids: number[]) =>
  request<void>("/admin/avisos/eliminar", { method: "POST", body: JSON.stringify({ ids }) }, token);

// ── Consultas: preguntas que Camila escaló (no supo qué responder) ────────────
export interface Consulta {
  id: number;
  fuente: string;
  tenant_id: number | null;
  agente: string | null;
  telefono: string | null;
  pregunta: string;
  respuesta: string | null;
  estado: "pendiente" | "contestada";
  fecha: string;
  fecha_respuesta: string | null;
}

export const getConsultas = (token: string) => request<Consulta[]>("/admin/consultas", {}, token);

export const responderConsulta = (token: string, id: number, respuesta: string) =>
  request<Consulta>(`/admin/consultas/${id}/responder`, { method: "POST", body: JSON.stringify({ respuesta }) }, token);

export const eliminarConsultas = (token: string, ids: number[]) =>
  request<void>("/admin/consultas/eliminar", { method: "POST", body: JSON.stringify({ ids }) }, token);

// ── Preguntas de Claude Code (switch "Preguntas al cel") ──────────────────────
export interface OpcionPregunta {
  label: string;
  description: string | null;
}

export interface PreguntaItem {
  pregunta: string;
  opciones: OpcionPregunta[];
  header: string | null;
  multiselect: boolean;
}

export interface PreguntaClaude {
  id: number;
  preguntas: PreguntaItem[];       // tanda (1 a ~4 preguntas)
  respuestas: string[] | null;     // alineadas por índice; null si pendiente
  contexto: string | null;
  estado: "pendiente" | "respondida" | "cancelada";
  fecha: string;
  fecha_respuesta: string | null;
  // resumen / compat
  header: string | null;
  pregunta: string;
  elegida: string | null;
}

export const getPreguntasModo = (token: string) =>
  request<{ activo: boolean }>("/admin/preguntas-modo", {}, token);

export const setPreguntasModo = (token: string, activo: boolean) =>
  request<{ activo: boolean }>("/admin/preguntas-modo", { method: "PATCH", body: JSON.stringify({ activo }) }, token);

export const getPreguntasClaude = (token: string) =>
  request<PreguntaClaude[]>("/admin/preguntas-claude", {}, token);

export const getPreguntaClaude = (token: string, id: number) =>
  request<PreguntaClaude>(`/admin/preguntas-claude/${id}`, {}, token);

export const responderPreguntaClaude = (token: string, id: number, respuestas: string[]) =>
  request<PreguntaClaude>(`/admin/preguntas-claude/${id}/responder`, { method: "POST", body: JSON.stringify({ respuestas }) }, token);

// ── Inicializar prueba: borra todo rastro de un número de prueba del cliente ───
// Etiguel y los tenants usan endpoints distintos; el campo del webhook también
// difiere (webhook_ok vs webhook_estado) → la screen normaliza al leer.
export interface ResetNumeroPruebaResult {
  db_borrado: { prospects?: number; mensajes?: number; mirrors?: number };
  webhook_ok?: boolean;            // Etiguel
  webhook_estado?: string;         // tenants: ok | error | no_conectado
  webhook_error?: string | null;
}

export const resetNumeroPrueba = (token: string, tenantId: number, telefono: string) =>
  request<ResetNumeroPruebaResult>(
    tenantId === ETIGUEL_TENANT_ID
      ? "/admin/etiguel/reset-numero-prueba"
      : `/admin/clientes/${tenantId}/reset-numero-prueba`,
    { method: "POST", body: JSON.stringify({ telefono }) },
    token,
  );

// ── Monitoreo de servicios ───────────────────────────────────────────────────
export type EstadoServicio = "up" | "down" | "warn" | "unknown";

export interface ServicioSalud {
  slug: string;
  nombre: string;
  descripcion: string | null;
  grupo: string;
  estado: EstadoServicio;
  last_check: string | null;
  last_ok: string | null;
  since: string | null;
  latency_ms: number | null;
  detalle: string | null;
  critico: boolean;
}

export interface MonitoreoResumen {
  up: number;
  down: number;
  warn: number;
  unknown: number;
  total: number;
}

export interface MonitoreoStatus {
  servicios: ServicioSalud[];
  interval_seconds: number;
  last_run: string | null;
  resumen: MonitoreoResumen;
}

export const getMonitoreo = (token: string) =>
  request<MonitoreoStatus>("/admin/monitoring", {}, token);

export const rechequearTodo = (token: string) =>
  request<MonitoreoStatus>("/admin/monitoring/recheck-all", { method: "POST" }, token);

export const rechequearServicio = (token: string, slug: string) =>
  request<ServicioSalud>(`/admin/monitoring/${slug}/recheck`, { method: "POST" }, token);

export const setMonitoreoIntervalo = (token: string, intervalSeconds: number) =>
  request<MonitoreoStatus>(
    "/admin/monitoring/settings",
    { method: "PUT", body: JSON.stringify({ interval_seconds: intervalSeconds }) },
    token,
  );

// ── Tokens: auditor de consumo de Camila (por conversación) ──────────────────
export interface TokenSource { id: string; nombre: string }
export interface TokenTotales {
  input: number; output: number; cacheRead: number; cacheWrite: number; total: number;
  llamadas: number; costo_usd: number; costo_mensajes: number; costo_errores: number;
  errores: number; timeouts: number; compactaciones: number;
}
export interface TokenConvModelo { llamadas: number; costo_usd: number }
export interface TokenConv {
  telefono: string; nombre?: string | null; mirror_id?: number;
  tokens: number; costo_usd: number; llamadas: number;
  input?: number; output?: number; cacheRead?: number; cacheWrite?: number;
  timeouts: number; errores: number; compactaciones?: number;
  por_modelo?: Record<string, TokenConvModelo>;
  primer_ts?: string | null; ultimo_ts?: string | null;
  ejemplo: string | null; es_sistema: boolean;
}
export interface TokenOportunidad {
  id: number; tipo: string; clave: string; severidad: "alta" | "media" | "baja";
  titulo: string; detalle: string; estado: string; primera_vez: string | null;
}
export interface TokenAgg { tokens: number; costo_usd: number; llamadas: number }
export interface TokenUltimo {
  fecha: string; totales: TokenTotales; por_modelo: Record<string, TokenAgg>;
  top_conversaciones: TokenConv[]; conversaciones?: TokenConv[]; n_conversaciones: number;
}
export interface TokenDiaTrend { fecha: string; costo_usd: number; costo_mensajes: number; costo_errores: number }
export interface TokenMesTrend { mes: string; costo_usd: number; conversaciones: number; llamadas: number; costo_por_conversacion: number }
export interface TokenAudit {
  source: string; ultimo: TokenUltimo | null; tendencia: TokenDiaTrend[];
  serie_mensual: TokenMesTrend[]; por_modelo_mes: Record<string, TokenAgg>;
  mes_actual: string; oportunidades: TokenOportunidad[];
}

// Costos internos: API de Anthropic por función (NO Camila, que va por MyClaw). Solo plata.
export interface AnthFuncion { funcion: string; costo_usd: number }
export interface AnthMes { mes: string; nombre: string; total: number; por_funcion: Record<string, number> }
export interface AnthUsage {
  mes_actual: string; mes_nombre: string; dias_transcurridos: number;
  total_mes: number; prev_total: number; delta_pct: number | null;
  por_funcion: AnthFuncion[]; meses: AnthMes[];
}
export const getAnthropicUsage = (token: string, meses = 12) =>
  request<AnthUsage>(`/admin/tokens/anthropic?meses=${meses}`, {}, token);

export const getTokenSources = (token: string) =>
  request<TokenSource[]>("/admin/tokens/sources", {}, token);

export const getTokenAudit = (token: string, source: string, days = 14) =>
  request<TokenAudit>(`/admin/tokens/audit?source=${encodeURIComponent(source)}&days=${days}`, {}, token);

export const recomputeTokens = (token: string, source: string) =>
  request<TokenUltimo>(`/admin/tokens/recompute?source=${encodeURIComponent(source)}`, { method: "POST" }, token);

// Drill-down: detalle completo de un día (conversaciones con todo el detalle).
export interface TokenDia {
  source: string; fecha: string; vacio?: boolean;
  totales?: TokenTotales; por_modelo?: Record<string, TokenAgg>;
  conversaciones?: TokenConv[]; n_conversaciones?: number;
}
export const getTokenDia = (token: string, source: string, fecha: string) =>
  request<TokenDia>(`/admin/tokens/dia?source=${encodeURIComponent(source)}&fecha=${encodeURIComponent(fecha)}`, {}, token);

// Gasto por cliente (mes actual + serie mensual) para el dashboard.
export interface TokenClienteSerie { mes: string; costo_usd: number; conversaciones: number; llamadas: number; costo_por_conversacion: number }
export interface TokenClienteCosto {
  id: string; nombre: string; mes_actual: string;
  gasto_mes_actual: number; llamadas_mes: number; serie_mensual: TokenClienteSerie[];
}
export const getTokenClientes = (token: string) =>
  request<TokenClienteCosto[]>("/admin/tokens/clientes", {}, token);

// Vista General: comparativa entre clientes + totales agregados.
export interface TokenGenCliente {
  id: string; nombre: string; gasto_mes_actual: number; gasto_mes_anterior: number;
  llamadas_mes: number; conversaciones_mes: number; costo_por_conversacion: number;
  oportunidades_abiertas: number; serie_mensual: TokenMesTrend[];
}
export interface TokenGeneral {
  mes_actual: string; mes_anterior: string;
  clientes: TokenGenCliente[];
  totales: { gasto_mes_actual: number; gasto_mes_anterior: number; conversaciones_mes: number; oportunidades_abiertas: number; n_clientes: number };
}
export const getTokenGeneral = (token: string) =>
  request<TokenGeneral>("/admin/tokens/general", {}, token);

// Costo EN VIVO de una conversación (por teléfono) — pantalla de chat.
export interface TokenConvTurno { ts: string; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; costo: number }
export interface TokenConvCosto {
  ok: boolean; telefono: string | null;
  resumen: { turnos: number; input: number; output: number; cacheRead: number; cacheWrite: number; costo: number; modelos: Record<string, number>; primer_ts: string | null; ultimo_ts: string | null } | null;
  turnos: TokenConvTurno[];
}
export const getConversacionCosto = (token: string, telefono: string, source = "etiguel") =>
  request<TokenConvCosto>(`/admin/tokens/conversacion?source=${encodeURIComponent(source)}&telefono=${encodeURIComponent(telefono)}`, {}, token);

export const getEtiguelLeads = (token: string) =>
  request<EtiguelLead[]>("/admin/etiguel/leads", {}, token);

// Espejo de Etiguel (APP.7): leads/prospects que Camila contactó, más reciente arriba.
export const getEtiguelMirror = (token: string) =>
  request<EtiguelMirrorItem[]>("/admin/etiguel/mirror", {}, token);

export const getEtiguelMirrorMensajes = (token: string, mirrorId: number) =>
  request<MensajeRow[]>(`/admin/etiguel/mirror/${mirrorId}/mensajes`, {}, token);

// Lista negra: bloquear/desbloquear un lead/prospect de Etiguel. Camila deja de
// escucharlo y responderle, y no se lo vuelve a contactar.
export const bloquearEtiguelMirror = (token: string, mirrorId: number) =>
  request<BloquearResult>(`/admin/etiguel/mirror/${mirrorId}/bloquear`, { method: "POST" }, token);

export const desbloquearEtiguelMirror = (token: string, mirrorId: number) =>
  request<BloquearResult>(`/admin/etiguel/mirror/${mirrorId}/desbloquear`, { method: "POST" }, token);

export function getProspectsCliente(
  token: string,
  tenantId: number,
  filtro: ProspectsFiltro = {},
  page = 1,
  pageSize = 50,
): Promise<ProspectsPage> {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("page_size", String(pageSize));
  if (filtro.estado) params.set("estado", filtro.estado);
  if (filtro.termino_id != null) params.set("termino_id", String(filtro.termino_id));
  if (filtro.rubro_id != null) params.set("rubro_id", String(filtro.rubro_id));
  if (filtro.mes) params.set("mes", filtro.mes);
  if (filtro.q) params.set("q", filtro.q);
  return request<ProspectsPage>(`/admin/clientes/${tenantId}/prospects?${params}`, {}, token);
}

export const getFiltrosCliente = (token: string, tenantId: number) =>
  request<FiltrosCliente>(`/admin/clientes/${tenantId}/filtros`, {}, token);

// Lista negra de un prospect de cliente (solo superadmin / app). Bloquea/desbloquea:
// corta cadencia+contacto en Prospia y avisa al bot del tenant si está conectado.
export interface BloquearProspectResult {
  prospect_id: number;
  tenant_id: number;
  telefono: string | null;
  bloqueado: boolean;
  webhook_estado: string; // "ok" | "no_conectado" | "error"
  webhook_error: string | null;
}

export const bloquearProspectCliente = (token: string, tenantId: number, prospectId: number) =>
  request<BloquearProspectResult>(`/admin/clientes/${tenantId}/prospects/${prospectId}/bloquear`, { method: "POST" }, token);

export const desbloquearProspectCliente = (token: string, tenantId: number, prospectId: number) =>
  request<BloquearProspectResult>(`/admin/clientes/${tenantId}/prospects/${prospectId}/desbloquear`, { method: "POST" }, token);

// Reportar calidad: Sebi reporta que Camila estuvo mal en este lead. Entra a la
// lista de Calidad ya confirmado como 'acierto' y suma para las 5 lecciones.
export const reportarCalidadProspect = (token: string, tenantId: number, prospectId: number, texto: string) =>
  request<{ ok: boolean; revision: RevisionCalidad }>(
    `/admin/clientes/${tenantId}/prospects/${prospectId}/reportar-calidad`,
    { method: "POST", body: JSON.stringify({ texto }) }, token);

export const getProspect = (token: string, tenantId: number, prospectId: number) =>
  request<ProspectRow>(`/admin/clientes/${tenantId}/prospects/${prospectId}`, {}, token);

export const getMensajesProspect = (token: string, tenantId: number, prospectId: number) =>
  request<MensajeRow[]>(`/admin/clientes/${tenantId}/prospects/${prospectId}/mensajes`, {}, token);

export const getHistorialProspect = (token: string, tenantId: number, prospectId: number) =>
  request<HistorialRow[]>(`/admin/clientes/${tenantId}/prospects/${prospectId}/historial`, {}, token);

export const getComparativa = (token: string) =>
  request<DashboardComparativa>("/admin/comparativa", {}, token);

export const getErrores = (token: string) =>
  request<AgentError[]>("/admin/errores", {}, token);

export const setEstadoError = (token: string, id: number, estado: EstadoError) =>
  request<AgentError>(`/admin/errores/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ estado }),
  }, token);

export const deleteError = (token: string, id: number) =>
  request<void>(`/admin/errores/${id}`, { method: "DELETE" }, token);

// ── Calidad (especialista del negocio que revisa las conversaciones) ──────────
export type EstadoRevision = "nuevo" | "revisado";
export type VeredictoRevision = "acierto" | "falso_positivo" | null;
export interface RevisionCalidad {
  id: number; source: string; mirror_id: number | null;
  telefono: string | null; nombre: string | null; fecha: string;
  categoria: string; severidad: "alta" | "media" | "baja";
  titulo: string; detalle: string; fragmento: string; sugerencia: string;
  origen?: "especialista" | "sebi";
  estado: EstadoRevision; veredicto: VeredictoRevision; nota_sebi: string | null;
  created_at: string | null; revisado_at: string | null;
}

export interface CalidadSource { source: string; nombre: string; }
export const getCalidadSources = (token: string) =>
  request<CalidadSource[]>(`/admin/calidad/sources`, {}, token);

// ── Preferencias de UI por usuario/pantalla (default del selector, etc.) ───────
export const getPreferences = (token: string, pantalla: string) =>
  request<{ pantalla: string; prefs: Record<string, unknown> }>(
    `/me/preferences?pantalla=${encodeURIComponent(pantalla)}`, {}, token);

export const putPreferences = (token: string, pantalla: string, prefs: Record<string, unknown>) =>
  request<{ ok: boolean; prefs: Record<string, unknown> }>(
    `/me/preferences`, { method: "PUT", body: JSON.stringify({ pantalla, prefs }) }, token);

export const getRevisiones = (token: string, source = "etiguel") =>
  request<RevisionCalidad[]>(`/admin/calidad/revisiones?source=${encodeURIComponent(source)}`, {}, token);

export const confirmarRevision = (token: string, id: number, veredicto: "acierto" | "falso_positivo", nota?: string) =>
  request<RevisionCalidad>(`/admin/calidad/revisiones/${id}/confirmar`, {
    method: "POST",
    body: JSON.stringify({ veredicto, nota }),
  }, token);

export const deleteRevision = (token: string, id: number) =>
  request<void>(`/admin/calidad/revisiones/${id}`, { method: "DELETE" }, token);

// ── Aprendizajes de Camila (Capa B) ───────────────────────────────────────────
export interface ConsolidacionApr {
  id: number; estado: string; bloque_propuesto: string; bloque_anterior: string;
  n_lecciones: number; lecciones_ids: number[]; created_at: string | null; aplicada_at: string | null;
}
export interface AprendizajeEstado {
  pendientes: number; umbral: number;
  propuesta: ConsolidacionApr | null; ultima_aplicada: ConsolidacionApr | null;
  lecciones_pendientes: { id: number; titulo: string; categoria: string }[];
}

export const getAprendizajes = (token: string, source = "etiguel") =>
  request<AprendizajeEstado>(`/admin/calidad/aprendizajes?source=${encodeURIComponent(source)}`, {}, token);

export const consolidarAprendizajes = (token: string, source = "etiguel") =>
  request<unknown>(`/admin/calidad/aprendizajes/proponer?source=${encodeURIComponent(source)}`, { method: "POST" }, token);

export const aprobarAprendizaje = (token: string, id: number) =>
  request<unknown>(`/admin/calidad/aprendizajes/${id}/aprobar`, { method: "POST" }, token);

export const descartarAprendizaje = (token: string, id: number) =>
  request<unknown>(`/admin/calidad/aprendizajes/${id}/descartar`, { method: "POST" }, token);

// ── Pendientes ───────────────────────────────────────────────────────────────
export const getPendientes = (token: string, incluirHechos = false) =>
  request<Pendiente[]>(`/admin/pendientes?incluir_hechos=${incluirHechos}`, {}, token);

export const crearPendiente = (
  token: string,
  texto: string,
  prioridad: Prioridad,
  area: Area,
  extra?: Partial<PendienteRich>,
) =>
  request<Pendiente>("/admin/pendientes", {
    method: "POST",
    body: JSON.stringify({ texto, prioridad, area, ...(extra ?? {}) }),
  }, token);

export const editarPendiente = (
  token: string,
  id: number,
  // cola_estado: "" saca de la cola (el backend lo interpreta como nulo).
  cambios: Partial<{ texto: string; prioridad: Prioridad; area: Area; hecho: boolean; cola_estado: ColaEstado | "" } & PendienteRich>,
) =>
  request<Pendiente>(`/admin/pendientes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(cambios),
  }, token);

export const borrarPendiente = (token: string, id: number) =>
  request<void>(`/admin/pendientes/${id}`, { method: "DELETE" }, token);

// Tildar pendientes y mandarlos a la cola de procesamiento. Devuelve la cola.
export const encolarPendientes = (token: string, ids: number[]) =>
  request<Pendiente[]>("/admin/pendientes/cola", {
    method: "POST",
    body: JSON.stringify({ ids }),
  }, token);

export const getPushPref = (token: string, tenantId: number, expoToken: string) =>
  request<{ enabled: boolean }>(
    `/admin/clientes/${tenantId}/push?expo_token=${encodeURIComponent(expoToken)}`,
    {},
    token,
  );

export const setPushPref = (token: string, tenantId: number, expoToken: string, enabled: boolean) =>
  request<{ enabled: boolean }>(
    `/admin/clientes/${tenantId}/push`,
    { method: "PUT", body: JSON.stringify({ expo_token: expoToken, enabled }) },
    token,
  );

export const registerDevice = (token: string, expoToken: string, platform: string) =>
  request<void>(
    "/admin/devices",
    { method: "POST", body: JSON.stringify({ expo_token: expoToken, platform }) },
    token,
  );

// ── Notificaciones por evento, por dispositivo (#38) ──────────────────────────
export interface NotifEvento {
  evento: string;
  label: string;
  descripcion?: string; // texto breve que abre el ícono "i" al lado del toggle
  enabled: boolean;
}
export interface NotifPrefs {
  expo_token: string;
  platform: string | null;
  eventos: NotifEvento[];
}

export const getNotifPrefs = (token: string, expoToken: string) =>
  request<NotifPrefs>(`/admin/notif-prefs?expo_token=${encodeURIComponent(expoToken)}`, {}, token);

export const setNotifPref = (token: string, expoToken: string, evento: string, enabled: boolean) =>
  request<NotifPrefs>(
    "/admin/notif-prefs",
    { method: "PUT", body: JSON.stringify({ expo_token: expoToken, evento, enabled }) },
    token,
  );

// ── Notificaciones por cliente y por evento (#44) ─────────────────────────────
export interface ClienteNotifPrefs {
  tenant_id: number;
  eventos: NotifEvento[];
}

export const getClienteNotifPrefs = (token: string, tenantId: number, expoToken: string) =>
  request<ClienteNotifPrefs>(`/admin/clientes/${tenantId}/notif-prefs?expo_token=${encodeURIComponent(expoToken)}`, {}, token);

export const setClienteNotifPref = (token: string, tenantId: number, expoToken: string, evento: string, enabled: boolean) =>
  request<ClienteNotifPrefs>(
    `/admin/clientes/${tenantId}/notif-prefs`,
    { method: "PUT", body: JSON.stringify({ expo_token: expoToken, evento, enabled }) },
    token,
  );

// ── Perfil / cuenta ───────────────────────────────────────────────────────────
export interface Me {
  id: number;
  tenant_id: number;
  email: string;
  nombre: string | null;
  role: string;
  nivel: number;
}

export const getMe = (token: string) => request<Me>("/auth/me", {}, token);

export const updateProfile = (token: string, nombre: string | null, email: string) =>
  request<Me>("/auth/me", { method: "PATCH", body: JSON.stringify({ nombre, email }) }, token);

export const changePassword = (token: string, current_password: string, new_password: string) =>
  request<void>(
    "/auth/change-password",
    { method: "POST", body: JSON.stringify({ current_password, new_password }) },
    token,
  );
