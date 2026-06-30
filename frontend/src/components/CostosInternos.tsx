import { useState } from 'react'

export type AnthFuncion = { funcion: string; costo_usd: number }
export type AnthMes = { mes: string; nombre: string; total: number; por_funcion: Record<string, number> }
export type AnthUsage = {
  mes_actual: string; mes_nombre: string; dias_transcurridos: number
  total_mes: number; prev_total: number; delta_pct: number | null
  por_funcion: AnthFuncion[]; meses: AnthMes[]
}

const PALETTE = ['#F5B23D', '#6CB6FF', '#5AD8A6', '#C792EA', '#FF9F7E', '#8294B4', '#E0A02E', '#9FE0FF']
const usd = (n: number) => '$' + (n ?? 0).toFixed((n ?? 0) < 1 ? 3 : 2)
const corto = (f: string) => f.split(' (')[0]

export default function CostosInternos({ data }: { data: AnthUsage }) {
  const [hoverMes, setHoverMes] = useState<number | null>(null)

  // mapa estable función → color (orden alfabético de todas las funciones vistas)
  const nombres = Array.from(new Set([
    ...data.por_funcion.map((f) => f.funcion),
    ...data.meses.flatMap((m) => Object.keys(m.por_funcion)),
  ])).sort()
  const color = (f: string) => PALETTE[nombres.indexOf(f) % PALETTE.length]

  const fs = data.por_funcion
  const totalMes = data.total_mes || fs.reduce((s, f) => s + f.costo_usd, 0)
  const maxFn = Math.max(0.000001, ...fs.map((f) => f.costo_usd))
  const delta = data.delta_pct

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Costos internos · API Anthropic</h2>
        <span className="text-xs text-muted">funciones de Prospia (Especialista, intake, clasificación…) — separado de Camila</span>
      </div>

      {/* ───── Mes actual ───── */}
      <div>
        <p className="text-xs text-muted mb-2">Mes actual · <span className="text-ink-soft font-medium">{data.mes_nombre}</span></p>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Kpi label="Costo del mes" value={usd(totalMes)} amber />
          <Kpi label="Promedio por día" value={usd(totalMes / Math.max(1, data.dias_transcurridos))} />
          <Kpi label="vs mes anterior" value={delta == null ? '—' : `${delta <= 0 ? '▼' : '▲'} ${Math.abs(delta)}%`}
               tone={delta == null ? undefined : delta <= 0 ? 'down' : 'up'} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* barras por función */}
          <div className="bg-card border border-line rounded-2xl p-5">
            <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-4">Costo por función</h3>
            {fs.length === 0 ? <p className="text-sm text-muted">Sin uso este mes todavía.</p> : fs.map((f) => (
              <div key={f.funcion} className="mb-3.5">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm text-ink">{corto(f.funcion)}</span>
                  <span className="text-sm font-bold" style={{ color: color(f.funcion) }}>{usd(f.costo_usd)}</span>
                </div>
                <div className="h-2 rounded bg-subtle overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${(f.costo_usd / maxFn * 100).toFixed(1)}%`, background: color(f.funcion) }} />
                </div>
                <div className="text-[10.5px] text-faint mt-0.5">{totalMes > 0 ? (f.costo_usd / totalMes * 100).toFixed(0) : 0}% del mes</div>
              </div>
            ))}
          </div>

          {/* donut participación */}
          <div className="bg-card border border-line rounded-2xl p-5">
            <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">Participación</h3>
            {fs.length === 0 ? <p className="text-sm text-muted">—</p> : (
              <div className="flex flex-col items-center">
                <Donut fs={fs} total={totalMes} color={color} />
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 justify-center">
                  {fs.map((f) => (
                    <span key={f.funcion} className="flex items-center gap-1.5 text-[11.5px] text-ink-soft">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color(f.funcion) }} />
                      {corto(f.funcion)} · {totalMes > 0 ? (f.costo_usd / totalMes * 100).toFixed(0) : 0}%
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ───── Histórico ───── */}
      <div className="bg-card border border-line rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Histórico mensual</h3>
          <span className="text-[11px] text-muted">apilado por función · pasá el mouse</span>
        </div>
        {data.meses.length === 0 ? <p className="text-sm text-muted">Sin histórico todavía.</p> : (
          <Stacked meses={data.meses} nombres={nombres} color={color} hover={hoverMes} setHover={setHoverMes} />
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
          {nombres.map((n) => (
            <span key={n} className="flex items-center gap-1.5 text-[11.5px] text-ink-soft">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color(n) }} />{corto(n)}
            </span>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-faint">Precio oficial de Anthropic (key directa, sin el 10% off de MyClaw). Camila va por MyClaw y se mide aparte, arriba.</p>
    </div>
  )
}

function Kpi({ label, value, amber, tone }: { label: string; value: string; amber?: boolean; tone?: 'up' | 'down' }) {
  const c = tone === 'up' ? 'text-red-400' : tone === 'down' ? 'text-emerald-400' : amber ? 'text-amber-400' : 'text-ink'
  return (
    <div className="bg-card border border-line rounded-2xl p-4">
      <div className={`text-2xl font-semibold ${c}`}>{value}</div>
      <div className="text-xs text-muted mt-1">{label}</div>
    </div>
  )
}

function Donut({ fs, total, color }: { fs: AnthFuncion[]; total: number; color: (f: string) => string }) {
  const R = 70, C = 2 * Math.PI * R
  let off = 0
  return (
    <svg width="180" height="180" viewBox="0 0 200 200">
      {fs.map((f) => {
        const frac = total > 0 ? f.costo_usd / total : 0
        const el = (
          <circle key={f.funcion} cx="100" cy="100" r={R} fill="none" stroke={color(f.funcion)} strokeWidth="26"
            strokeDasharray={`${(frac * C).toFixed(2)} ${C.toFixed(2)}`} strokeDashoffset={`${(-off * C).toFixed(2)}`}
            transform="rotate(-90 100 100)" />
        )
        off += frac
        return el
      })}
      <text x="100" y="96" textAnchor="middle" fill="#EEF3FB" fontSize="20" fontWeight="700" fontFamily="JetBrains Mono">{usd(total)}</text>
      <text x="100" y="116" textAnchor="middle" fill="#8294B4" fontSize="11">este mes</text>
    </svg>
  )
}

function Stacked({ meses, nombres, color, hover, setHover }: {
  meses: AnthMes[]; nombres: string[]; color: (f: string) => string
  hover: number | null; setHover: (i: number | null) => void
}) {
  const W = 900, H = 320, padL = 50, padR = 14, padT = 22, padB = 38
  const cw = W - padL - padR, ch = H - padT - padB, n = meses.length
  const maxT = Math.max(0.000001, ...meses.map((m) => m.total))
  const gap = cw / n, bw = Math.min(64, gap * 0.6)
  const y = (v: number) => padT + ch - (v / maxT) * ch
  const grid = [0, 0.25, 0.5, 0.75, 1].map((p) => maxT * p)

  return (
    <div className="relative">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {grid.map((v, i) => (
          <g key={i}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#243454" strokeWidth="1" />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fill="#5C6E90" fontSize="10" fontFamily="JetBrains Mono">{usd(v)}</text>
          </g>
        ))}
        {meses.map((m, i) => {
          const cx = padL + gap * i + gap / 2
          let yb = padT + ch
          const segs = nombres.filter((nm) => (m.por_funcion[nm] ?? 0) > 0).map((nm) => {
            const h = (m.por_funcion[nm] / maxT) * ch
            yb -= h
            return <rect key={nm} x={cx - bw / 2} y={yb} width={bw} height={h} rx="2" fill={color(nm)}><title>{corto(nm)}: {usd(m.por_funcion[nm])}</title></rect>
          })
          return (
            <g key={m.mes} opacity={hover == null || hover === i ? 1 : 0.45}>
              {segs}
              <text x={cx} y={y(m.total) - 6} textAnchor="middle" fill="#EEF3FB" fontSize="11" fontWeight="700" fontFamily="JetBrains Mono">{usd(m.total)}</text>
              <text x={cx} y={H - padB + 17} textAnchor="middle" fill="#8294B4" fontSize="11">{m.nombre}</text>
              <rect x={padL + gap * i} y={padT} width={gap} height={ch} fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
