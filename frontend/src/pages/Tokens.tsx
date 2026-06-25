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

          {/* Costo por día + Histórico mensual, misma fila */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
            <div className="bg-card border border-line rounded-2xl p-5 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Costo por día</h2>
                <div className="flex items-center gap-3 text-[11px] text-muted">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#2F4068' }} />mensajes</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#ef4444' }} />errores</span>
                </div>
              </div>
              {dias.length === 0 ? <p className="text-sm text-muted">Sin datos.</p> : <BarrasDia dias={dias} />}
            </div>
            <div className="bg-card border border-line rounded-2xl p-5 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Histórico mensual</h2>
                <span className="text-[11px] text-muted">pasá el mouse por un mes</span>
              </div>
              {meses.length === 0 ? <p className="text-sm text-muted">Sin histórico todavía.</p> : <LineaMensual meses={meses} hover={hoverMes} setHover={setHoverMes} />}
            </div>
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

function niceMax(v: number): number {
  if (v <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * pow
}

function BarrasDia({ dias }: { dias: DiaTrend[] }) {
  const [hi, setHi] = useState<number | null>(null)
  const max = niceMax(Math.max(0.001, ...dias.map((d) => d.costo_usd)))
  const h = hi != null ? dias[hi] : null
  return (
    <div className="flex-1 flex flex-col">
      <div className="relative" style={{ height: 168 }}>
        {h && (
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 bg-app border border-line rounded-lg px-3 py-2 text-xs z-10 shadow whitespace-nowrap">
            <div className="font-semibold text-ink mb-0.5">{h.fecha}</div>
            <div className="text-muted">Total: <span className="text-ink font-medium">{usd3(h.costo_usd)}</span></div>
            <div className="text-muted">Mensajes: <span className="font-medium" style={{ color: '#2F4068' }}>{usd3(h.costo_mensajes)}</span></div>
            <div className="text-muted">Errores: <span className="font-medium" style={{ color: '#ef4444' }}>{usd3(h.costo_errores)}</span></div>
          </div>
        )}
        <div className="absolute inset-0 flex items-end gap-[3px]">
          {dias.map((d, i) => {
            const errFrac = d.costo_usd > 0 ? d.costo_errores / d.costo_usd : 0
            return (
              <div key={d.fecha} className="flex-1 h-full flex items-end" onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
                <div className="w-full flex flex-col justify-end rounded-md overflow-hidden transition-opacity"
                  style={{ height: `${Math.max((d.costo_usd / max) * 100, d.costo_usd > 0 ? 3 : 1)}%`, opacity: hi == null || hi === i ? 1 : 0.45 }}>
                  {errFrac > 0 && <div style={{ height: `${errFrac * 100}%`, background: '#ef4444' }} />}
                  <div className="flex-1" style={{ background: '#2F4068' }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex gap-[3px] mt-1.5">
        {dias.map((d, i) => (
          <span key={d.fecha} className="flex-1 text-center text-[9px] text-muted">{i % 2 === 0 ? Number(d.fecha.slice(8)) : ''}</span>
        ))}
      </div>
    </div>
  )
}

function LineaMensual({ meses, hover, setHover }: { meses: MesTrend[]; hover: number | null; setHover: (i: number | null) => void }) {
  const W = 440, H = 220
  const padL = 46, padR = 16, padT = 26, padB = 26
  const top = niceMax(Math.max(0.001, ...meses.map((m) => m.costo_usd)))
  const x = (i: number) => meses.length <= 1 ? (padL + W - padR) / 2 : padL + (i * (W - padL - padR)) / (meses.length - 1)
  const y = (c: number) => (H - padB) - (c / top) * (H - padT - padB)
  const pts = meses.map((m, i) => [x(i), y(m.costo_usd)] as const)
  const linePts = pts.map((p) => p.join(',')).join(' ')
  const areaPts = `${padL},${H - padB} ${linePts} ${x(meses.length - 1)},${H - padB}`
  const h = hover != null ? meses[hover] : null
  const ticks = [0, 0.5, 1].map((f) => f * top)
  return (
    <div className="relative flex-1">
      {h && (
        <div className="absolute top-0 right-1 bg-app border border-line rounded-lg px-3 py-2 text-xs z-10 shadow whitespace-nowrap">
          <div className="font-semibold text-ink mb-0.5">{h.mes}</div>
          <div className="text-muted">Total: <span className="text-ink font-medium">{usd(h.costo_usd)}</span></div>
          <div className="text-muted">Conversaciones: <span className="text-ink font-medium">{fmt(h.conversaciones)}</span></div>
          <div className="text-muted">Prom. $/conv.: <span className="text-ink font-medium">{usd3(h.costo_por_conversacion)}</span></div>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet" style={{ maxHeight: 220 }}>
        <defs>
          <linearGradient id="areaTok" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F5B23D" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#F5B23D" stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((tk, i) => (
          <g key={i}>
            <line x1={padL} y1={y(tk)} x2={W - padR} y2={y(tk)} stroke="#94a3b8" strokeOpacity={0.18} strokeWidth={1} />
            <text x={padL - 8} y={y(tk) + 3} textAnchor="end" fontSize={9.5} fill="#94a3b8">{usd(tk)}</text>
          </g>
        ))}
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#94a3b8" strokeOpacity={0.4} strokeWidth={1} />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#94a3b8" strokeOpacity={0.4} strokeWidth={1} />
        {meses.length > 1 && <polygon points={areaPts} fill="url(#areaTok)" />}
        <polyline points={linePts} fill="none" stroke="#F5B23D" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {meses.map((m, i) => (
          <g key={m.mes} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
            <text x={x(i)} y={y(m.costo_usd) - 10} textAnchor="middle" fontSize={11} fontWeight={700} fill="currentColor" className="text-ink">{usd(m.costo_usd)}</text>
            <circle cx={x(i)} cy={y(m.costo_usd)} r={hover === i ? 5.5 : 3.5} fill="#F5B23D" stroke="#fff" strokeWidth={hover === i ? 1.5 : 0} />
            <rect x={x(i) - 20} y={padT} width={40} height={H - padT - padB} fill="transparent" />
            <text x={x(i)} y={H - 9} textAnchor="middle" fontSize={9.5} fill="#94a3b8">{m.mes}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}
