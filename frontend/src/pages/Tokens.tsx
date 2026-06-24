import { RefreshCw, Lightbulb } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'

type Source = { id: string; nombre: string }
type Totales = {
  input: number; output: number; cacheRead: number; cacheWrite: number; total: number
  llamadas: number; costo_usd: number; errores: number; timeouts: number; compactaciones: number
}
type Conv = { sesion: string; agente: string; tokens: number; costo_usd: number; llamadas: number; timeouts: number; errores: number; ejemplo: string | null }
type Oportunidad = { tipo: string; severidad: 'alta' | 'media' | 'baja'; titulo: string; detalle: string; sesion?: string }
type Ultimo = {
  fecha: string; totales: Totales
  por_agente: Record<string, { tokens: number; costo_usd: number; llamadas: number }>
  por_modelo: Record<string, { tokens: number; costo_usd: number; llamadas: number }>
  top_conversaciones: Conv[]; oportunidades: Oportunidad[]
}
type Trend = { fecha: string; costo_usd: number; total_tokens: number; errores: number; oportunidades: number }
type AuditResp = { source: string; ultimo: Ultimo | null; tendencia: Trend[] }

const SEV: Record<string, { color: string; label: string }> = {
  alta: { color: '#ef4444', label: 'Alta' },
  media: { color: '#f5b23d', label: 'Media' },
  baja: { color: '#64748b', label: 'Baja' },
}

const usd = (n: number) => '$' + (n ?? 0).toFixed(2)
const fmt = (n: number) => (n ?? 0).toLocaleString('es-AR')

export default function Tokens() {
  const [sources, setSources] = useState<Source[]>([])
  const [source, setSource] = useState('etiguel')
  const [data, setData] = useState<AuditResp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recomputando, setRecomputando] = useState(false)

  useEffect(() => {
    api.get<Source[]>('/admin/tokens/sources').then(setSources).catch(() => {})
  }, [])

  const cargar = useCallback(async () => {
    try {
      setData(await api.get<AuditResp>(`/admin/tokens/audit?source=${source}&days=14`))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
    }
  }, [source])

  useEffect(() => { cargar() }, [cargar])

  async function recomputar() {
    setRecomputando(true)
    try {
      await api.post(`/admin/tokens/recompute?source=${source}`)
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al recalcular')
    } finally {
      setRecomputando(false)
    }
  }

  const u = data?.ultimo
  const t = u?.totales
  const trend = data?.tendencia ?? []
  const maxCosto = Math.max(0.01, ...trend.map((d) => d.costo_usd))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">Monitoreo · Tokens</h1>
        <div className="flex items-center gap-2">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="bg-card border border-line text-ink rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {sources.length === 0 && <option value="etiguel">Etiguel (Camila)</option>}
            {sources.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <button
            onClick={recomputar}
            disabled={recomputando}
            className="flex items-center gap-1.5 bg-primary text-on-primary rounded-lg px-3 py-2 text-sm font-medium hover:bg-primary-dark disabled:opacity-50"
          >
            <RefreshCw size={14} className={recomputando ? 'animate-spin' : ''} />
            {recomputando ? 'Recalculando…' : 'Recalcular hoy'}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {!u ? (
        <div className="bg-card border border-line rounded-2xl p-6 text-sm text-muted">
          Todavía no hay datos de consumo. El auditor corre solo cada día; podés forzar uno con
          “Recalcular hoy”.
        </div>
      ) : (
        <>
          <p className="text-xs text-muted -mt-2">Día {u.fecha} · costo estimado (precios de referencia)</p>

          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label: 'Costo estimado', value: usd(t!.costo_usd), accent: 'text-ink' },
              { label: 'Tokens', value: fmt(t!.total), accent: 'text-ink' },
              { label: 'Llamadas', value: fmt(t!.llamadas), accent: 'text-ink' },
              { label: 'Errores', value: fmt(t!.errores), accent: t!.errores > 0 ? 'text-red-500' : 'text-ink' },
              { label: 'Timeouts', value: fmt(t!.timeouts), accent: t!.timeouts > 0 ? 'text-red-500' : 'text-ink' },
            ].map((k) => (
              <div key={k.label} className="bg-card border border-line rounded-2xl p-4">
                <div className={`text-2xl font-semibold ${k.accent}`}>{k.value}</div>
                <div className="text-xs text-muted mt-1">{k.label}</div>
              </div>
            ))}
          </div>

          {/* Oportunidades de mejora */}
          <div className="bg-card border border-line rounded-2xl p-6 space-y-3">
            <div className="flex items-center gap-2">
              <Lightbulb size={16} className="text-primary" />
              <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Oportunidades de mejora</h2>
            </div>
            {u.oportunidades.length === 0 ? (
              <p className="text-sm text-emerald-500">Sin oportunidades detectadas en este día. 👌</p>
            ) : (
              u.oportunidades.map((o, i) => {
                const sev = SEV[o.severidad] ?? SEV.baja
                return (
                  <div key={i} className="border border-line rounded-xl p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded border"
                        style={{ color: sev.color, borderColor: sev.color + '66', backgroundColor: sev.color + '18' }}>
                        {sev.label}
                      </span>
                      <span className="text-sm font-medium text-ink">{o.titulo}</span>
                    </div>
                    <p className="text-xs text-muted mt-1.5">{o.detalle}</p>
                  </div>
                )
              })
            )}
          </div>

          {/* Tendencia de costo */}
          <div className="bg-card border border-line rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-ink uppercase tracking-wide mb-4">Costo por día (estimado)</h2>
            {trend.length === 0 ? (
              <p className="text-sm text-muted">Sin histórico todavía.</p>
            ) : (
              <div className="flex items-end gap-2 h-40">
                {trend.map((d) => (
                  <div key={d.fecha} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${d.fecha}: ${usd(d.costo_usd)}`}>
                    <span className="text-[10px] text-muted">{usd(d.costo_usd)}</span>
                    <div className="w-full rounded-t" style={{ height: `${(d.costo_usd / maxCosto) * 100}%`, minHeight: 2, backgroundColor: d.oportunidades > 0 ? '#f5b23d' : '#2F4068' }} />
                    <span className="text-[10px] text-muted">{d.fecha.slice(5)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Top conversaciones */}
            <div className="bg-card border border-line rounded-2xl p-6">
              <h2 className="text-sm font-semibold text-ink uppercase tracking-wide mb-3">Conversaciones más caras</h2>
              {u.top_conversaciones.length === 0 ? (
                <p className="text-sm text-muted">Sin datos.</p>
              ) : (
                <div className="space-y-2">
                  {u.top_conversaciones.slice(0, 8).map((c) => (
                    <div key={c.sesion} className="border border-line rounded-xl p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink">{usd(c.costo_usd)}</span>
                        <span className="text-xs text-muted">{c.agente} · {c.llamadas} llamadas · {fmt(c.tokens)} tok
                          {c.timeouts > 0 && <span className="text-red-400"> · {c.timeouts} timeout</span>}
                        </span>
                      </div>
                      {c.ejemplo && <p className="text-xs text-muted mt-1 truncate">“{c.ejemplo}”</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Por modelo + agente */}
            <div className="bg-card border border-line rounded-2xl p-6 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-ink uppercase tracking-wide mb-3">Por modelo</h2>
                <div className="space-y-1.5">
                  {Object.entries(u.por_modelo).map(([m, v]) => (
                    <div key={m} className="flex items-center justify-between text-sm">
                      <span className="text-ink-soft">{m}</span>
                      <span className="text-muted">{usd(v.costo_usd)} · {fmt(v.tokens)} tok</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-ink uppercase tracking-wide mb-3">Por agente</h2>
                <div className="space-y-1.5">
                  {Object.entries(u.por_agente).map(([a, v]) => (
                    <div key={a} className="flex items-center justify-between text-sm">
                      <span className="text-ink-soft">{a === 'main' ? 'main (sistema)' : a}</span>
                      <span className="text-muted">{usd(v.costo_usd)} · {v.llamadas} llamadas</span>
                    </div>
                  ))}
                </div>
              </div>
              {(t!.cacheRead + t!.cacheWrite) > 0 && (
                <p className="text-xs text-muted">
                  Caché: lee {fmt(t!.cacheRead)} / escribe {fmt(t!.cacheWrite)} tokens
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
