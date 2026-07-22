import { AlertTriangle, CheckCircle2, FlaskConical, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { ClienteSelector, type SourceOpt } from '../components/ClienteSelector'
import { DashboardGrid, Widget, buildLayouts } from '../components/DashboardGrid'

const PANTALLA = 'precios'
const GENERAL = '__general__'

// Nombres de los servicios "token" que se muestran calculados arriba de la lista
// (el backend los manda igual dentro de `variables`; acá se saltean).
const SERVICIOS_TOKENS = ['Tokens del bot (motor LLM)', 'Tokens internos Anthropic']

// Vista de UN cliente
const CLIENTE_LAYOUT = buildLayouts([
  { i: 'parametros', x: 0, y: 0, w: 7, h: 10 },
  { i: 'margen', x: 7, y: 0, w: 5, h: 10 },
  { i: 'costos', x: 0, y: 10, w: 7, h: 12 },
  { i: 'faltantes', x: 7, y: 10, w: 5, h: 6 },
  { i: 'motores', x: 7, y: 16, w: 5, h: 9 },
  { i: 'estructura', x: 0, y: 22, w: 7, h: 8 },
])

// Vista General (comparativa)
const GENERAL_LAYOUT = buildLayouts([
  { i: 'gTabla', x: 0, y: 0, w: 12, h: 8 },
  { i: 'estructura', x: 0, y: 8, w: 12, h: 8 },
])

type Pricing = {
  source: string; abono_mensual_usd: number | null; conversaciones_dia: number | null
  costo_conv_usd: number | null; costo_conv_origen: string | null
  motor_primario: string | null; motor_fallback: string | null
  notas: string; updated_at: string | null
}
type Medido = { valor: number; mes: string; conversaciones: number; costo_mes: number }
type Motor = {
  id: number; nombre: string; provider: string; model_id: string; es_actual: boolean
  precio_in: number | null; precio_out: number | null
  precio_cache_read: number | null; precio_cache_write: number | null
}
type Servicio = {
  id: number; nombre: string; tipo: string; source: string | null
  costo_mensual_usd: number | null; detalle: string; es_plantilla: boolean
}
type Costos = {
  tokens_bot_mes: number; anthropic_mes: number | null
  variables: Servicio[]; fijos_cliente: Servicio[]
  fijos_cliente_total: number; total: number
}
type Margen = { abono: number; costo_total: number; ganancia: number; pct: number | null }
type Estructura = { servicios: Servicio[]; total: number; n_clientes: number; prorrateo_por_cliente: number }
type Resumen = {
  source: string; pricing: Pricing; medido: Medido | null; motores_registrados: Motor[]
  costos: Costos; margen: Margen | null; estructura: Estructura
  datos_faltantes: string[]; desvio_alerta_pct: number
}
type GenCliente = { source: string; nombre: string; abono: number | null; costo_total: number; margen: Margen | null; faltantes: number }
type GeneralData = { clientes: GenCliente[]; estructura: Estructura | null }
type Source = { id: string; nombre: string }

const usd = (n: number | null | undefined) => '$' + (n ?? 0).toFixed(2)
const usd4 = (n: number | null | undefined) => '$' + (n ?? 0).toFixed(4)
// Precio por 1M de tokens a partir del precio por token del motor.
const porM = (n: number | null | undefined) => n == null ? '—' : '$' + (n * 1e6).toFixed(2) + '/M'

// Chip del ORIGEN del $/conversación cotizado.
const ORIGEN: Record<string, { label: string; cls: string; title: string }> = {
  medido: { label: 'medido', cls: 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10', title: 'Sale del costo real del monitor de Tokens' },
  simulado: { label: 'simulado', cls: 'border-sky-500/50 text-sky-400 bg-sky-500/10', title: 'Sale de una simulación del Test LLM' },
  manual: { label: 'manual', cls: 'border-slate-500/50 text-slate-400 bg-slate-500/10', title: 'Cargado a mano' },
  estimado_etiguel: { label: 'estimación Etiguel', cls: 'border-amber/50 text-amber bg-amber/10', title: 'Todavía no hay medición propia de este cliente' },
}

export default function Precios() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const urlSource = params.get('source')

  const [sources, setSources] = useState<Source[]>([])
  const [source, setSource] = useState(urlSource || 'etiguel')
  const [savedDefault, setSavedDefault] = useState('etiguel')
  const [data, setData] = useState<Resumen | null>(null)
  const [general, setGeneral] = useState<GeneralData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [simulando, setSimulando] = useState(false)

  // Form de parámetros comerciales (se sincroniza al cargar/guardar).
  const [form, setForm] = useState({ abono: '', conv: '', costo: '', motorP: '', motorF: '' })

  useEffect(() => {
    (async () => {
      try {
        const [srcs, prefs] = await Promise.all([
          api.get<Source[]>('/admin/tokens/sources'),
          api.get<{ prefs: { default_source?: string } }>(`/me/preferences?pantalla=${PANTALLA}`),
        ])
        setSources(srcs)
        const def = prefs.prefs?.default_source
        if (def && (def === GENERAL || srcs.some((s) => s.id === def))) {
          setSavedDefault(def)
          if (!urlSource) setSource(def)   // ?source= manda (deep-link / tests)
        }
      } catch { /* usa el default etiguel */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cargar = useCallback(async () => {
    try {
      if (source === GENERAL) setGeneral(await api.get<GeneralData>('/admin/precios/general'))
      else setData(await api.get<Resumen>(`/admin/precios/resumen?source=${encodeURIComponent(source)}`))
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al cargar') }
  }, [source])
  useEffect(() => { cargar() }, [cargar])

  // Sincronizar el form cada vez que llega un resumen fresco.
  useEffect(() => {
    const p = data?.pricing
    if (!p || p.source !== source) return
    setForm({
      abono: p.abono_mensual_usd == null ? '' : String(p.abono_mensual_usd),
      conv: p.conversaciones_dia == null ? '' : String(p.conversaciones_dia),
      costo: p.costo_conv_usd == null ? '' : String(p.costo_conv_usd),
      motorP: p.motor_primario ?? '',
      motorF: p.motor_fallback ?? '',
    })
  }, [data, source])

  const setDefault = async (checked: boolean) => {
    const nuevo = checked ? source : 'etiguel'
    setSavedDefault(nuevo)
    try { await api.put('/me/preferences', { pantalla: PANTALLA, prefs: { default_source: nuevo } }) } catch { /* noop */ }
  }

  const selectorOpts: SourceOpt[] = [
    { source: GENERAL, nombre: 'General (todos)' },
    ...sources.map((s) => ({ source: s.id, nombre: s.nombre })),
  ]
  // Si llegó por ?source= un cliente que no está en la lista (ej. qa-test), sumarlo.
  if (source !== GENERAL && !selectorOpts.some((o) => o.source === source)) {
    selectorOpts.push({ source, nombre: source })
  }

  function parseNum(s: string): number | null {
    const t = s.trim().replace(',', '.')
    if (!t) return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  // Guardar UN campo del pricing (al salir del input). Refresca el resumen entero
  // para que costos/margen/faltantes se recalculen.
  async function guardarParam(campo: string, texto: string, actual: number | string | null) {
    const esTexto = campo === 'motor_primario' || campo === 'motor_fallback'
    const v = esTexto ? texto.trim() : parseNum(texto)
    if (v === null || v === '') return                    // sin dato → no pisar (el PUT ignora null)
    if (v === actual) return
    try { await api.put(`/admin/precios/cliente/${encodeURIComponent(source)}`, { [campo]: v }); await cargar() }
    catch (e) { setError(e instanceof Error ? e.message : 'Error al guardar') }
  }

  // Costo de un servicio del CLIENTE (variables / fijos_cliente) → override per-cliente.
  async function guardarCostoCliente(s: Servicio, valor: number | null) {
    try {
      await api.post(`/admin/precios/cliente/${encodeURIComponent(source)}/servicio`, {
        nombre: s.nombre, costo_mensual_usd: valor, tipo: s.tipo, detalle: s.detalle,
      })
      await cargar()
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al guardar') }
  }

  // Costo de un servicio de ESTRUCTURA (plantilla compartida) → PUT /servicios/{id}.
  async function guardarCostoEstructura(s: Servicio, valor: number | null) {
    try {
      await api.put(`/admin/precios/servicios/${s.id}`, {
        nombre: s.nombre, tipo: s.tipo, costo_mensual_usd: valor, detalle: s.detalle,
      })
      await cargar()
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al guardar') }
  }

  async function simular() {
    setSimulando(true)
    try {
      await api.post(`/admin/precios/simular?source=${encodeURIComponent(source)}`)
      navigate('/testing/llm')
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear la simulación') }
    finally { setSimulando(false) }
  }

  const p = data?.pricing
  const origen = ORIGEN[p?.costo_conv_origen ?? ''] ?? null
  const c = data?.costos
  const serviciosCliente = [
    ...(c?.variables ?? []).filter((s) => !SERVICIOS_TOKENS.includes(s.nombre)),
    ...(c?.fijos_cliente ?? []),
  ]

  const inputCls = 'w-full bg-app border border-line rounded-lg px-3 py-2 text-sm text-ink focus:border-primary outline-none'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">Precios</h1>
        <ClienteSelector
          sources={selectorOpts}
          value={source}
          onChange={setSource}
          isDefault={source === savedDefault}
          onSetDefault={setDefault}
        />
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <p className="text-xs text-muted -mt-2">Qué se le cobra a cada cliente, qué nos cuesta y el margen. Los campos se guardan al salir de cada input.</p>

      {source === GENERAL ? (
      <DashboardGrid pantalla="precios-general" defaultLayout={GENERAL_LAYOUT}>
        <div key="gTabla">
          <Widget id="gTabla" title="Comparativa de clientes">
            {!general?.clientes?.length ? <p className="text-sm text-muted">Sin clientes.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted text-xs border-b border-line">
                      <th className="text-left font-medium py-2 pr-3">Cliente</th>
                      <th className="text-right font-medium py-2 px-3">Abono</th>
                      <th className="text-right font-medium py-2 px-3">Costo/mes</th>
                      <th className="text-right font-medium py-2 px-3">Ganancia</th>
                      <th className="text-right font-medium py-2 px-3">% margen</th>
                      <th className="text-right font-medium py-2 pl-3">Faltantes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {general.clientes.map((cl) => (
                      <tr key={cl.source} className="border-b border-line/50">
                        <td className="py-2 pr-3 text-ink font-medium">{cl.nombre}</td>
                        <td className="py-2 px-3 text-right text-ink-soft">{cl.abono == null ? '—' : usd(cl.abono)}</td>
                        <td className="py-2 px-3 text-right text-muted">{usd(cl.costo_total)}</td>
                        <td className={`py-2 px-3 text-right font-medium ${cl.margen ? (cl.margen.ganancia >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-muted'}`}>
                          {cl.margen ? usd(cl.margen.ganancia) : '—'}
                        </td>
                        <td className="py-2 px-3 text-right text-muted">{cl.margen?.pct != null ? cl.margen.pct.toFixed(1) + '%' : '—'}</td>
                        <td className={`py-2 pl-3 text-right ${cl.faltantes > 0 ? 'text-amber' : 'text-muted'}`}>{cl.faltantes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Widget>
        </div>
        <div key="estructura">
          <Widget id="estructura" title="Costo de estructura (compartido)">
            <EstructuraContent estructura={general?.estructura ?? null} onSave={guardarCostoEstructura} />
          </Widget>
        </div>
      </DashboardGrid>
      ) : (
      <DashboardGrid pantalla="precios-cliente" defaultLayout={CLIENTE_LAYOUT}>

        {/* 1 · Parámetros comerciales */}
        <div key="parametros">
          <Widget id="parametros" title="Parámetros comerciales">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="text-xs text-muted">Abono mensual (USD)</span>
                  <input
                    type="number" step="1" min="0" aria-label="Abono mensual (USD)"
                    className={`${inputCls} mt-1`} placeholder="USD/mes — falta cargar"
                    value={form.abono}
                    onChange={(e) => setForm((f) => ({ ...f, abono: e.target.value }))}
                    onBlur={() => guardarParam('abono_mensual_usd', form.abono, p?.abono_mensual_usd ?? null)}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted">Conversaciones diarias estimadas</span>
                  <input
                    type="number" step="1" min="0" aria-label="Conversaciones diarias estimadas"
                    className={`${inputCls} mt-1`} placeholder="conv/día — falta cargar"
                    value={form.conv}
                    onChange={(e) => setForm((f) => ({ ...f, conv: e.target.value }))}
                    onBlur={() => guardarParam('conversaciones_dia', form.conv, p?.conversaciones_dia ?? null)}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted">Costo promedio por conversación (USD)</span>
                  <input
                    type="number" step="0.001" min="0" aria-label="Costo promedio por conversación (USD)"
                    className={`${inputCls} mt-1`} placeholder="$/conv"
                    value={form.costo}
                    onChange={(e) => setForm((f) => ({ ...f, costo: e.target.value }))}
                    onBlur={() => guardarParam('costo_conv_usd', form.costo, p?.costo_conv_usd ?? null)}
                  />
                </label>
              </div>

              {/* Origen del $/conv + acción de simular */}
              <div className="flex flex-wrap items-center gap-2">
                {origen && (
                  <span data-testid="chip-origen" title={origen.title}
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide ${origen.cls}`}>
                    {origen.label}
                  </span>
                )}
                {p?.costo_conv_origen === 'estimado_etiguel' && (
                  <>
                    <span className="text-xs text-amber">
                      Estimación con los valores de Etiguel — hacé una simulación para obtener valores reales de este cliente.
                    </span>
                    <button onClick={simular} disabled={simulando}
                      className="flex items-center gap-1.5 bg-primary text-on-primary rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-primary-dark disabled:opacity-50">
                      {simulando ? <RefreshCw size={13} className="animate-spin" /> : <FlaskConical size={13} />}
                      {simulando ? 'Creando…' : 'Simular costo real'}
                    </button>
                  </>
                )}
              </div>

              {/* $/conv medido real del monitor */}
              <div className="bg-app border border-line rounded-xl p-3">
                {data?.medido ? (
                  <>
                    <div className="text-sm text-ink">
                      Medido real: <span className="font-semibold text-emerald-400">{usd4(data.medido.valor)}/conv</span>
                      <span className="text-muted"> · mes {data.medido.mes} · {data.medido.conversaciones} conversaciones ({usd(data.medido.costo_mes)} en total)</span>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted">Todavía no hay $/conversación medido (sin muestra suficiente del monitor).</div>
                )}
                <p className="text-xs text-muted mt-1">El monitor avisa si el medido se desvía ±{data?.desvio_alerta_pct ?? 30}% de lo cotizado.</p>
              </div>

              {p?.notas && <p className="text-xs text-muted italic">{p.notas}</p>}
            </div>
          </Widget>
        </div>

        {/* 2 · Motores LLM */}
        <div key="motores">
          <Widget id="motores" title="Motores LLM">
            <div className="space-y-3">
              <datalist id="motores-registrados">
                {(data?.motores_registrados ?? []).map((m) => (
                  <option key={m.id} value={`${m.provider}/${m.nombre}`} />
                ))}
              </datalist>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs text-muted">Motor primario</span>
                  <input
                    type="text" list="motores-registrados" aria-label="Motor primario"
                    className={`${inputCls} mt-1`} placeholder="ej. myclaw/GLM 5.2"
                    value={form.motorP}
                    onChange={(e) => setForm((f) => ({ ...f, motorP: e.target.value }))}
                    onBlur={() => guardarParam('motor_primario', form.motorP, p?.motor_primario ?? null)}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted">Motor fallback</span>
                  <input
                    type="text" list="motores-registrados" aria-label="Motor fallback"
                    className={`${inputCls} mt-1`} placeholder="falta confirmar"
                    value={form.motorF}
                    onChange={(e) => setForm((f) => ({ ...f, motorF: e.target.value }))}
                    onBlur={() => guardarParam('motor_fallback', form.motorF, p?.motor_fallback ?? null)}
                  />
                </label>
              </div>
              {(data?.motores_registrados ?? []).length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted border-b border-line">
                        <th className="text-left font-medium py-1.5 pr-2">Motor</th>
                        <th className="text-right font-medium py-1.5 px-2">Input</th>
                        <th className="text-right font-medium py-1.5 px-2">Output</th>
                        <th className="text-right font-medium py-1.5 pl-2">Cache read</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data!.motores_registrados.map((m) => (
                        <tr key={m.id} className="border-b border-line/50">
                          <td className="py-1.5 pr-2">
                            <span className="text-ink font-medium">{m.nombre}</span>
                            {m.es_actual && (
                              <span className="ml-1.5 text-[9.5px] font-bold px-1.5 py-0.5 rounded border border-emerald-500/50 text-emerald-400 bg-emerald-500/10 uppercase">actual</span>
                            )}
                            <div className="text-muted truncate" title={m.model_id}>{m.provider} · {m.model_id}</div>
                          </td>
                          <td className="py-1.5 px-2 text-right text-ink-soft whitespace-nowrap">{porM(m.precio_in)}</td>
                          <td className="py-1.5 px-2 text-right text-ink-soft whitespace-nowrap">{porM(m.precio_out)}</td>
                          <td className="py-1.5 pl-2 text-right text-muted whitespace-nowrap">{porM(m.precio_cache_read)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Widget>
        </div>

        {/* 3 · Costos mensuales del cliente */}
        <div key="costos">
          <Widget id="costos" title="Costos mensuales del cliente">
            <div className="space-y-2">
              {/* Tokens del bot — calculado, no se carga a mano */}
              <div className="flex items-center justify-between gap-3 border-b border-line/50 pb-2">
                <div className="min-w-0">
                  <span className="text-sm text-ink">Tokens del bot (motor LLM)</span>
                  <p className="text-xs text-muted">{form.conv || '¿?'} conv/día × 22 días laborales × {p?.costo_conv_usd != null ? usd4(p.costo_conv_usd) : '¿?'} — calculado solo</p>
                </div>
                <span className="text-sm font-medium text-ink-soft whitespace-nowrap">{usd(c?.tokens_bot_mes)}</span>
              </div>
              {/* Tokens internos Anthropic — real del mes */}
              <div className="flex items-center justify-between gap-3 border-b border-line/50 pb-2">
                <div className="min-w-0">
                  <span className="text-sm text-ink">Tokens internos Anthropic</span>
                  <p className="text-xs text-muted">Especialistas + asistentes Haiku — real del mes</p>
                </div>
                <span className="text-sm font-medium text-ink-soft whitespace-nowrap">{usd(c?.anthropic_mes)}</span>
              </div>
              {/* Resto de servicios: editables (override por cliente) */}
              {serviciosCliente.map((s) => (
                <div key={`${s.tipo}-${s.nombre}`} className="flex items-center justify-between gap-3 border-b border-line/50 pb-2">
                  <div className="min-w-0">
                    <span className="text-sm text-ink" title={s.detalle}>{s.nombre}</span>
                    <p className="text-xs text-muted truncate" title={s.detalle}>{s.detalle}</p>
                  </div>
                  <CostoInput servicio={s} onSave={(v) => guardarCostoCliente(s, v)} />
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm font-bold text-ink">Total del cliente</span>
                <span className="text-sm font-bold text-ink">{usd(c?.total)}</span>
              </div>
            </div>
          </Widget>
        </div>

        {/* 4 · Margen de ganancia */}
        <div key="margen">
          <Widget id="margen" title="Margen de ganancia">
            {data?.margen ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { l: 'Abono', v: usd(data.margen.abono), cls: 'text-ink' },
                    { l: 'Costos', v: usd(data.margen.costo_total), cls: 'text-ink' },
                    { l: 'Ganancia/mes', v: usd(data.margen.ganancia), cls: data.margen.ganancia >= 0 ? 'text-emerald-400' : 'text-red-400' },
                  ].map((k) => (
                    <div key={k.l} className="bg-app border border-line rounded-xl p-3">
                      <div className={`text-lg font-semibold ${k.cls}`}>{k.v}</div>
                      <div className="text-xs text-muted mt-0.5">{k.l}</div>
                    </div>
                  ))}
                </div>
                <MargenBar abono={data.margen.abono} costo={data.margen.costo_total} />
                <p className="text-sm text-muted">
                  Margen: <span className={`font-semibold ${data.margen.ganancia >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {data.margen.pct != null ? data.margen.pct.toFixed(1) + '%' : '—'}
                  </span>
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted">Cargá el abono mensual para ver el margen.</p>
            )}
          </Widget>
        </div>

        {/* 5 · Datos faltantes */}
        <div key="faltantes">
          <Widget id="faltantes" title="Datos faltantes para cotizar bien">
            {(data?.datos_faltantes ?? []).length === 0 ? (
              <p className="text-sm text-emerald-400 flex items-center gap-1.5"><CheckCircle2 size={15} /> No falta ningún dato.</p>
            ) : (
              <ul className="space-y-1.5">
                {data!.datos_faltantes.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink-soft">
                    <AlertTriangle size={14} className="text-amber mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </Widget>
        </div>

        {/* 6 · Estructura compartida */}
        <div key="estructura">
          <Widget id="estructura" title="Costo de estructura (compartido)">
            <EstructuraContent estructura={data?.estructura ?? null} onSave={guardarCostoEstructura} />
          </Widget>
        </div>
      </DashboardGrid>
      )}
    </div>
  )
}

/** Input de costo mensual de un servicio: edita local y guarda al salir. */
function CostoInput({ servicio, onSave }: { servicio: Servicio; onSave: (v: number | null) => void }) {
  const [valor, setValor] = useState(servicio.costo_mensual_usd == null ? '' : String(servicio.costo_mensual_usd))
  useEffect(() => {
    setValor(servicio.costo_mensual_usd == null ? '' : String(servicio.costo_mensual_usd))
  }, [servicio.costo_mensual_usd])

  function commit() {
    const t = valor.trim().replace(',', '.')
    const v = t === '' ? null : Number(t)
    if (v !== null && !Number.isFinite(v)) return
    if (v === servicio.costo_mensual_usd) return
    onSave(v)
  }
  return (
    <input
      type="number" step="0.01" min="0"
      aria-label={`Costo mensual de ${servicio.nombre}`}
      className="w-32 shrink-0 bg-app border border-line rounded-lg px-2 py-1.5 text-sm text-right text-ink focus:border-primary outline-none placeholder:text-[11px]"
      placeholder="$/mes — falta cargar"
      value={valor}
      onChange={(e) => setValor(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    />
  )
}

/** Contenido del widget de estructura (compartido entre vista cliente y General). */
function EstructuraContent({ estructura, onSave }: { estructura: Estructura | null; onSave: (s: Servicio, v: number | null) => void }) {
  if (!estructura) return <p className="text-sm text-muted">Cargando…</p>
  return (
    <div className="space-y-2">
      {estructura.servicios.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-3 border-b border-line/50 pb-2">
          <div className="min-w-0">
            <span className="text-sm text-ink" title={s.detalle}>{s.nombre}</span>
            <p className="text-xs text-muted truncate" title={s.detalle}>{s.detalle}</p>
          </div>
          <CostoInput servicio={s} onSave={(v) => onSave(s, v)} />
        </div>
      ))}
      <div className="flex items-center justify-between pt-1">
        <span className="text-sm font-bold text-ink">Total estructura</span>
        <span className="text-sm font-bold text-ink">{usd(estructura.total)}</span>
      </div>
      <p className="text-xs text-muted">
        Prorrateo: <span className="text-ink-soft font-medium">{usd(estructura.prorrateo_por_cliente)}</span> por cliente
        ({estructura.n_clientes} {estructura.n_clientes === 1 ? 'cliente' : 'clientes'}) — informativo, NO entra al margen por cliente.
      </p>
    </div>
  )
}

/** Barra de proporción costo vs ganancia sobre el abono (SVG escalable). */
function MargenBar({ abono, costo }: { abono: number; costo: number }) {
  const W = 400, H = 26
  const total = Math.max(abono, costo, 0.01)
  const ganancia = abono - costo
  const wCosto = (Math.min(costo, total) / total) * W
  const wAbono = (Math.min(abono, total) / total) * W
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full rounded-lg" style={{ height: 22 }}>
        <rect x={0} y={0} width={W} height={H} fill="#243454" rx={4} />
        {ganancia >= 0 ? (
          <>
            {/* costo + ganancia dentro del abono */}
            <rect x={0} y={0} width={wCosto} height={H} fill="#5C6E90" />
            <rect x={wCosto} y={0} width={Math.max(0, wAbono - wCosto)} height={H} fill="#34d399" />
          </>
        ) : (
          <>
            {/* el costo supera el abono: lo que excede es pérdida */}
            <rect x={0} y={0} width={wAbono} height={H} fill="#5C6E90" />
            <rect x={wAbono} y={0} width={Math.max(0, wCosto - wAbono)} height={H} fill="#ef4444" />
          </>
        )}
      </svg>
      <div className="flex flex-wrap gap-4 mt-1.5 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#5C6E90' }} />Costo</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: ganancia >= 0 ? '#34d399' : '#ef4444' }} />
          {ganancia >= 0 ? 'Ganancia' : 'Pérdida'}
        </span>
      </div>
    </div>
  )
}
