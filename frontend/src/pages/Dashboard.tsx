import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../api/client'
import { DashboardStats, ESTADOS } from '../api/types'

// Cada serie de la evolución histórica → estado por el que filtra en Prospects
// ('' = sin filtro de estado, muestra todos los encontrados de ese mes)
const SERIE_ESTADO: Record<string, string> = {
  'Encontrados': '',
  'Interesados': 'interesado',
  'No le interesa': 'no_le_interesa',
}

// Tooltip clickeable del gráfico histórico: cada fila lleva a Prospects
// filtrado por ese mes + estado.
function HistTooltip({ active, payload, navigate }: any) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload ?? {}
  const mesRaw: string = point._mesRaw
  const go = (estado: string) => {
    const p = new URLSearchParams({ mes: mesRaw })
    if (estado) p.set('estado', estado)
    navigate(`/prospects?${p.toString()}`)
  }
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
      padding: '8px 10px', boxShadow: '0 2px 10px rgba(0,0,0,.14)',
      fontSize: 11, pointerEvents: 'auto', minWidth: 150,
    }}>
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{point.mes}</p>
      {payload.map((item: any) => (
        <button
          key={item.name}
          onClick={() => go(SERIE_ESTADO[item.name] ?? '')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, width: '100%',
            textAlign: 'left', padding: '3px 4px', borderRadius: 4,
            cursor: 'pointer', background: 'transparent', border: 'none',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ width: 8, height: 8, borderRadius: 9999, background: item.color, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{item.name}: <b>{item.value}</b></span>
          <span style={{ color: '#9ca3af' }}>ver →</span>
        </button>
      ))}
      <p style={{ color: '#9ca3af', marginTop: 4, fontSize: 10 }}>Clic en un dato para ver los registros</p>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString('es-AR') }

function mesLabel(yyyymm: string) {
  const [y, m] = yyyymm.split('-')
  const names = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  return `${names[parseInt(m) - 1]} ${y.slice(2)}`
}

// ── Subcomponentes ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color = '#6366f1' }: {
  label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <div className="bg-white rounded-xl p-4 flex flex-col gap-1">
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

type TerminoRow = { termino: string; Encontrados: number; 'En conversación': number; Interesados: number }

function TerminoChart({ data }: { data: TerminoRow[] }) {
  return (
    <div className="bg-white rounded-xl shadow p-4 md:p-5">
      <h2 className="font-semibold mb-4 text-sm md:text-base">Prospects por término</h2>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 5, bottom: 5, left: -10, right: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="termino" tick={DiagonalTick as any} interval={0} height={80} />
          <YAxis tick={{ fontSize: 10 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Tooltip
            position={{ y: 145 }}
            contentStyle={{ fontSize: 11, padding: '6px 10px', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,.12)' }}
            cursor={{ fill: 'rgba(0,0,0,.04)' }}
          />
          <Bar dataKey="Encontrados"     fill="#3b82f6" radius={[3,3,0,0]} />
          <Bar dataKey="En conversación" fill="#8b5cf6" radius={[3,3,0,0]} />
          <Bar dataKey="Interesados"     fill="#22c55e" radius={[3,3,0,0]} />
        </BarChart>
      </ResponsiveContainer>
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

  // Datos para pie charts
  const pieTotal = por_estado.map(e => ({
    name: ESTADOS[e.estado]?.label ?? e.estado,
    value: e.count,
    color: ESTADOS[e.estado]?.color ?? '#94a3b8',
  }))
  const pieMes = por_estado_mes.map(e => ({
    name: ESTADOS[e.estado]?.label ?? e.estado,
    value: e.count,
    color: ESTADOS[e.estado]?.color ?? '#94a3b8',
  }))

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
          />
          <KpiCard
            label="En conversación"
            value={fmt(mes_actual.en_conversacion)}
            color={ESTADOS.en_conversacion.color}
          />
          <KpiCard
            label="Interesados"
            value={fmt(mes_actual.interesados)}
            color={ESTADOS.interesado.color}
          />
          <KpiCard
            label="Tasa de respuesta"
            value={`${mes_actual.tasa_respuesta}%`}
            sub="en conv. / generados"
            color="#8b5cf6"
          />
          <KpiCard
            label="Tasa de conversión"
            value={`${mes_actual.tasa_conversion}%`}
            sub="interesados / generados"
            color="#22c55e"
          />
        </div>
      </div>

      {/* ── GRÁFICOS FILA 1 ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Prospects por término */}
        <TerminoChart data={terminoData} />

        {/* Distribución por estado — dos pies */}
        <div className="bg-white rounded-xl shadow p-4 md:p-5">
          <h2 className="font-semibold mb-4 text-sm md:text-base">Distribución por estado</h2>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-center text-gray-400 mb-1">Este mes</p>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={pieMes} dataKey="value" nameKey="name"
                    cx="50%" cy="50%" outerRadius={60} label={false}>
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
                    cx="50%" cy="50%" outerRadius={60} label={false}>
                    {pieTotal.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          {/* Leyenda compartida */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-2">
            {pieTotal.map(e => (
              <span key={e.name} className="flex items-center gap-1 text-xs text-gray-500">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: e.color }} />
                {e.name}
              </span>
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
