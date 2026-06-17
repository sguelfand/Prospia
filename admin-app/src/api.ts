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

export const registerDevice = (token: string, expoToken: string, platform: string) =>
  request<void>(
    "/admin/devices",
    { method: "POST", body: JSON.stringify({ expo_token: expoToken, platform }) },
    token,
  );
