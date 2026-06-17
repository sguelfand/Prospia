import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../api/client'
import { DashboardStats, ESTADOS } from '../api/types'

// Cada serie de la evolución histórica → estado por el que filtra en Prospects
const SERIE_ESTADO: Record<string, string> = {
  'Encontrados': '',
  'Interesados': 'interesado',
  'No le interesa': 'no_le_interesa',
}

// Tooltip clickeable y compacto: clic en una fila → Prospects filtrado por ese
// mes + estado. Sin "ver" para que el clic sea sobre el propio dato.
function HistTooltip({ active, payload, navigate }: any) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload ?? {}
  const go = (estado: string) => {
    const p = new URLSearchParams({ mes: point._mesRaw })
    if (estado) p.set('estado', estado)
    navigate(`/prospects?${p.toString()}`)
  }
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
      padding: '5px 6px', boxShadow: '0 2px 10px rgba(0,0,0,.14)',
      fontSize: 11, pointerEvents: 'auto',
    }}>
      <p style={{ fontWeight: 600, margin: '0 0 3px', padding: '0 2px' }}>{point.mes}</p>
      {payload.map((item: any) => (
        <button
          key={item.name}
          onClick={() => go(SERIE_ESTADO[item.name] ?? '')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, width: '100%',
            textAlign: 'left', padding: '3px 6px', borderRadius: 4,
            cursor: 'pointer', background: 'transparent', border: 'none', fontSize: 11,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ width: 8, height: 8, borderRadius: 9999, background: item.color, flexShrink: 0 }} />
          <span>{item.name}: <b>{item.value}</b></span>
        </button>
      ))}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString('es-AR') }

// Mes actual en formato YYYY-MM (igual al filtro `mes` de Prospects)
function mesActualYYYYMM() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function mesLabel(yyyymm: string) {
  const [y, m] = yyyymm.split('-')
  const names = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  return `${names[parseInt(m) - 1]} ${y.slice(2)}`
}

// ── Subcomponentes ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color = '#6366f1', onClick }: {
  label: string; value: string | number; sub?: string; color?: string; onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl p-4 flex flex-col gap-1${onClick ? ' cursor-pointer hover:shadow-md transition-shadow' : ''}`}
    >
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl md:text-3xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

// Tick diagonal para el eje X del gráfico de términos
function DiagonalTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const text = payload?.value ?? ''
  const short = text.length > 20 ? text.slice(0, 18) + '…' : text
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={10} textAnchor="end" fill="#94a3b8"
        fontSize={10} transform="rotate(-40)">
        {short}
      </text>
    </g>
  )
}

// ── TerminoChart ─────────────────────────────────────────────────────────────

type TerminoRow = { termino: string; termino_id: number; Encontrados: number; 'En conversación': number; Interesados: number }

// Series del gráfico de términos → estado por el que filtra Prospects
const TERMINO_SERIES: { key: 'Encontrados' | 'En conversación' | 'Interesados'; estado: string; color: string }[] = [
  { key: 'Encontrados',     estado: '',                color: '#3b82f6' },
  { key: 'En conversación', estado: 'en_conversacion', color: '#8b5cf6' },
  { key: 'Interesados',     estado: 'interesado',      color: '#22c55e' },
]

function TerminoChart({ data, navigate }: { data: TerminoRow[]; navigate: ReturnType<typeof useNavigate> }) {
  // Panel propio (en vez del Tooltip nativo): aparece al pasar sobre una barra,
  // queda fijo y solo se cierra al salir del gráfico o del panel. Así se puede
  // entrar al cuadro y clickear el estado, igual que Evolución histórica.
  const [hover, setHover] = useState<{ row: TerminoRow; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const PANEL_W = 190

  function onBarEnter(d: any) {
    const row = d?.payload as TerminoRow | undefined
    if (!row) return
    const w = wrapRef.current?.clientWidth ?? 0
    const center = (d?.x ?? 0) + (d?.width ?? 0) / 2
    const left = Math.max(4, Math.min(center - PANEL_W / 2, w - PANEL_W - 4))
    setHover({ row, left })
  }

  function go(row: TerminoRow, estado: string) {
    const p = new URLSearchParams({ termino_id: String(row.termino_id) })
    if (estado) p.set('estado', estado)
    navigate(`/prospects?${p.toString()}`)
  }

  return (
    <div className="bg-white rounded-xl shadow p-4 md:p-5">
      <h2 className="font-semibold mb-1 text-sm md:text-base">Prospects por término</h2>
      <p className="text-xs text-gray-400 mb-2">Pasá el mouse por una barra y clickeá el estado</p>
      <div ref={wrapRef} className="relative" onMouseLeave={() => setHover(null)}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 5, bottom: 5, left: -10, right: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="termino" tick={DiagonalTick as any} interval={0} height={80} />
            <YAxis tick={{ fontSize: 10 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {/* Tooltip solo para el resaltado de la columna; el cuadro lo dibujamos nosotros */}
            <Tooltip cursor={{ fill: 'rgba(0,0,0,.04)' }} content={() => null} />
            {TERMINO_SERIES.map(s => (
              <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[3, 3, 0, 0]}
                cursor="pointer" onMouseEnter={onBarEnter} onClick={(d: any) => go(d.payload, s.estado)} />
            ))}
          </BarChart>
        </ResponsiveContainer>

        {hover && (
          <div
            className="absolute top-0 z-20"
            style={{ left: hover.left, width: PANEL_W }}
            onMouseLeave={() => setHover(null)}
          >
            <div style={{
              background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
              padding: '5px 6px', boxShadow: '0 2px 10px rgba(0,0,0,.14)', fontSize: 11,
            }}>
              <p className="truncate" style={{ fontWeight: 600, margin: '0 0 3px', padding: '0 2px' }}>{hover.row.termino}</p>
              {TERMINO_SERIES.map(s => (
                <button
                  key={s.key}
                  onClick={() => go(hover.row, s.estado)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    textAlign: 'left', padding: '3px 6px', borderRadius: 4,
                    cursor: 'pointer', background: 'transparent', border: 'none', fontSize: 11,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 9999, background: s.color, flexShrink: 0 }} />
                  <span>{s.key}: <b>{hover.row[s.key]}</b></span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.get<DashboardStats>('/dashboard/stats').then(setStats).catch(console.error)
  }, [])

  if (!stats) return <div className="text-gray-400 p-4">Cargando...</div>

  const { mes_actual, por_estado, por_estado_mes, por_termino, por_mes } = stats

  // Datos para pie charts (estado = clave por la que filtra Prospects)
  const pieTotal = por_estado.map(e => ({
    name: ESTADOS[e.estado]?.label ?? e.estado,
    value: e.count,
    color: ESTADOS[e.estado]?.color ?? '#94a3b8',
    estado: e.estado,
  }))
  const pieMes = por_estado_mes.map(e => ({
    name: ESTADOS[e.estado]?.label ?? e.estado,
    value: e.count,
    color: ESTADOS[e.estado]?.color ?? '#94a3b8',
    estado: e.estado,
  }))

  const mesAct = mesActualYYYYMM()

  // Navega a Prospects con filtros. Omite los vacíos.
  const goProspects = (filtros: Record<string, string>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(filtros)) if (v) p.set(k, v)
    navigate(`/prospects?${p.toString()}`)
  }

  // Datos para la evolución mensual
  const mesData = por_mes.map(m => ({
    mes: mesLabel(m.mes),
    _mesRaw: m.mes,
    Encontrados:    m.encontrados,
    Interesados:    m.interesados,
    'No le interesa': m.no_le_interesa,
  }))

  // Datos para términos
  const terminoData = por_termino.map(t => ({
    termino:           t.termino,
    termino_id:        t.termino_id,
    Encontrados:       t.encontrados,
    'En conversación': t.en_conversacion,
    Interesados:       t.interesados,
  }))

  const mesNombre = new Date().toLocaleString('es-AR', { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-5">
      <h1 className="text-xl md:text-2xl font-bold">Dashboard</h1>

      {/* ── MES ACTUAL ─────────────────────────────────────────────────────── */}
      <div className="border border-gray-200 rounded-2xl p-4 md:p-5 space-y-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
          MES ACTUAL — {mesNombre}
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard
            label="Prospects generados"
            value={fmt(mes_actual.prospects)}
            color="#1e293b"
            onClick={() => goProspects({ mes: mesAct })}
          />
          <KpiCard
            label="En conversación"
            value={fmt(mes_actual.en_conversacion)}
            color={ESTADOS.en_conversacion.color}
            onClick={() => goProspects({ mes: mesAct, estado: 'en_conversacion' })}
          />
          <KpiCard
            label="Interesados"
            value={fmt(mes_actual.interesados)}
            color={ESTADOS.interesado.color}
            onClick={() => goProspects({ mes: mesAct, estado: 'interesado' })}
          />
          <KpiCard
            label="Tasa de respuesta"
            value={`${mes_actual.tasa_respuesta}%`}
            sub="en conv. / generados"
            color="#8b5cf6"
            onClick={() => goProspects({ mes: mesAct, estado: 'en_conversacion' })}
          />
          <KpiCard
            label="Tasa de conversión"
            value={`${mes_actual.tasa_conversion}%`}
            sub="interesados / generados"
            color="#22c55e"
            onClick={() => goProspects({ mes: mesAct, estado: 'interesado' })}
          />
        </div>
      </div>

      {/* ── GRÁFICOS FILA 1 ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Prospects por término */}
        <TerminoChart data={terminoData} navigate={navigate} />

        {/* Distribución por estado — dos pies */}
        <div className="bg-white rounded-xl shadow p-4 md:p-5">
          <h2 className="font-semibold mb-4 text-sm md:text-base">Distribución por estado</h2>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-center text-gray-400 mb-1">Este mes</p>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={pieMes} dataKey="value" nameKey="name"
                    cx="50%" cy="50%" outerRadius={60} label={false}
                    onClick={(d: any) => goProspects({ mes: mesAct, estado: d?.payload?.estado })}
                    style={{ cursor: 'pointer' }}>
                    {pieMes.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-xs text-center text-gray-400 mb-1">Total</p>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={pieTotal} dataKey="value" nameKey="name"
                    cx="50%" cy="50%" outerRadius={60} label={false}
                    onClick={(d: any) => goProspects({ estado: d?.payload?.estado })}
                    style={{ cursor: 'pointer' }}>
                    {pieTotal.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          {/* Leyenda compartida — clic filtra Prospects por ese estado (total) */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-2">
            {pieTotal.map(e => (
              <button
                key={e.name}
                onClick={() => goProspects({ estado: e.estado })}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 cursor-pointer"
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: e.color }} />
                {e.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── EVOLUCIÓN HISTÓRICA ──────────────────────────────────────────────── */}
      {mesData.length > 0 && (
        <div className="bg-white rounded-xl shadow p-4 md:p-5">
          <h2 className="font-semibold mb-4 text-sm md:text-base">Evolución histórica</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={mesData} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                content={(props: any) => <HistTooltip {...props} navigate={navigate} />}
                position={{ y: 0 }}
                wrapperStyle={{ pointerEvents: 'auto' }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Encontrados"      stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="Interesados"      stroke="#22c55e" strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="No le interesa"   stroke="#6b7280" strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
