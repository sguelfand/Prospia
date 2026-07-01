import { RefreshCw, Phone } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { AnthUsage, CostosResumenMes, CostosPorFuncion, CostosParticipacion, CostosHistorico } from '../components/CostosInternos'
import { ClienteSelector, type SourceOpt } from '../components/ClienteSelector'
import { DashboardGrid, Widget, buildLayouts } from '../components/DashboardGrid'

const PANTALLA = 'tokens'
const GENERAL = '__general__'

// Vista de UN cliente: Camila (OpenClaw) + SUS costos internos de API (Anthropic).
const CLIENTE_LAYOUT = buildLayouts([
  { i: 'oportunidades', x: 0, y: 0, w: 12, h: 4 },
  { i: 'kpis', x: 0, y: 4, w: 12, h: 3 },
  { i: 'costoDia', x: 0, y: 7, w: 7, h: 9 },
  { i: 'historico', x: 7, y: 7, w: 5, h: 9 },
  { i: 'convs', x: 0, y: 16, w: 7, h: 13 },
  { i: 'porModelo', x: 7, y: 16, w: 5, h: 7 },
  // Costos internos (API Anthropic) de ESTE cliente
  { i: 'cMes', x: 0, y: 29, w: 4, h: 4 },
  { i: 'cFuncion', x: 4, y: 29, w: 4, h: 8 },
  { i: 'cParticipacion', x: 8, y: 29, w: 4, h: 8 },
  { i: 'cHistorico', x: 0, y: 37, w: 12, h: 8 },
])

// Vista General: comparativa entre clientes + costos internos (API Anthropic, globales).
const GENERAL_LAYOUT = buildLayouts([
  { i: 'gKpis', x: 0, y: 0, w: 12, h: 3 },
  { i: 'gGastoCliente', x: 0, y: 3, w: 6, h: 8 },
  { i: 'gCostoConv', x: 6, y: 3, w: 6, h: 8 },
  { i: 'gTendencia', x: 0, y: 11, w: 12, h: 8 },
  { i: 'gTabla', x: 0, y: 19, w: 12, h: 6 },
  { i: 'cMes', x: 0, y: 25, w: 4, h: 4 },
  { i: 'cFuncion', x: 4, y: 25, w: 4, h: 8 },
  { i: 'cParticipacion', x: 8, y: 25, w: 4, h: 8 },
  { i: 'cHistorico', x: 0, y: 33, w: 12, h: 8 },
])

type Totales = {
  total: number; llamadas: number; costo_usd: number
  costo_mensajes: number; costo_errores: number; errores: number; timeouts: number
  cacheRead: number; cacheWrite: number
}
type ConvModelo = { llamadas: number; costo_usd: number }
type Conv = {
  telefono: string; nombre?: string | null; mirror_id?: number
  tokens: number; costo_usd: number; llamadas: number
  input?: number; output?: number; cacheRead?: number; cacheWrite?: number
  timeouts: number; errores: number; compactaciones?: number
  por_modelo?: Record<string, ConvModelo>; primer_ts?: string | null; ultimo_ts?: string | null
  ejemplo: string | null; es_sistema: boolean
}
type MirrorMensaje = { id: number; direccion: string; texto: string; fecha: string }
type DiaDetalle = { fecha: string; totales: Totales; por_modelo: Record<string, { tokens: number; costo_usd: number; llamadas: number }>; conversaciones?: Conv[]; top_conversaciones?: Conv[]; n_conversaciones: number }
type Ultimo = DiaDetalle
type DiaTrend = { fecha: string; costo_usd: number; costo_mensajes: number; costo_errores: number }
type MesTrend = { mes: string; costo_usd: number; conversaciones: number; llamadas: number; costo_por_conversacion: number }
type Oportunidad = { id: number; tipo: string; clave: string; severidad: 'alta' | 'media' | 'baja'; titulo: string; detalle: string; estado: string; primera_vez: string | null; ultima_vez: string | null }
type Source = { id: string; nombre: string }
type GenCliente = {
  id: string; nombre: string; gasto_mes_actual: number; gasto_mes_anterior: number
  llamadas_mes: number; conversaciones_mes: number; costo_por_conversacion: number
  oportunidades_abiertas: number; serie_mensual: MesTrend[]
}
type GeneralData = {
  mes_actual: string; mes_anterior: string
  clientes: GenCliente[]
  totales: { gasto_mes_actual: number; gasto_mes_anterior: number; conversaciones_mes: number; oportunidades_abiertas: number; n_clientes: number }
}
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
const hhmm = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''
// Fecha + hora absolutas, ej "28/06 14:35" — datar la oportunidad en el momento del uso.
const fechaHora = (iso?: string | null) => iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

export default function Tokens() {
  const [sources, setSources] = useState<Source[]>([])
  const [source, setSource] = useState(GENERAL)
  const [savedDefault, setSavedDefault] = useState(GENERAL)
  const [general, setGeneral] = useState<GeneralData | null>(null)
  const [data, setData] = useState<Audit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recomputando, setRecomputando] = useState(false)
  const [hoverMes, setHoverMes] = useState<number | null>(null)
  const [diaSel, setDiaSel] = useState<string | null>(null)   // fecha del día abierto (null = último)
  const [diaData, setDiaData] = useState<DiaDetalle | null>(null)
  const [diaLoading, setDiaLoading] = useState(false)
  const [convAbierta, setConvAbierta] = useState<string | null>(null)
  const [convMsgs, setConvMsgs] = useState<Record<string, MirrorMensaje[]>>({})
  const [convMsgsLoading, setConvMsgsLoading] = useState<string | null>(null)

  const abrirConv = useCallback(async (c: Conv) => {
    if (convAbierta === c.telefono) { setConvAbierta(null); return }
    setConvAbierta(c.telefono)
    if (c.mirror_id && !convMsgs[c.telefono]) {
      setConvMsgsLoading(c.telefono)
      try {
        const m = await api.get<MirrorMensaje[]>(`/admin/etiguel/mirror/${c.mirror_id}/mensajes`)
        setConvMsgs((prev) => ({ ...prev, [c.telefono]: m }))
      } catch { /* sin mensajes */ }
      finally { setConvMsgsLoading(null) }
    }
  }, [convAbierta, convMsgs])

  const [apiUsage, setApiUsage] = useState<AnthUsage | null>(null)
  // Sources + default guardado por el usuario (tilde). Default de fábrica: General.
  useEffect(() => {
    (async () => {
      try {
        const [srcs, prefs] = await Promise.all([
          api.get<Source[]>('/admin/tokens/sources'),
          api.get<{ prefs: { default_source?: string } }>(`/me/preferences?pantalla=${PANTALLA}`),
        ])
        setSources(srcs)
        const def = prefs.prefs?.default_source
        if (def && (def === GENERAL || srcs.some((s) => s.id === def))) { setSavedDefault(def); setSource(def) }
      } catch { /* usa el fallback General */ }
    })()
  }, [])
  // Costos internos: en General todos; con un cliente seleccionado, solo los suyos.
  useEffect(() => {
    const q = source === GENERAL ? '' : `&source=${encodeURIComponent(source)}`
    api.get<AnthUsage>(`/admin/tokens/anthropic?meses=12${q}`).then(setApiUsage).catch(() => {})
  }, [source])
  useEffect(() => { api.get<GeneralData>('/admin/tokens/general').then(setGeneral).catch(() => {}) }, [])
  const cargar = useCallback(async () => {
    if (source === GENERAL) {
      try { setGeneral(await api.get<GeneralData>('/admin/tokens/general')); setError(null) }
      catch (e) { setError(e instanceof Error ? e.message : 'Error al cargar') }
      return
    }
    try { setData(await api.get<Audit>(`/admin/tokens/audit?source=${source}&days=14`)); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'Error al cargar') }
  }, [source])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { setDiaSel(null); setDiaData(null); setConvAbierta(null) }, [source])

  const setDefault = async (checked: boolean) => {
    const nuevo = checked ? source : GENERAL
    setSavedDefault(nuevo)
    try { await api.put('/me/preferences', { pantalla: PANTALLA, prefs: { default_source: nuevo } }) } catch { /* noop */ }
  }
  const selectorOpts: SourceOpt[] = [
    { source: GENERAL, nombre: 'General (todos)' },
    ...sources.map((s) => ({ source: s.id, nombre: s.nombre })),
  ]

  // Al abrir un día distinto del último, traer su detalle completo
  useEffect(() => {
    if (!diaSel || diaSel === data?.ultimo?.fecha) { setDiaData(null); return }
    let vivo = true
    setDiaLoading(true)
    api.get<DiaDetalle>(`/admin/tokens/dia?source=${source}&fecha=${diaSel}`)
      .then((d) => { if (vivo) setDiaData(d) })
      .catch(() => { if (vivo) setDiaData(null) })
      .finally(() => { if (vivo) setDiaLoading(false) })
    return () => { vivo = false }
  }, [diaSel, source, data?.ultimo?.fecha])

  async function recomputar() {
    setRecomputando(true)
    try { await api.post(`/admin/tokens/recompute?source=${source}`); await cargar() }
    catch (e) { setError(e instanceof Error ? e.message : 'Error') } finally { setRecomputando(false) }
  }

  const u = data?.ultimo
  const dias = data?.tendencia ?? []
  const meses = data?.serie_mensual ?? []
  // Día mostrado: el último por defecto; o el que el usuario clickeó en el gráfico.
  const verUltimo = !diaSel || diaSel === u?.fecha
  const det: DiaDetalle | null = verUltimo ? (u ?? null) : diaData
  const t = det?.totales
  const convsAll = (det?.conversaciones ?? det?.top_conversaciones ?? [])
  const convs = convsAll.filter((c) => !c.es_sistema)
  const sistema = convsAll.find((c) => c.es_sistema)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">Monitoreo · Tokens</h1>
        <div className="flex items-center gap-3">
          <ClienteSelector
            sources={selectorOpts}
            value={source}
            onChange={setSource}
            isDefault={source === savedDefault}
            onSetDefault={setDefault}
          />
          {source !== GENERAL && (
            <button onClick={recomputar} disabled={recomputando}
              className="flex items-center gap-1.5 bg-primary text-on-primary rounded-lg px-3 py-2 text-sm font-medium hover:bg-primary-dark disabled:opacity-50">
              <RefreshCw size={14} className={recomputando ? 'animate-spin' : ''} />{recomputando ? 'Recalculando…' : 'Recalcular hoy'}
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <p className="text-xs text-muted -mt-2">Costo real estimado a tarifa MyClaw (10% off el precio oficial). Tocá un día del gráfico para ver sus conversaciones.</p>

      {source === GENERAL ? (
      <DashboardGrid pantalla="tokens-general" defaultLayout={GENERAL_LAYOUT}>
        {/* KPIs agregados de todos los clientes */}
        <div key="gKpis">
          <Widget id="gKpis" title={`Resumen de todos los clientes · ${general?.mes_actual ?? ''}`} fuente="openclaw">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { l: 'Gasto del mes', v: usd(general?.totales.gasto_mes_actual ?? 0), sub: `mes ant.: ${usd(general?.totales.gasto_mes_anterior ?? 0)}` },
                { l: 'Conversaciones', v: fmt(general?.totales.conversaciones_mes ?? 0), sub: '' },
                { l: 'Oportunidades', v: fmt(general?.totales.oportunidades_abiertas ?? 0), sub: 'abiertas', alert: (general?.totales.oportunidades_abiertas ?? 0) > 0 },
                { l: 'Clientes', v: fmt(general?.totales.n_clientes ?? 0), sub: '' },
              ].map((k) => (
                <div key={k.l} className="bg-app border border-line rounded-xl p-3">
                  <div className={`text-2xl font-semibold ${k.alert ? 'text-red-500' : 'text-ink'}`}>{k.v}</div>
                  <div className="text-xs text-muted mt-1">{k.l}{k.sub ? <span className="text-muted/70"> · {k.sub}</span> : null}</div>
                </div>
              ))}
            </div>
          </Widget>
        </div>

        {/* Gasto por cliente (mes) */}
        <div key="gGastoCliente">
          <Widget id="gGastoCliente" title="Gasto por cliente · este mes" fuente="openclaw">
            <HBars items={(general?.clientes ?? []).map((c) => ({ label: c.nombre, value: c.gasto_mes_actual, delta: c.gasto_mes_actual - c.gasto_mes_anterior }))} fmt={usd} />
          </Widget>
        </div>

        {/* $/conversación por cliente */}
        <div key="gCostoConv">
          <Widget id="gCostoConv" title="Costo por conversación · este mes" fuente="openclaw" right={<span className="text-[11px] text-muted">eficiencia</span>}>
            <HBars items={(general?.clientes ?? []).map((c) => ({ label: c.nombre, value: c.costo_por_conversacion }))} fmt={usd3} />
          </Widget>
        </div>

        {/* Tendencia mensual por cliente */}
        <div key="gTendencia">
          <Widget id="gTendencia" title="Tendencia mensual por cliente" fuente="openclaw" right={<span className="text-[11px] text-muted">costo / mes</span>}>
            <MultiLineaClientes clientes={general?.clientes ?? []} />
          </Widget>
        </div>

        {/* Tabla comparativa */}
        <div key="gTabla">
          <Widget id="gTabla" title="Comparativa de clientes" fuente="openclaw">
            <TablaComparativa clientes={general?.clientes ?? []} />
          </Widget>
        </div>

        {/* Costos internos (API Anthropic) — globales */}
        <div key="cMes">
          <Widget id="cMes" title="Resumen del mes — funciones internas" fuente="anthropic">
            {apiUsage ? <CostosResumenMes data={apiUsage} /> : <p className="text-sm text-muted">Cargando…</p>}
          </Widget>
        </div>
        <div key="cFuncion">
          <Widget id="cFuncion" title="Costo por función (mes actual)" fuente="anthropic">
            {apiUsage ? <CostosPorFuncion data={apiUsage} /> : <p className="text-sm text-muted">Cargando…</p>}
          </Widget>
        </div>
        <div key="cParticipacion">
          <Widget id="cParticipacion" title="Participación por función (mes)" fuente="anthropic">
            {apiUsage ? <CostosParticipacion data={apiUsage} /> : <p className="text-sm text-muted">Cargando…</p>}
          </Widget>
        </div>
        <div key="cHistorico">
          <Widget id="cHistorico" title="Histórico mensual — funciones internas" fuente="anthropic" right={<span className="text-[11px] text-muted">apilado por función</span>}>
            {apiUsage ? <CostosHistorico data={apiUsage} /> : <p className="text-sm text-muted">Cargando…</p>}
          </Widget>
        </div>
      </DashboardGrid>
      ) : (
      <DashboardGrid pantalla="tokens-cliente" defaultLayout={CLIENTE_LAYOUT}>
        {/* Oportunidades */}
        <div key="oportunidades">
          <Widget id="oportunidades" title="Oportunidades de ahorro de Camila" fuente="openclaw" right={<span className="text-[11px] text-muted">fijas hasta resolver</span>}>
            {(data?.oportunidades ?? []).length === 0 ? (
              <p className="text-sm text-emerald-500">Sin oportunidades abiertas. 👌</p>
            ) : (
              <div className="space-y-2">
                {data!.oportunidades.map((o) => {
                  const sev = SEV[o.severidad] ?? SEV.baja
                  return (
                    <div key={o.id} className="border border-line rounded-xl p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded border" style={{ color: sev.color, borderColor: sev.color + '66', backgroundColor: sev.color + '18' }}>{sev.label}</span>
                        {o.tipo === 'ia' && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-primary/50 text-primary bg-primary/10" title="Detectada por el analista de costos (IA), no por reglas fijas">IA</span>
                        )}
                        <span className="text-sm font-medium text-ink">{o.titulo}</span>
                        <span className="text-[11px] text-muted ml-auto" title={o.ultima_vez && o.ultima_vez !== o.primera_vez ? `Última señal: ${fechaHora(o.ultima_vez)}` : undefined}>detectada {fechaHora(o.primera_vez)} ({haceDias(o.primera_vez)})</span>
                      </div>
                      <p className="text-xs text-muted mt-1.5">{o.detalle}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </Widget>
        </div>

        {/* KPIs del día */}
        <div key="kpis">
          <Widget
            id="kpis"
            fuente="openclaw"
            title={`Resumen del día ${det?.fecha ?? diaSel ?? ''}${verUltimo ? ' (último)' : ''}`}
            right={
              <span className="flex items-center gap-2">
                {diaLoading && <RefreshCw size={12} className="animate-spin text-muted" />}
                {!verUltimo && <button onClick={() => setDiaSel(null)} className="text-xs text-primary hover:underline">← último</button>}
              </span>
            }
          >
            <div className="grid-auto-cards">
              {[
                { l: 'Costo del día', v: usd(t?.costo_usd ?? 0), alert: false },
                { l: 'Conversaciones', v: fmt(det?.n_conversaciones ?? 0), alert: false },
                { l: 'Errores', v: fmt(t?.errores ?? 0), alert: (t?.errores ?? 0) > 0 },
                { l: 'Timeouts', v: fmt(t?.timeouts ?? 0), alert: (t?.timeouts ?? 0) > 0 },
              ].map((k) => (
                <div key={k.l} className="cq bg-app border border-line rounded-xl p-3">
                  <div className={`fluid-num font-semibold ${k.alert ? 'text-red-500' : 'text-ink'}`}>{k.v}</div>
                  <div className="text-xs text-muted mt-1 truncate">{k.l}</div>
                </div>
              ))}
            </div>
          </Widget>
        </div>

        {/* Costo por día */}
        <div key="costoDia">
          <Widget id="costoDia" title="Costo de Camila por día · tocá un día" fuente="openclaw"
            right={
              <span className="flex items-center gap-3 text-[11px] text-muted">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#F5B23D' }} />mensajes</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#ef4444' }} />errores</span>
              </span>
            }>
            {dias.length === 0 ? <p className="text-sm text-muted">Sin datos.</p> : <BarrasDia dias={dias} sel={det?.fecha} onSelect={(f) => { setDiaSel(f); setConvAbierta(null) }} />}
          </Widget>
        </div>

        {/* Histórico mensual */}
        <div key="historico">
          <Widget id="historico" title="Histórico mensual de Camila" fuente="openclaw" right={<span className="text-[11px] text-muted">pasá el mouse</span>}>
            {meses.length === 0 ? <p className="text-sm text-muted">Sin histórico todavía.</p> : <LineaMensual meses={meses} hover={hoverMes} setHover={setHoverMes} />}
          </Widget>
        </div>

        {/* Conversaciones del día */}
        <div key="convs">
          <Widget id="convs" title={`Conversaciones de Camila del día · ${convs.length}`} fuente="openclaw">
            {convs.length === 0 ? <p className="text-sm text-muted">{diaLoading ? 'Cargando…' : 'Sin conversaciones.'}</p> : (
              <div className="space-y-2">
                {convs.map((c) => {
                  const abierta = convAbierta === c.telefono
                  return (
                    <div key={c.telefono} className="border border-line rounded-xl overflow-hidden">
                      <button onClick={() => abrirConv(c)} className="w-full text-left p-3 hover:bg-app/50 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold text-ink flex items-center gap-1.5"><Phone size={13} className="text-muted" />{c.telefono}</span>
                          <span className="text-sm font-semibold text-amber-400">{usd3(c.costo_usd)}</span>
                        </div>
                        {c.nombre && <p className="text-xs text-ink-soft mt-0.5 truncate">{c.nombre}</p>}
                        <div className="text-xs text-muted mt-0.5">
                          {Object.keys(c.por_modelo ?? {}).length > 0 && <span>{Object.keys(c.por_modelo!).map((m) => m.replace('claude-', '')).join(', ')}</span>}
                          {c.timeouts > 0 && <span className="text-red-400"> · {c.timeouts} timeout</span>}
                          {c.errores > 0 && <span className="text-red-400"> · {c.errores} error</span>}
                        </div>
                        {!abierta && c.ejemplo && <p className="text-xs text-muted mt-1 truncate">“{c.ejemplo}”</p>}
                      </button>
                      {abierta && (
                        <div className="px-3 pb-3 pt-2 border-t border-line/60 bg-app/30 space-y-2">
                          {convMsgsLoading === c.telefono ? <p className="text-xs text-muted">Cargando conversación…</p> :
                            convMsgs[c.telefono]?.length ? (
                              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                                {convMsgs[c.telefono].map((m) => (
                                  <div key={m.id} className={`flex ${m.direccion === 'out' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs whitespace-pre-wrap ${m.direccion === 'out' ? 'bg-amber-500/15 border border-amber-500/30 text-ink' : 'bg-card text-ink-soft border border-line'}`}>{m.texto}</div>
                                  </div>
                                ))}
                              </div>
                            ) : c.mirror_id ? <p className="text-xs text-muted">Sin mensajes espejados.</p> : <p className="text-xs text-muted">Conversación no encontrada en el espejo.</p>}
                          <div className="border-t border-line/40 pt-2 space-y-1">
                            <div className="space-y-1">
                              {Object.entries(c.por_modelo ?? {}).sort((a, b) => b[1].costo_usd - a[1].costo_usd).map(([m, v]) => (
                                <div key={m} className="flex items-center justify-between text-xs">
                                  <span className="text-ink-soft">{m}</span>
                                  <span className="text-muted">{usd3(v.costo_usd)}</span>
                                </div>
                              ))}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                              {(c.compactaciones ?? 0) > 0 && <span>Compactaciones: <span className="text-amber-400">{c.compactaciones}</span></span>}
                              {c.primer_ts && <span>Horario: <span className="text-ink-soft">{hhmm(c.primer_ts)}–{hhmm(c.ultimo_ts)}</span></span>}
                            </div>
                            {c.ejemplo && <p className="text-xs text-muted italic">“{c.ejemplo}”</p>}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                {sistema && <p className="text-xs text-muted pt-1">+ sistema (crons/mantenimiento): {usd3(sistema.costo_usd)}</p>}
              </div>
            )}
          </Widget>
        </div>

        {/* Por modelo · mes */}
        <div key="porModelo">
          <Widget id="porModelo" title={`Costo de Camila por modelo · mes ${data?.mes_actual ?? ''}`} fuente="openclaw">
            {!data || Object.keys(data.por_modelo_mes).length === 0 ? <p className="text-sm text-muted">Sin datos del mes.</p> : (
              <div className="space-y-1.5">
                {Object.entries(data.por_modelo_mes).sort((a, b) => b[1].costo_usd - a[1].costo_usd).map(([m, v]) => (
                  <div key={m} className="flex items-center justify-between text-sm">
                    <span className="text-ink-soft">{m}</span>
                    <span className="text-muted">{usd(v.costo_usd)}</span>
                  </div>
                ))}
              </div>
            )}
          </Widget>
        </div>

        {/* Costos internos (API Anthropic) — SOLO de este cliente */}
        <div key="cMes">
          <Widget id="cMes" title="Costos internos del cliente — mes" fuente="anthropic">
            {apiUsage ? <CostosResumenMes data={apiUsage} /> : <p className="text-sm text-muted">Cargando…</p>}
          </Widget>
        </div>
        <div key="cFuncion">
          <Widget id="cFuncion" title="Costo interno por función (mes)" fuente="anthropic">
            {apiUsage ? <CostosPorFuncion data={apiUsage} /> : <p className="text-sm text-muted">Cargando…</p>}
          </Widget>
        </div>
        <div key="cParticipacion">
          <Widget id="cParticipacion" title="Participación por función (mes)" fuente="anthropic">
            {apiUsage ? <CostosParticipacion data={apiUsage} /> : <p className="text-sm text-muted">Cargando…</p>}
          </Widget>
        </div>
        <div key="cHistorico">
          <Widget id="cHistorico" title="Histórico interno mensual" fuente="anthropic" right={<span className="text-[11px] text-muted">apilado por función</span>}>
            {apiUsage ? <CostosHistorico data={apiUsage} /> : <p className="text-sm text-muted">Cargando…</p>}
          </Widget>
        </div>
      </DashboardGrid>
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

function BarrasDia({ dias, sel, onSelect }: { dias: DiaTrend[]; sel?: string; onSelect?: (f: string) => void }) {
  const [hi, setHi] = useState<number | null>(null)
  const W = 900, H = 300, padL = 56, padR = 14, padT = 28, padB = 50
  const top = niceMax(Math.max(0.001, ...dias.map((d) => d.costo_usd)))
  const n = dias.length
  const slot = (W - padL - padR) / n
  const bw = Math.min(36, slot * 0.6)
  const xc = (i: number) => padL + slot * i + slot / 2
  const y = (c: number) => (H - padB) - (c / top) * (H - padT - padB)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top)
  const h = hi != null ? dias[hi] : null
  return (
    <div className="relative flex-1 min-h-0 w-full">
      {h && (
        <div className="absolute top-0 right-2 bg-app border border-line rounded-lg px-3 py-2 text-xs z-10 shadow whitespace-nowrap">
          <div className="font-semibold text-ink mb-0.5">{h.fecha}</div>
          <div className="text-muted">Total: <span className="text-ink font-medium">{usd3(h.costo_usd)}</span></div>
          <div className="text-muted">Mensajes: <span className="font-medium" style={{ color: '#F5B23D' }}>{usd3(h.costo_mensajes)}</span></div>
          <div className="text-muted">Errores: <span className="font-medium" style={{ color: '#ef4444' }}>{usd3(h.costo_errores)}</span></div>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full" style={{ minHeight: 160 }}>
        {ticks.map((tk, i) => (
          <g key={i}>
            <line x1={padL} y1={y(tk)} x2={W - padR} y2={y(tk)} stroke="#243454" strokeWidth={1} />
            <text x={padL - 8} y={y(tk) + 3} textAnchor="end" fontSize={10} fill="#5C6E90" fontFamily="JetBrains Mono">{usd(tk)}</text>
          </g>
        ))}
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#243454" strokeWidth={1} />
        {dias.map((d, i) => {
          const hMsg = (H - padB) - y(d.costo_mensajes)
          const hErr = (H - padB) - y(d.costo_errores)
          const yTop = y(d.costo_usd)
          const isSel = sel === d.fecha
          const op = isSel ? 1 : (hi == null || hi === i ? 1 : 0.4)
          return (
            <g key={d.fecha} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} onClick={() => onSelect?.(d.fecha)} style={{ cursor: 'pointer', opacity: op }}>
              {/* resaltado del día abierto */}
              {isSel && <rect x={xc(i) - slot / 2 + 2} y={padT} width={slot - 4} height={H - padT - padB} fill="#F5B23D" fillOpacity={0.08} rx={4} />}
              {/* mensajes (ámbar, abajo) */}
              {d.costo_mensajes > 0 && <rect x={xc(i) - bw / 2} y={(H - padB) - hMsg} width={bw} height={hMsg} fill="#F5B23D" rx={2} />}
              {/* errores (rojo, arriba) */}
              {d.costo_errores > 0 && <rect x={xc(i) - bw / 2} y={yTop} width={bw} height={hErr} fill="#ef4444" rx={2} />}
              {isSel && <rect x={xc(i) - bw / 2 - 1.5} y={yTop - 1.5} width={bw + 3} height={(H - padB) - yTop + 1.5} fill="none" stroke="#F5B23D" strokeWidth={1.5} rx={3} />}
              {/* total arriba */}
              {d.costo_usd > 0 && <text x={xc(i)} y={yTop - 6} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#EEF3FB" fontFamily="JetBrains Mono">{usd(d.costo_usd)}</text>}
              {/* fecha rotada */}
              <text x={xc(i)} y={H - padB + 14} textAnchor="end" fontSize={10} fill="#8294B4" transform={`rotate(-40 ${xc(i)} ${H - padB + 14})`}>{d.fecha.slice(5)}</text>
              <rect x={xc(i) - slot / 2} y={padT} width={slot} height={H - padT - padB} fill="transparent" />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function LineaMensual({ meses, hover, setHover }: { meses: MesTrend[]; hover: number | null; setHover: (i: number | null) => void }) {
  const W = 900, H = 260
  const padL = 56, padR = 16, padT = 28, padB = 30
  const top = niceMax(Math.max(0.001, ...meses.map((m) => m.costo_usd)))
  const x = (i: number) => meses.length <= 1 ? (padL + W - padR) / 2 : padL + (i * (W - padL - padR)) / (meses.length - 1)
  const y = (c: number) => (H - padB) - (c / top) * (H - padT - padB)
  const pts = meses.map((m, i) => [x(i), y(m.costo_usd)] as const)
  const linePts = pts.map((p) => p.join(',')).join(' ')
  const areaPts = `${padL},${H - padB} ${linePts} ${x(meses.length - 1)},${H - padB}`
  const h = hover != null ? meses[hover] : null
  const ticks = [0, 0.5, 1].map((f) => f * top)
  return (
    <div className="relative flex-1 min-h-0 w-full">
      {h && (
        <div className="absolute top-0 right-1 bg-app border border-line rounded-lg px-3 py-2 text-xs z-10 shadow whitespace-nowrap">
          <div className="font-semibold text-ink mb-0.5">{h.mes}</div>
          <div className="text-muted">Total: <span className="text-ink font-medium">{usd(h.costo_usd)}</span></div>
          <div className="text-muted">Conversaciones: <span className="text-ink font-medium">{fmt(h.conversaciones)}</span></div>
          <div className="text-muted">Prom. $/conv.: <span className="text-ink font-medium">{usd3(h.costo_por_conversacion)}</span></div>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full" style={{ minHeight: 160 }}>
        <defs>
          <linearGradient id="areaTok" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F5B23D" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#F5B23D" stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((tk, i) => (
          <g key={i}>
            <line x1={padL} y1={y(tk)} x2={W - padR} y2={y(tk)} stroke="#243454" strokeWidth={1} />
            <text x={padL - 8} y={y(tk) + 3} textAnchor="end" fontSize={9.5} fill="#5C6E90" fontFamily="JetBrains Mono">{usd(tk)}</text>
          </g>
        ))}
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#243454" strokeWidth={1} />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#243454" strokeWidth={1} />
        {meses.length > 1 && <polygon points={areaPts} fill="url(#areaTok)" />}
        <polyline points={linePts} fill="none" stroke="#F5B23D" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {meses.map((m, i) => (
          <g key={m.mes} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
            <text x={x(i)} y={y(m.costo_usd) - 10} textAnchor="middle" fontSize={11} fontWeight={700} fill="#EEF3FB" fontFamily="JetBrains Mono">{usd(m.costo_usd)}</text>
            <circle cx={x(i)} cy={y(m.costo_usd)} r={hover === i ? 5.5 : 3.5} fill="#F5B23D" stroke="#13213C" strokeWidth={hover === i ? 2 : 0} />
            <rect x={x(i) - 20} y={padT} width={40} height={H - padT - padB} fill="transparent" />
            <text x={x(i)} y={H - 9} textAnchor="middle" fontSize={9.5} fill="#8294B4">{m.mes}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

const PALETA = ['#F5B23D', '#38bdf8', '#a78bfa', '#34d399', '#fb7185', '#fbbf24', '#22d3ee', '#f472b6']

function HBars({ items, fmt }: { items: { label: string; value: number; delta?: number }[]; fmt: (n: number) => string }) {
  if (!items.length) return <p className="text-sm text-muted">Sin datos.</p>
  const max = Math.max(0.0001, ...items.map((i) => i.value))
  return (
    <div className="space-y-2.5">
      {items.map((it) => (
        <div key={it.label}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-ink-soft truncate">{it.label}</span>
            <span className="text-muted">
              {fmt(it.value)}
              {it.delta != null && it.delta !== 0 && (
                <span className={it.delta > 0 ? 'text-red-400' : 'text-emerald-400'}> {it.delta > 0 ? '▲' : '▼'}{fmt(Math.abs(it.delta))}</span>
              )}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-app overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(it.value / max) * 100}%`, background: '#F5B23D' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function MultiLineaClientes({ clientes }: { clientes: GenCliente[] }) {
  const conSerie = clientes.filter((c) => c.serie_mensual.length)
  if (!conSerie.length) return <p className="text-sm text-muted">Sin histórico todavía.</p>
  const mesesSet = Array.from(new Set(conSerie.flatMap((c) => c.serie_mensual.map((m) => m.mes)))).sort()
  const W = 900, H = 260, padL = 56, padR = 16, padT = 20, padB = 30
  const top = niceMax(Math.max(0.001, ...conSerie.flatMap((c) => c.serie_mensual.map((m) => m.costo_usd))))
  const x = (i: number) => mesesSet.length <= 1 ? (padL + W - padR) / 2 : padL + (i * (W - padL - padR)) / (mesesSet.length - 1)
  const y = (c: number) => (H - padB) - (c / top) * (H - padT - padB)
  const ticks = [0, 0.5, 1].map((f) => f * top)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 300 }}>
        {ticks.map((tk, i) => (
          <g key={i}>
            <line x1={padL} y1={y(tk)} x2={W - padR} y2={y(tk)} stroke="#243454" strokeWidth={1} />
            <text x={padL - 8} y={y(tk) + 3} textAnchor="end" fontSize={9.5} fill="#5C6E90" fontFamily="JetBrains Mono">{usd(tk)}</text>
          </g>
        ))}
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#243454" strokeWidth={1} />
        {mesesSet.map((m, i) => (
          <text key={m} x={x(i)} y={H - 9} textAnchor="middle" fontSize={9.5} fill="#8294B4">{m}</text>
        ))}
        {conSerie.map((c, ci) => {
          const pts = c.serie_mensual.map((m) => [x(mesesSet.indexOf(m.mes)), y(m.costo_usd)] as const)
          return <polyline key={c.id} points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={PALETA[ci % PALETA.length]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        })}
      </svg>
      <div className="flex flex-wrap gap-3 mt-2">
        {conSerie.map((c, ci) => (
          <span key={c.id} className="flex items-center gap-1.5 text-xs text-muted">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: PALETA[ci % PALETA.length] }} />{c.nombre}
          </span>
        ))}
      </div>
    </div>
  )
}

function TablaComparativa({ clientes }: { clientes: GenCliente[] }) {
  if (!clientes.length) return <p className="text-sm text-muted">Sin datos.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted text-xs border-b border-line">
            <th className="text-left font-medium py-2 pr-3">Cliente</th>
            <th className="text-right font-medium py-2 px-3">Gasto mes</th>
            <th className="text-right font-medium py-2 px-3">Conv.</th>
            <th className="text-right font-medium py-2 px-3">$/conv</th>
            <th className="text-right font-medium py-2 px-3">Δ mes ant.</th>
            <th className="text-right font-medium py-2 pl-3">Oport.</th>
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => {
            const delta = c.gasto_mes_actual - c.gasto_mes_anterior
            return (
              <tr key={c.id} className="border-b border-line/50">
                <td className="py-2 pr-3 text-ink font-medium">{c.nombre}</td>
                <td className="py-2 px-3 text-right text-ink-soft">{usd(c.gasto_mes_actual)}</td>
                <td className="py-2 px-3 text-right text-muted">{fmt(c.conversaciones_mes)}</td>
                <td className="py-2 px-3 text-right text-muted">{usd3(c.costo_por_conversacion)}</td>
                <td className={`py-2 px-3 text-right ${delta > 0 ? 'text-red-400' : delta < 0 ? 'text-emerald-400' : 'text-muted'}`}>{delta === 0 ? '—' : (delta > 0 ? '+' : '') + usd(delta)}</td>
                <td className={`py-2 pl-3 text-right ${c.oportunidades_abiertas > 0 ? 'text-amber-400' : 'text-muted'}`}>{c.oportunidades_abiertas}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
