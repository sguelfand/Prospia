import { RefreshCw, Lightbulb, Phone } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'

type Totales = {
  total: number; llamadas: number; costo_usd: number
  costo_mensajes: number; costo_errores: number; errores: number; timeouts: number
  cacheRead: number; cacheWrite: number
}
type Conv = { telefono: string; tokens: number; costo_usd: number; llamadas: number; timeouts: number; errores: number; ejemplo: string | null; es_sistema: boolean }
type Ultimo = { fecha: string; totales: Totales; por_modelo: Record<string, { tokens: number; costo_usd: number; llamadas: number }>; top_conversaciones: Conv[]; n_conversaciones: number }
type DiaTrend = { fecha: string; costo_usd: number; costo_mensajes: number; costo_errores: number }
type MesTrend = { mes: string; costo_usd: number; conversaciones: number; llamadas: number; costo_por_conversacion: number }
type Oportunidad = { id: number; tipo: string; clave: string; severidad: 'alta' | 'media' | 'baja'; titulo: string; detalle: string; estado: string; primera_vez: string | null }
type Source = { id: string; nombre: string }
type Audit = {
  source: string; ultimo: Ultimo | null; tendencia: DiaTrend[]
  serie_mensual: MesTrend[]; por_modelo_mes: Record<string, { tokens: number; costo_usd: number; llamadas: number }>
  mes_actual: string; oportunidades: Oportunidad[]
}

const SEV: Record<string, { color: string; label: string }> = {
  alta: { color: '#ef4444', label: 'Alta' }, media: { color: '#f5b23d', label: 'Media' }, baja: { color: '#64748b', label: 'Baja' },
}
const usd = (n: number) => '$' + (n ?? 0).toFixed(2)
const usd3 = (n: number) => '$' + (n ?? 0).toFixed(3)
const fmt = (n: number) => (n ?? 0).toLocaleString('es-AR')
function haceDias(iso: string | null): string {
  if (!iso) return ''
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return d <= 0 ? 'hoy' : d === 1 ? 'hace 1 día' : `hace ${d} días`
}

export default function Tokens() {
  const [sources, setSources] = useState<Source[]>([])
  const [source, setSource] = useState('etiguel')
  const [data, setData] = useState<Audit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recomputando, setRecomputando] = useState(false)
  const [hoverMes, setHoverMes] = useState<number | null>(null)

  useEffect(() => { api.get<Source[]>('/admin/tokens/sources').then(setSources).catch(() => {}) }, [])
  const cargar = useCallback(async () => {
    try { setData(await api.get<Audit>(`/admin/tokens/audit?source=${source}&days=14`)); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'Error al cargar') }
  }, [source])
  useEffect(() => { cargar() }, [cargar])

  async function recomputar() {
    setRecomputando(true)
    try { await api.post(`/admin/tokens/recompute?source=${source}`); await cargar() }
    catch (e) { setError(e instanceof Error ? e.message : 'Error') } finally { setRecomputando(false) }
  }

  const u = data?.ultimo
  const t = u?.totales
  const dias = data?.tendencia ?? []
  const meses = data?.serie_mensual ?? []
  const maxDia = Math.max(0.001, ...dias.map((d) => d.costo_usd))
  const convs = (u?.top_conversaciones ?? []).filter((c) => !c.es_sistema)
  const sistema = (u?.top_conversaciones ?? []).find((c) => c.es_sistema)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">Monitoreo · Tokens</h1>
        <div className="flex items-center gap-2">
          <select value={source} onChange={(e) => setSource(e.target.value)}
            className="bg-card border border-line text-ink rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
            {sources.length === 0 && <option value="etiguel">Etiguel (Camila)</option>}
            {sources.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <button onClick={recomputar} disabled={recomputando}
            className="flex items-center gap-1.5 bg-primary text-on-primary rounded-lg px-3 py-2 text-sm font-medium hover:bg-primary-dark disabled:opacity-50">
            <RefreshCw size={14} className={recomputando ? 'animate-spin' : ''} />{recomputando ? 'Recalculando…' : 'Recalcular hoy'}
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <p className="text-xs text-muted -mt-2">Costo estimado (tokens reales × precios de referencia de Anthropic; myclaw no expone su precio real).</p>

      {/* Oportunidades FIJAS */}
      <div className="bg-card border border-line rounded-2xl p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Lightbulb size={16} className="text-primary" />
          <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Oportunidades de mejora</h2>
          <span className="text-xs text-muted">(quedan fijas hasta resolverlas)</span>
        </div>
        {(data?.oportunidades ?? []).length === 0 ? (
          <p className="text-sm text-emerald-500">Sin oportunidades abiertas. 👌</p>
        ) : (
          data!.oportunidades.map((o) => {
            const sev = SEV[o.severidad] ?? SEV.baja
            return (
              <div key={o.id} className="border border-line rounded-xl p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded border" style={{ color: sev.color, borderColor: sev.color + '66', backgroundColor: sev.color + '18' }}>{sev.label}</span>
                  <span className="text-sm font-medium text-ink">{o.titulo}</span>
                  <span className="text-[11px] text-muted ml-auto">detectada {haceDias(o.primera_vez)}</span>
                </div>
                <p className="text-xs text-muted mt-1.5">{o.detalle}</p>
              </div>
            )
          })
        )}
      </div>

      {!u || !t ? (
        <div className="bg-card border border-line rounded-2xl p-6 text-sm text-muted">Sin datos del día todavía. Tocá “Recalcular hoy”.</div>
      ) : (
        <>
          {/* KPIs del día */}
          <p className="text-xs text-muted -mb-2">Día {u.fecha}</p>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { l: 'Costo estimado', v: usd(t.costo_usd), alert: false },
              { l: 'Conversaciones', v: fmt(u.n_conversaciones), alert: false },
              { l: 'Llamadas', v: fmt(t.llamadas), alert: false },
              { l: 'Errores', v: fmt(t.errores), alert: t.errores > 0 },
              { l: 'Timeouts', v: fmt(t.timeouts), alert: t.timeouts > 0 },
            ].map((k) => (
              <div key={k.l} className="bg-card border border-line rounded-2xl p-4">
                <div className={`text-2xl font-semibold ${k.alert ? 'text-red-500' : 'text-ink'}`}>{k.v}</div>
                <div className="text-xs text-muted mt-1">{k.l}</div>
              </div>
            ))}
          </div>

          {/* Barras por día apiladas: mensajes vs errores */}
          <div className="bg-card border border-line rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Costo por día (estimado)</h2>
              <div className="flex items-center gap-3 text-xs text-muted">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#2F4068' }} />mensajes</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#ef4444' }} />errores</span>
              </div>
            </div>
            <div className="flex items-end gap-2 h-44">
              {dias.map((d) => (
                <div key={d.fecha} className="flex-1 flex flex-col items-center justify-end gap-1"
                  title={`${d.fecha}: ${usd3(d.costo_usd)} (mensajes ${usd3(d.costo_mensajes)} · errores ${usd3(d.costo_errores)})`}>
                  <span className="text-[10px] text-muted">{usd(d.costo_usd)}</span>
                  <div className="w-full flex flex-col justify-end" style={{ height: `${(d.costo_usd / maxDia) * 100}%`, minHeight: 2 }}>
                    {d.costo_errores > 0 && <div style={{ height: `${(d.costo_errores / Math.max(d.costo_usd, 0.0001)) * 100}%`, background: '#ef4444' }} className="rounded-t" />}
                    <div className="flex-1" style={{ background: '#2F4068', borderTopLeftRadius: d.costo_errores > 0 ? 0 : 4, borderTopRightRadius: d.costo_errores > 0 ? 0 : 4 }} />
                  </div>
                  <span className="text-[10px] text-muted">{d.fecha.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Histórico mensual: línea de costo, con tooltip al pasar el mouse */}
          <div className="bg-card border border-line rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-ink uppercase tracking-wide mb-1">Histórico mensual</h2>
            <p className="text-xs text-muted mb-4">Pasá el mouse por un mes para ver el detalle.</p>
            {meses.length === 0 ? <p className="text-sm text-muted">Sin histórico todavía.</p> : <LineaMensual meses={meses} hover={hoverMes} setHover={setHoverMes} />}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Conversaciones más caras (por teléfono) */}
            <div className="bg-card border border-line rounded-2xl p-6">
              <h2 className="text-sm font-semibold text-ink uppercase tracking-wide mb-3">Conversaciones más caras (día)</h2>
              {convs.length === 0 ? <p className="text-sm text-muted">Sin conversaciones.</p> : (
                <div className="space-y-2">
                  {convs.slice(0, 10).map((c) => (
                    <div key={c.telefono} className="border border-line rounded-xl p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink flex items-center gap-1.5"><Phone size={13} className="text-muted" />{c.telefono}</span>
                        <span className="text-sm font-semibold text-ink">{usd3(c.costo_usd)}</span>
                      </div>
                      <div className="text-xs text-muted mt-0.5">{c.llamadas} llamadas · {fmt(c.tokens)} tok{c.timeouts > 0 && <span className="text-red-400"> · {c.timeouts} timeout</span>}{c.errores > 0 && <span className="text-red-400"> · {c.errores} error</span>}</div>
                      {c.ejemplo && <p className="text-xs text-muted mt-1 truncate">“{c.ejemplo}”</p>}
                    </div>
                  ))}
                  {sistema && <p className="text-xs text-muted pt-1">+ sistema (crons/mantenimiento): {usd3(sistema.costo_usd)}</p>}
                </div>
              )}
            </div>

            {/* Por modelo — mes actual */}
            <div className="bg-card border border-line rounded-2xl p-6">
              <h2 className="text-sm font-semibold text-ink uppercase tracking-wide mb-3">Por modelo · mes {data!.mes_actual}</h2>
              {Object.keys(data!.por_modelo_mes).length === 0 ? <p className="text-sm text-muted">Sin datos del mes.</p> : (
                <div className="space-y-1.5">
                  {Object.entries(data!.por_modelo_mes).sort((a, b) => b[1].costo_usd - a[1].costo_usd).map(([m, v]) => (
                    <div key={m} className="flex items-center justify-between text-sm">
                      <span className="text-ink-soft">{m}</span>
                      <span className="text-muted">{usd(v.costo_usd)} · {fmt(v.tokens)} tok · {v.llamadas} ll</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function LineaMensual({ meses, hover, setHover }: { meses: MesTrend[]; hover: number | null; setHover: (i: number | null) => void }) {
  const W = 640, H = 180, pad = 30
  const maxC = Math.max(0.001, ...meses.map((m) => m.costo_usd))
  const x = (i: number) => meses.length <= 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (meses.length - 1)
  const y = (c: number) => H - pad - (c / maxC) * (H - 2 * pad)
  const pts = meses.map((m, i) => `${x(i)},${y(m.costo_usd)}`).join(' ')
  const h = hover != null ? meses[hover] : null
  return (
    <div className="relative">
      {h && (
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 bg-app border border-line rounded-lg px-3 py-2 text-xs z-10 shadow">
          <div className="font-semibold text-ink mb-0.5">{h.mes}</div>
          <div className="text-muted">Total: <span className="text-ink font-medium">{usd(h.costo_usd)}</span></div>
          <div className="text-muted">Conversaciones: <span className="text-ink font-medium">{fmt(h.conversaciones)}</span></div>
          <div className="text-muted">Prom. $/conversación: <span className="text-ink font-medium">{usd3(h.costo_por_conversacion)}</span></div>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 200 }}>
        <polyline points={pts} fill="none" stroke="#F5B23D" strokeWidth={2} />
        {meses.map((m, i) => (
          <g key={m.mes} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
            <circle cx={x(i)} cy={y(m.costo_usd)} r={hover === i ? 6 : 4} fill="#F5B23D" />
            <rect x={x(i) - 16} y={0} width={32} height={H} fill="transparent" />
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="#64748B">{m.mes.slice(2)}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}
