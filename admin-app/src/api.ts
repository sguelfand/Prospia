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
  tenant_id: number | null;
  cliente: string | null;
  prospect_id: number | null;
  fecha: string;
}

export const getAvisos = (token: string) => request<Aviso[]>("/admin/avisos", {}, token);

export const eliminarAvisos = (token: string, ids: number[]) =>
  request<void>("/admin/avisos/eliminar", { method: "POST", body: JSON.stringify({ ids }) }, token);

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

export const getEtiguelLeads = (token: string) =>
  request<EtiguelLead[]>("/admin/etiguel/leads", {}, token);

// Espejo de Etiguel (APP.7): leads/prospects que Camila contactó, más reciente arriba.
export const getEtiguelMirror = (token: string) =>
  request<EtiguelMirrorItem[]>("/admin/etiguel/mirror", {}, token);

export const getEtiguelMirrorMensajes = (token: string, mirrorId: number) =>
  request<MensajeRow[]>(`/admin/etiguel/mirror/${mirrorId}/mensajes`, {}, token);

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
