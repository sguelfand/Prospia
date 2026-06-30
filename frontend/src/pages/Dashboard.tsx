import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../api/client'
import { ClienteComparativa, DashboardComparativa, DashboardStats, ESTADOS } from '../api/types'
import { DashboardGrid, Widget, buildLayouts } from '../components/DashboardGrid'

const LAYOUT_CLIENTE = buildLayouts([
  { i: 'mesActual', x: 0, y: 0, w: 12, h: 5 },
  { i: 'termino', x: 0, y: 5, w: 6, h: 9 },
  { i: 'estado', x: 6, y: 5, w: 6, h: 9 },
  { i: 'evolucion', x: 0, y: 14, w: 12, h: 7 },
])

const LAYOUT_COMPARATIVA = buildLayouts([
  { i: 'kpisGlobal', x: 0, y: 0, w: 12, h: 4 },
  { i: 'gastos', x: 0, y: 4, w: 12, h: 14 },
  { i: 'compProspects', x: 0, y: 18, w: 6, h: 8 },
  { i: 'compInteresados', x: 6, y: 18, w: 6, h: 8 },
  { i: 'compResp', x: 0, y: 26, w: 6, h: 8 },
  { i: 'compConv', x: 6, y: 26, w: 6, h: 8 },
  { i: 'tabla', x: 0, y: 34, w: 12, h: 10 },
])

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
      background: 'rgb(var(--c-card))', border: '1px solid rgb(var(--c-line))',
      color: 'rgb(var(--c-ink))', borderRadius: 8,
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
          onMouseEnter={e => (e.currentTarget.style.background = 'rgb(var(--c-subtle))')}
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
      className={`cq bg-card rounded-xl p-4 flex flex-col gap-1${onClick ? ' cursor-pointer hover:shadow-md transition-shadow' : ''}`}
    >
      <p className="text-xs text-faint font-medium uppercase tracking-wide truncate">{label}</p>
      <p className="fluid-num font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-xs text-faint truncate">{sub}</p>}
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
    <div className="h-full flex flex-col min-h-0">
      <p className="text-xs text-faint mb-2 shrink-0">Pasá el mouse por una barra y clickeá el estado</p>
      <div ref={wrapRef} className="relative flex-1 min-h-0" style={{ minHeight: 180 }} onMouseLeave={() => setHover(null)}>
        <ResponsiveContainer width="100%" height="100%">
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
              background: 'rgb(var(--c-card))', border: '1px solid rgb(var(--c-line))',
              color: 'rgb(var(--c-ink))', borderRadius: 8,
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
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgb(var(--c-subtle))')}
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

// ── Dashboard (wrapper) ──────────────────────────────────────────────────────
// Superadmin (nivel 1) fuera de impersonación → comparativa de TODOS los clientes.
// Cualquier otro caso (cliente, o superadmin "viendo como cliente") → su dashboard.

export default function Dashboard() {
  const [nivel, setNivel] = useState<number | null>(null)
  const impersonating = !!localStorage.getItem('admin_token')

  useEffect(() => {
    api.get<{ nivel: number }>('/auth/me').then(me => setNivel(me.nivel)).catch(() => setNivel(2))
  }, [])

  if (nivel === null) return <div className="text-faint p-4">Cargando...</div>
  if (nivel === 1 && !impersonating) return <ComparativaDashboard />
  return <ClienteDashboard />
}

// ── Dashboard de un cliente (vista por tenant) ───────────────────────────────

function ClienteDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.get<DashboardStats>('/dashboard/stats').then(setStats).catch(console.error)
  }, [])

  if (!stats) return <div className="text-faint p-4">Cargando...</div>

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

      <DashboardGrid pantalla="dashboard-cliente" defaultLayout={LAYOUT_CLIENTE}>
        <div key="mesActual">
          <Widget id="mesActual" title={`Mes actual — ${mesNombre}`}>
            <div className="grid-auto-cards">
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
          </Widget>
        </div>

        <div key="termino">
          <Widget id="termino" title="Prospects por término">
            <TerminoChart data={terminoData} navigate={navigate} />
          </Widget>
        </div>

        <div key="estado">
          <Widget id="estado" title="Distribución por estado">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-center text-faint mb-1">Este mes</p>
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
              <p className="text-xs text-center text-faint mb-1">Total</p>
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
                className="flex items-center gap-1 text-xs text-muted hover:text-ink cursor-pointer"
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: e.color }} />
                {e.name}
              </button>
            ))}
          </div>
          </Widget>
        </div>

        <div key="evolucion">
          <Widget id="evolucion" title="Evolución histórica">
          {mesData.length === 0 ? <p className="text-sm text-muted">Sin histórico todavía.</p> : (
          <div className="flex-1 min-h-0" style={{ minHeight: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
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
          </Widget>
        </div>
      </DashboardGrid>
    </div>
  )
}

// ── Dashboard comparativo (superadmin) ───────────────────────────────────────

// "Ver como cliente" desde la comparativa: impersona ese tenant y recarga.
async function verComoCliente(tenantId: number) {
  try {
    const r = await api.post<{ access_token: string; cliente: string }>(`/admin/clientes/${tenantId}/impersonate`)
    localStorage.setItem('admin_token', localStorage.getItem('token') || '')
    localStorage.setItem('token', r.access_token)
    localStorage.setItem('viewing_as', r.cliente)
    window.location.href = '/dashboard'
  } catch {
    alert('No se pudo ver como ese cliente (¿tiene usuario?).')
  }
}

// Gráfico de barras comparativo por cliente. value = métrica; pct para % (tasas).
function CompBarChart({ title, sub, data, color, pct, onPick }: {
  title: string; sub?: string; color: string; pct?: boolean
  data: { nombre: string; tenant_id: number; fuente: string; value: number }[]
  onPick: (c: { tenant_id: number; fuente: string }) => void
}) {
  return (
    <div className="h-full flex flex-col min-h-0">
      {sub && <p className="text-xs text-faint mb-2 shrink-0">{sub}</p>}
      <div className="flex-1 min-h-0" style={{ minHeight: Math.max(160, data.length * 38) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 5, bottom: 5, left: 10, right: 16 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10 }} domain={pct ? [0, 100] : undefined} />
          <YAxis type="category" dataKey="nombre" tick={{ fontSize: 10 }} width={110} />
          <Tooltip cursor={{ fill: 'rgba(0,0,0,.04)' }}
            formatter={(v: any) => [pct ? `${v}%` : v, title]} />
          <Bar dataKey="value" fill={color} radius={[0, 3, 3, 0]} cursor="pointer"
            onClick={(d: any) => onPick(d?.payload)} />
        </BarChart>
      </ResponsiveContainer>
      </div>
    </div>
  )
}

// Gastos por cliente (mes actual + serie mensual) — fuente /admin/tokens/clientes.
type ClienteCosto = {
  id: string; nombre: string; mes_actual: string
  gasto_mes_actual: number; llamadas_mes: number
  serie_mensual: { mes: string; costo_usd: number; conversaciones: number }[]
}
const COSTO_COLORS = ['#f59e0b', '#3b82f6', '#22c55e', '#8b5cf6', '#ef4444', '#14b8a6']

function GastosClientes() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ClienteCosto[] | null>(null)
  useEffect(() => { api.get<ClienteCosto[]>('/admin/tokens/clientes').then(setRows).catch(() => setRows([])) }, [])
  if (!rows) return <p className="text-sm text-muted">Cargando…</p>
  if (rows.length === 0) return <p className="text-sm text-muted">Sin datos de costo todavía.</p>

  const meses = Array.from(new Set(rows.flatMap(r => r.serie_mensual.map(m => m.mes)))).sort()
  const dataset = meses.map(mes => {
    const o: Record<string, number | string> = { mes }
    rows.forEach(r => { o[r.id] = r.serie_mensual.find(m => m.mes === mes)?.costo_usd ?? 0 })
    return o
  })
  const total = rows.reduce((a, r) => a + r.gasto_mes_actual, 0)

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <div className="flex items-center justify-end shrink-0">
        <button onClick={() => navigate('/monitoreo/tokens')} className="text-xs text-accent hover:underline">ver detalle →</button>
      </div>
      {/* cards del mes actual */}
      <div className="grid-auto-cards">
        {rows.map((r, i) => (
          <div key={r.id} className="cq bg-card rounded-xl shadow p-4">
            <div className="fluid-num font-semibold tabular-nums" style={{ color: COSTO_COLORS[i % COSTO_COLORS.length] }}>${r.gasto_mes_actual.toFixed(2)}</div>
            <div className="text-xs text-faint mt-1 truncate">{r.nombre}</div>
            <div className="text-[11px] text-faint">{fmt(r.llamadas_mes)} llamadas · mes corriente</div>
          </div>
        ))}
        {rows.length > 1 && (
          <div className="cq bg-card rounded-xl shadow p-4 border border-line">
            <div className="fluid-num font-semibold tabular-nums text-ink">${total.toFixed(2)}</div>
            <div className="text-xs text-faint mt-1">Total clientes</div>
          </div>
        )}
      </div>
      {/* gráfico mensual por cliente */}
      <div className="border-t border-line pt-3 flex-1 min-h-0 flex flex-col" style={{ minHeight: 200 }}>
        <h3 className="font-semibold mb-1 text-sm shrink-0">Gasto mensual por cliente (USD)</h3>
        <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dataset} margin={{ top: 8, bottom: 5, left: 0, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => '$' + v} width={48} />
            <Tooltip formatter={(v: number, n: string) => ['$' + Number(v).toFixed(2), rows.find(r => r.id === n)?.nombre ?? n]} />
            {rows.map((r, i) => (
              <Bar key={r.id} dataKey={r.id} stackId="g" fill={COSTO_COLORS[i % COSTO_COLORS.length]} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function ComparativaDashboard() {
  const [data, setData] = useState<DashboardComparativa | null>(null)

  useEffect(() => {
    api.get<DashboardComparativa>('/admin/comparativa').then(setData).catch(console.error)
  }, [])

  if (!data) return <div className="text-faint p-4">Cargando...</div>

  // Solo los clientes de la Plataforma se pueden "ver como" (Etiguel vive en Monday).
  const pick = (c: { tenant_id: number; fuente: string }) => {
    if (c.fuente === 'plataforma') verComoCliente(c.tenant_id)
  }
  const barData = (sel: (c: ClienteComparativa) => number) =>
    [...data.clientes]
      .map(c => ({ nombre: c.nombre, tenant_id: c.tenant_id, fuente: c.fuente, value: sel(c) }))
      .sort((a, b) => b.value - a.value)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Dashboard — Todos los clientes</h1>
        <p className="text-xs text-faint mt-0.5">Comparativa entre clientes. Clickeá un cliente para verlo en detalle.</p>
      </div>

      <DashboardGrid pantalla="dashboard-comparativa" defaultLayout={LAYOUT_COMPARATIVA}>
        <div key="kpisGlobal">
          <Widget id="kpisGlobal" title="Totales — todos los clientes">
            <div className="grid-auto-cards">
        <KpiCard label="Clientes"        value={fmt(data.total_clientes)}  color="#1e293b" />
        <KpiCard label="Prospects"       value={fmt(data.total_prospects)} color="#3b82f6" />
        <KpiCard label="En conversación" value={fmt(data.en_conversacion)}  color={ESTADOS.en_conversacion.color} />
        <KpiCard label="Interesados"     value={fmt(data.interesados)}      color={ESTADOS.interesado.color} />
        <KpiCard label="Interesados (mes)" value={fmt(data.interesados_mes)} color="#22c55e" />
            </div>
          </Widget>
        </div>

        <div key="gastos">
          <Widget id="gastos" title="Gastos por cliente · costo IA" fuente="openclaw">
            <GastosClientes />
          </Widget>
        </div>

        <div key="compProspects">
          <Widget id="compProspects" title="Prospects por cliente">
            <CompBarChart title="Prospects por cliente" data={barData(c => c.total_prospects)} color="#3b82f6" onPick={pick} />
          </Widget>
        </div>
        <div key="compInteresados">
          <Widget id="compInteresados" title="Interesados por cliente">
            <CompBarChart title="Interesados por cliente" data={barData(c => c.interesados)} color="#22c55e" onPick={pick} />
          </Widget>
        </div>
        <div key="compResp">
          <Widget id="compResp" title="Tasa de respuesta">
            <CompBarChart title="Tasa de respuesta" sub="respondieron / contactados" pct data={barData(c => c.tasa_respuesta)} color="#8b5cf6" onPick={pick} />
          </Widget>
        </div>
        <div key="compConv">
          <Widget id="compConv" title="Tasa de conversión">
            <CompBarChart title="Tasa de conversión" sub="interesados / contactados" pct data={barData(c => c.tasa_conversion)} color="#f59e0b" onPick={pick} />
          </Widget>
        </div>

        <div key="tabla">
          <Widget id="tabla" title="Detalle por cliente">
            <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-muted text-left">
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3 text-right">Prospects</th>
              <th className="px-4 py-3 text-right">Contactados</th>
              <th className="px-4 py-3 text-right">En conv.</th>
              <th className="px-4 py-3 text-right">Interesados</th>
              <th className="px-4 py-3 text-right">Int./mes</th>
              <th className="px-4 py-3 text-right">T. resp.</th>
              <th className="px-4 py-3 text-right">T. conv.</th>
            </tr>
          </thead>
          <tbody>
            {data.clientes.map(c => (
              <tr
                key={`${c.fuente}-${c.tenant_id}`}
                onClick={() => pick(c)}
                className={`border-b border-line ${c.fuente === 'plataforma' ? 'hover:bg-app cursor-pointer' : ''}`}
              >
                <td className="px-4 py-3 font-medium">
                  {c.nombre}
                  {c.fuente === 'etiguel' && <span className="ml-2 text-[10px] font-mono bg-primary-soft text-accent px-1.5 py-0.5 rounded">Etiguel</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt(c.total_prospects)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt(c.contactados)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt(c.en_conversacion)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt(c.interesados)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmt(c.interesados_mes)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{c.tasa_respuesta}%</td>
                <td className="px-4 py-3 text-right tabular-nums">{c.tasa_conversion}%</td>
              </tr>
            ))}
          </tbody>
        </table>
            </div>
          </Widget>
        </div>
      </DashboardGrid>
    </div>
  )
}
