import { useState } from 'react'

export type AnthFuncion = { funcion: string; costo_usd: number }
export type AnthMes = { mes: string; nombre: string; total: number; por_funcion: Record<string, number> }
export type AnthUsage = {
  mes_actual: string; mes_nombre: string; dias_transcurridos: number
  total_mes: number; prev_total: number; delta_pct: number | null
  por_funcion: AnthFuncion[]; meses: AnthMes[]
  por_dia?: Record<string, number>  // 'YYYY-MM-DD' -> costo interno del día
}

const PALETTE = ['#F5B23D', '#6CB6FF', '#5AD8A6', '#C792EA', '#FF9F7E', '#8294B4', '#E0A02E', '#9FE0FF']
const usd = (n: number) => '$' + (n ?? 0).toFixed((n ?? 0) < 1 ? 3 : 2)
const corto = (f: string) => f.split(' (')[0]

/** Mapa estable función → color (orden alfabético de todas las funciones vistas),
 * compartido por todos los widgets de costos internos para que los colores coincidan. */
function colorMap(data: AnthUsage) {
  const nombres = Array.from(new Set([
    ...data.por_funcion.map((f) => f.funcion),
    ...data.meses.flatMap((m) => Object.keys(m.por_funcion)),
  ])).sort()
  return { nombres, color: (f: string) => PALETTE[nombres.indexOf(f) % PALETTE.length] }
}

// ─── Widget: resumen del mes (KPIs) ───────────────────────────────────────────
export function CostosResumenMes({ data }: { data: AnthUsage }) {
  const fs = data.por_funcion
  const total = data.total_mes || fs.reduce((s, f) => s + f.costo_usd, 0)
  const delta = data.delta_pct
  return (
    <div>
      <p className="text-xs text-muted mb-2">{data.mes_nombre}</p>
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Costo del mes" value={usd(total)} amber />
        <Kpi label="Promedio por día" value={usd(total / Math.max(1, data.dias_transcurridos))} />
        <Kpi label="vs mes anterior" value={delta == null ? '—' : `${delta <= 0 ? '▼' : '▲'} ${Math.abs(delta)}%`}
             tone={delta == null ? undefined : delta <= 0 ? 'down' : 'up'} />
      </div>
    </div>
  )
}

// ─── Widget: costo por función (barras) ───────────────────────────────────────
export function CostosPorFuncion({ data }: { data: AnthUsage }) {
  const { color } = colorMap(data)
  const fs = data.por_funcion
  const total = data.total_mes || fs.reduce((s, f) => s + f.costo_usd, 0)
  const maxFn = Math.max(0.000001, ...fs.map((f) => f.costo_usd))
  if (fs.length === 0) return <p className="text-sm text-muted">Sin uso este mes todavía.</p>
  return (
    <div>
      {fs.map((f) => (
        <div key={f.funcion} className="mb-3.5">
          <div className="flex justify-between items-baseline mb-1">
            <span className="text-sm text-ink">{corto(f.funcion)}</span>
            <span className="text-sm font-bold" style={{ color: color(f.funcion) }}>{usd(f.costo_usd)}</span>
          </div>
          <div className="h-2 rounded bg-subtle overflow-hidden">
            <div className="h-full rounded" style={{ width: `${(f.costo_usd / maxFn * 100).toFixed(1)}%`, background: color(f.funcion) }} />
          </div>
          <div className="text-[10.5px] text-faint mt-0.5">{total > 0 ? (f.costo_usd / total * 100).toFixed(0) : 0}% del mes</div>
        </div>
      ))}
    </div>
  )
}

// ─── Widget: participación (donut) ────────────────────────────────────────────
export function CostosParticipacion({ data }: { data: AnthUsage }) {
  const { color } = colorMap(data)
  const [hover, setHover] = useState<number | null>(null)
  const fs = data.por_funcion
  const total = data.total_mes || fs.reduce((s, f) => s + f.costo_usd, 0)
  if (fs.length === 0) return <p className="text-sm text-muted">—</p>
  const hf = hover != null ? fs[hover] : null
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        {hf && (
          <div className="absolute top-1 right-1 bg-app border border-line rounded-lg px-3 py-2 text-xs z-10 shadow whitespace-nowrap pointer-events-none">
            <div className="flex items-center gap-1.5 font-semibold text-ink mb-0.5">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color(hf.funcion) }} />
              {corto(hf.funcion)}
            </div>
            <div className="text-muted">Costo: <span className="text-ink font-medium">{usd(hf.costo_usd)}</span></div>
            <div className="text-muted">Participación: <span className="text-ink font-medium">{total > 0 ? (hf.costo_usd / total * 100).toFixed(1) : 0}%</span></div>
          </div>
        )}
        <Donut fs={fs} total={total} color={color} hover={hover} setHover={setHover} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 justify-center">
        {fs.map((f, i) => (
          <span key={f.funcion}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            className={`flex items-center gap-1.5 text-[11.5px] cursor-default ${hover === i ? 'text-ink' : 'text-ink-soft'}`}>
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color(f.funcion) }} />
            {corto(f.funcion)} · {total > 0 ? (f.costo_usd / total * 100).toFixed(0) : 0}%
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Widget: histórico mensual (barras apiladas) ──────────────────────────────
export function CostosHistorico({ data }: { data: AnthUsage }) {
  const [hover, setHover] = useState<number | null>(null)
  const { nombres, color } = colorMap(data)
  if (data.meses.length === 0) return <p className="text-sm text-muted">Sin histórico todavía.</p>
  const mh = hover != null ? data.meses[hover] : null
  const filasHover = mh
    ? nombres.filter((nm) => (mh.por_funcion[nm] ?? 0) > 0)
        .map((nm) => ({ nm, v: mh.por_funcion[nm] }))
        .sort((a, b) => b.v - a.v)
    : []
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="relative flex-1 min-h-0">
        {mh && (
          <div className="absolute top-0 right-1 bg-app border border-line rounded-lg px-3 py-2 text-xs z-10 shadow whitespace-nowrap pointer-events-none">
            <div className="font-semibold text-ink mb-1">{mh.nombre} · <span className="text-amber-400">{usd(mh.total)}</span></div>
            {filasHover.map(({ nm, v }) => (
              <div key={nm} className="flex items-center gap-1.5 text-muted">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color(nm) }} />
                <span className="text-ink-soft">{corto(nm)}</span>
                <span className="ml-auto pl-3 text-ink font-medium">{usd(v)}</span>
              </div>
            ))}
          </div>
        )}
        <Stacked meses={data.meses} nombres={nombres} color={color} hover={hover} setHover={setHover} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 shrink-0">
        {nombres.map((n) => (
          <span key={n} className="flex items-center gap-1.5 text-[11.5px] text-ink-soft">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color(n) }} />{corto(n)}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── helpers visuales ─────────────────────────────────────────────────────────
function Kpi({ label, value, amber, tone }: { label: string; value: string; amber?: boolean; tone?: 'up' | 'down' }) {
  const c = tone === 'up' ? 'text-red-400' : tone === 'down' ? 'text-emerald-400' : amber ? 'text-amber-400' : 'text-ink'
  return (
    <div className="cq bg-app border border-line rounded-xl p-3">
      <div className={`fluid-num font-semibold ${c}`}>{value}</div>
      <div className="text-[11px] text-muted mt-1 truncate">{label}</div>
    </div>
  )
}

function Donut({ fs, total, color, hover, setHover }: {
  fs: AnthFuncion[]; total: number; color: (f: string) => string
  hover: number | null; setHover: (i: number | null) => void
}) {
  const R = 70, C = 2 * Math.PI * R
  let off = 0
  return (
    <svg width="180" height="180" viewBox="0 0 200 200" className="max-w-full">
      {fs.map((f, i) => {
        const frac = total > 0 ? f.costo_usd / total : 0
        const el = (
          <circle key={f.funcion} cx="100" cy="100" r={R} fill="none" stroke={color(f.funcion)}
            strokeWidth={hover === i ? 32 : 26} opacity={hover == null || hover === i ? 1 : 0.4}
            strokeDasharray={`${(frac * C).toFixed(2)} ${C.toFixed(2)}`} strokeDashoffset={`${(-off * C).toFixed(2)}`}
            transform="rotate(-90 100 100)" style={{ cursor: 'pointer', transition: 'stroke-width .1s, opacity .1s' }}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <title>{corto(f.funcion)}: {usd(f.costo_usd)}</title>
          </circle>
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
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ minHeight: 160 }}>
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
  )
}
