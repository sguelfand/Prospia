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
  ultima_actividad: string;
  cant_mensajes: number;
}

export interface AgentError {
  id: number; // el #número
  fuente: string;
  agente: string | null;
  telefono: string | null;
  patron: string | null;
  contenido: string;
  resuelto: boolean;
  fecha: string;
}

export type Prioridad = "alta" | "media" | "baja";
export type Area = "app" | "web" | "etiguel";

export interface Pendiente {
  id: number;
  texto: string;
  prioridad: Prioridad;
  area: Area;
  hecho: boolean;
  fecha: string;
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

export const resolverError = (token: string, id: number, resuelto: boolean) =>
  request<AgentError>(`/admin/errores/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ resuelto }),
  }, token);

export const deleteError = (token: string, id: number) =>
  request<void>(`/admin/errores/${id}`, { method: "DELETE" }, token);

// ── Pendientes ───────────────────────────────────────────────────────────────
export const getPendientes = (token: string, incluirHechos = false) =>
  request<Pendiente[]>(`/admin/pendientes?incluir_hechos=${incluirHechos}`, {}, token);

export const crearPendiente = (token: string, texto: string, prioridad: Prioridad, area: Area) =>
  request<Pendiente>("/admin/pendientes", {
    method: "POST",
    body: JSON.stringify({ texto, prioridad, area }),
  }, token);

export const editarPendiente = (
  token: string,
  id: number,
  cambios: Partial<{ texto: string; prioridad: Prioridad; area: Area; hecho: boolean }>,
) =>
  request<Pendiente>(`/admin/pendientes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(cambios),
  }, token);

export const borrarPendiente = (token: string, id: number) =>
  request<void>(`/admin/pendientes/${id}`, { method: "DELETE" }, token);

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
