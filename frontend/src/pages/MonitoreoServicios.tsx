import { HelpCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

type Estado = 'up' | 'down' | 'warn' | 'unknown'

type Servicio = {
  slug: string
  nombre: string
  descripcion: string | null
  tooltip: string | null
  grupo: string
  estado: Estado
  last_check: string | null
  last_ok: string | null
  since: string | null
  latency_ms: number | null
  detalle: string | null
  critico: boolean
}

type Resumen = { up: number; down: number; warn: number; unknown: number; total: number }
type Status = {
  servicios: Servicio[]
  interval_seconds: number
  guard_semantico?: boolean
  last_run: string | null
  resumen: Resumen
}

const ESTADO_INFO: Record<Estado, { label: string; color: string }> = {
  up: { label: 'Activo', color: '#22c55e' },
  down: { label: 'Caído', color: '#ef4444' },
  warn: { label: 'Lento', color: '#f5b23d' },
  unknown: { label: 'Sin datos', color: '#64748b' },
}

const FREQ_OPCIONES = [
  { v: 60, label: '1 min' },
  { v: 120, label: '2 min' },
  { v: 180, label: '3 min' },
  { v: 300, label: '5 min' },
  { v: 600, label: '10 min' },
  { v: 900, label: '15 min' },
  { v: 1800, label: '30 min' },
]

function hace(iso: string | null): string {
  if (!iso) return 'nunca'
  const t = new Date(iso).getTime()
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return `hace ${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

export default function MonitoreoServicios() {
  const [data, setData] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rechequeando, setRechequeando] = useState<string | null>(null) // slug o '__all__'
  const timer = useRef<number | null>(null)

  const cargar = useCallback(async () => {
    try {
      const s = await api.get<Status>('/admin/monitoring')
      setData(s)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar el monitoreo')
    }
  }, [])

  useEffect(() => {
    cargar()
    timer.current = window.setInterval(cargar, 30000) // refresco suave cada 30s
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [cargar])

  async function rechequearTodo() {
    setRechequeando('__all__')
    try {
      setData(await api.post<Status>('/admin/monitoring/recheck-all'))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al re-chequear')
    } finally {
      setRechequeando(null)
    }
  }

  async function rechequearUno(slug: string) {
    setRechequeando(slug)
    try {
      const actualizado = await api.post<Servicio>(`/admin/monitoring/${slug}/recheck`)
      setData((prev) =>
        prev ? { ...prev, servicios: prev.servicios.map((s) => (s.slug === slug ? actualizado : s)) } : prev,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al re-chequear el servicio')
    } finally {
      setRechequeando(null)
    }
  }

  async function cambiarFrecuencia(seconds: number) {
    try {
      setData(await api.put<Status>('/admin/monitoring/settings', { interval_seconds: seconds }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cambiar la frecuencia')
    }
  }

  async function toggleGuard(on: boolean) {
    try {
      setData(await api.put<Status>('/admin/monitoring/guard-semantico', { on }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cambiar la guardia semántica')
    }
  }

  const servicios = data?.servicios ?? []
  const grupos = Array.from(new Set(servicios.map((s) => s.grupo)))
  const r = data?.resumen
  const hayCaidos = (r?.down ?? 0) > 0

  return (
    <div className="bg-card border border-line rounded-2xl p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Monitoreo de servicios</h2>
          <p className="text-xs text-muted mt-1">
            {r ? (
              hayCaidos ? (
                <span className="text-red-500 font-medium">{r.down} caído{r.down > 1 ? 's' : ''} de {r.total}</span>
              ) : (
                <span className="text-emerald-500 font-medium">Todo OK · {r.up}/{r.total} activos</span>
              )
            ) : (
              'Estado de la infraestructura.'
            )}
            {data?.last_run && <> · último chequeo {hace(data.last_run)}</>}
          </p>
        </div>
        <button
          onClick={rechequearTodo}
          disabled={rechequeando === '__all__'}
          className="flex items-center gap-1.5 bg-primary text-on-primary rounded-lg px-3 py-2 text-sm font-medium hover:bg-primary-dark disabled:opacity-50"
        >
          <RefreshCw size={14} className={rechequeando === '__all__' ? 'animate-spin' : ''} />
          {rechequeando === '__all__' ? 'Chequeando…' : 'Re-chequear todo'}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Frecuencia del chequeo automático */}
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>Chequeo automático cada</span>
        <select
          value={data?.interval_seconds ?? 300}
          onChange={(e) => cambiarFrecuencia(Number(e.target.value))}
          className="bg-app border border-line text-ink rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {FREQ_OPCIONES.map((o) => (
            <option key={o.v} value={o.v}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Guardia semántica de Camila (chequeo Haiku de cada saliente a clientes) */}
      <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
        <input
          type="checkbox"
          checked={data?.guard_semantico ?? true}
          onChange={(e) => toggleGuard(e.target.checked)}
          className="accent-primary w-3.5 h-3.5"
        />
        <span>
          <span className="text-ink font-semibold">Guardia semántica de Camila</span> — frena por IA (Haiku)
          cualquier fuga de razonamiento interno a clientes. Su costo aparece en Tokens → Costos internos.
        </span>
      </label>

      {grupos.map((grupo) => (
        <div key={grupo} className="border border-line rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-app text-xs font-semibold text-muted uppercase tracking-wide">{grupo}</div>
          <div>
            {servicios
              .filter((s) => s.grupo === grupo)
              .map((s) => {
                const info = ESTADO_INFO[s.estado]
                return (
                  <div
                    key={s.slug}
                    className="flex items-center gap-3 px-4 py-3 border-t border-line first:border-t-0"
                    title={s.tooltip ?? undefined}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: info.color }}
                      title={info.label}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink truncate">{s.nombre}</span>
                        {s.descripcion && <span className="text-xs text-muted truncate">{s.descripcion}</span>}
                        {s.tooltip && (
                          <span title={s.tooltip} className="shrink-0 cursor-help leading-none">
                            <HelpCircle size={13} className="text-muted hover:text-primary" />
                          </span>
                        )}
                        <span
                          className="text-[11px] font-medium px-1.5 py-0.5 rounded border"
                          style={{ color: info.color, borderColor: info.color + '55', backgroundColor: info.color + '18' }}
                        >
                          {info.label}
                        </span>
                        {!s.critico && <span className="text-[10px] text-muted">(no crítico)</span>}
                      </div>
                      <div className="text-xs text-muted mt-0.5 truncate">
                        {hace(s.last_check)}
                        {s.latency_ms != null && <> · {s.latency_ms}ms</>}
                        {s.estado === 'down' && s.since && <> · caído {hace(s.since)}</>}
                        {s.detalle && <span className="text-red-400"> · {s.detalle}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => rechequearUno(s.slug)}
                      disabled={rechequeando === s.slug}
                      title="Re-chequear este servicio"
                      className="flex items-center gap-1 text-xs font-semibold border border-line text-muted rounded-lg px-2 py-1.5 hover:border-primary hover:text-primary disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={rechequeando === s.slug ? 'animate-spin' : ''} />
                    </button>
                  </div>
                )
              })}
          </div>
        </div>
      ))}
    </div>
  )
}
