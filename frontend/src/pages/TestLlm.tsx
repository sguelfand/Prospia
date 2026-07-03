import { AlertTriangle, BarChart2, ChevronDown, Cpu, DollarSign, Loader2, MessageSquare, Pencil, Play, Plus, RefreshCw, Search, ShieldAlert, TrendingUp, Trash2, X, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { DashboardGrid, Widget, buildLayouts } from '../components/DashboardGrid'

const SOURCE = 'etiguel'

type Sobre = { system_chars?: number; modelo_actual?: string | null; archivos?: string[]; error?: string }
type Saldo = { total: number; usado: number; disponible: number }
type Estado = {
  habilitado: boolean
  keys: Record<string, boolean>
  motores: number
  escenarios: number
  sobre: Sobre
  saldo_openrouter: Saldo | null
}
type Motor = {
  id: number; nombre: string; provider: string; model_id: string; base_url: string
  tiene_key: boolean; precio_in: number; precio_out: number
  precio_cache_read: number; precio_cache_write: number; activo: boolean; es_actual: boolean; notas: string
}
type Escenario = {
  id: number; slug: string; nombre: string; caso_uso: string; descripcion: string
  guion: string[]; esperado: Record<string, unknown>; activo: boolean; orden: number
}
type Estimacion = {
  motores: number; escenarios: number; turnos_totales: number; system_tokens: number
  por_motor: { motor_id: number; nombre: string; provider: string; costo_usd: number }[]
  por_proveedor: Record<string, number>
  costo_openrouter_usd: number
  juez_costo_usd: number; total_usd: number; total_sin_juez_usd: number; nota: string
}
type Resultado = {
  motor_id: number; motor_nombre: string; escenario_slug: string; escenario_nombre: string
  caso_uso: string; veredicto: 'bien' | 'mal' | 'dudoso'; categoria: string; detalle: string
  costo_usd: number; latencia_ms: number; tokens_in: number; tokens_out: number
  tool_calls: { nombre: string; args: unknown }[]
  transcript: { quien: string; texto: string }[]; error: string | null
}
type ResumenMotor = { nombre: string; bien: number; mal: number; dudoso: number; score: number; costo_usd: number }
type Corrida = {
  id: number; nombre: string; estado: string; motores: number[]; escenarios: number[]
  costo_estimado_usd: number; costo_real_usd: number; resumen: Record<string, ResumenMotor>
  created_at: string | null; finished_at: string | null; resultados?: Resultado[]
  conclusion?: string; conclusion_estado?: string; conclusion_motores?: number[]; conclusion_at?: string | null
}

const RESULT_LAYOUT = buildLayouts([
  { i: 'score', x: 0, y: 0, w: 6, h: 8, minH: 5 },
  { i: 'costo', x: 6, y: 0, w: 6, h: 8, minH: 5 },
  { i: 'tabla', x: 0, y: 8, w: 12, h: 10, minH: 6 },
])

const money = (n: number) => `US$${(n ?? 0).toFixed(n < 1 ? 4 : 2)}`
const VER_COLOR: Record<string, string> = { bien: 'text-emerald-500', mal: 'text-red-500', dudoso: 'text-amber' }
const VER_BG: Record<string, string> = { bien: 'bg-emerald-500', mal: 'bg-red-500', dudoso: 'bg-amber' }

export default function TestLlm() {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [motores, setMotores] = useState<Motor[]>([])
  const [escenarios, setEscenarios] = useState<Escenario[]>([])
  const [corridas, setCorridas] = useState<Corrida[]>([])
  const [abierta, setAbierta] = useState<Corrida | null>(null)
  const [selMot, setSelMot] = useState<Set<number>>(new Set())
  const [selEsc, setSelEsc] = useState<Set<number>>(new Set())
  const [estimacion, setEstimacion] = useState<Estimacion | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [showMotorForm, setShowMotorForm] = useState(false)
  const [showEsc, setShowEsc] = useState(false)
  const [editEsc, setEditEsc] = useState<number | 'nuevo' | null>(null)
  const [transcript, setTranscript] = useState<Resultado | null>(null)
  const [runId, setRunId] = useState<number | null>(null)   // corrida en curso (polling en vivo)
  const [vivo, setVivo] = useState<Corrida | null>(null)    // último snapshot polleado
  const [conJuez, setConJuez] = useState(false)             // juez automático (API) vs en sesión (plan Pro)

  async function cargar() {
    try {
      const [e, m, s, c] = await Promise.all([
        api.get<Estado>(`/admin/test-llm/estado?source=${SOURCE}`),
        api.get<Motor[]>('/admin/test-llm/motores'),
        api.get<Escenario[]>('/admin/test-llm/escenarios'),
        api.get<Corrida[]>(`/admin/test-llm/corridas?source=${SOURCE}`),
      ])
      setEstado(e); setMotores(m); setEscenarios(s); setCorridas(c)
      if (selMot.size === 0) setSelMot(new Set(m.filter(x => x.activo).map(x => x.id)))
      if (selEsc.size === 0) setSelEsc(new Set(s.filter(x => x.activo).map(x => x.id)))
      // Si hay una corrida corriendo (arrancó en otra pestaña o antes de irte), reengancha
      // la vista en vivo al volver a la pantalla.
      const running = c.find(x => x.estado === 'corriendo')
      if (running) setRunId(prev => prev ?? running.id)
    } catch (err) { setMsg((err as Error).message) }
  }
  useEffect(() => { cargar() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (set: Set<number>, id: number, upd: (s: Set<number>) => void) => {
    const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); upd(n); setEstimacion(null)
  }

  async function habilitar(on: boolean) {
    setBusy(true)
    try { await api.post('/admin/test-llm/habilitar', { on }); await cargar() }
    catch (err) { setMsg((err as Error).message) } finally { setBusy(false) }
  }

  async function estimar() {
    setBusy(true); setMsg('')
    try {
      const est = await api.post<Estimacion>('/admin/test-llm/estimar', {
        source: SOURCE, motor_ids: [...selMot], escenario_ids: [...selEsc],
      })
      setEstimacion(est)
    } catch (err) { setMsg((err as Error).message) } finally { setBusy(false) }
  }

  async function crearYCorrer() {
    setBusy(true); setMsg('')
    try {
      const cor = await api.post<{ id: number }>('/admin/test-llm/corridas', {
        source: SOURCE, motor_ids: [...selMot], escenario_ids: [...selEsc],
      })
      // Lanza en segundo plano (GATED: si el switch está OFF devuelve 423). Vuelve al toque.
      // juzgar según el switch: con juez = API (Sonnet); sin juez = lo aplico yo en sesión (plan Pro).
      await api.post(`/admin/test-llm/corridas/${cor.id}/correr?juzgar=${conJuez}`)
      setAbierta(null); setVivo(null); setRunId(cor.id)   // arranca el polling en vivo
    } catch (err) {
      setMsg((err as Error).message)
      await cargar()  // la corrida quedó creada aunque no se lanzara
    } finally { setBusy(false) }
  }

  // Polling en vivo mientras corre: refresca cada 3s hasta 'lista'/'error'.
  useEffect(() => {
    if (runId == null) return
    let stop = false
    const tick = async () => {
      try {
        const d = await api.get<Corrida>(`/admin/test-llm/corridas/${runId}`)
        if (stop) return
        setVivo(d)
        if (d.estado === 'lista' || d.estado === 'sin_juzgar' || d.estado === 'error') {
          setRunId(null)
          if (d.estado === 'lista') setAbierta(d)
          if (d.estado === 'sin_juzgar') setVivo(d)   // queda mostrando "pendiente de juzgar"
          cargar()
          return
        }
      } catch { /* reintenta */ }
      if (!stop) setTimeout(tick, 3000)
    }
    tick()
    return () => { stop = true }
  }, [runId])  // eslint-disable-line react-hooks/exhaustive-deps

  async function abrirCorrida(id: number) {
    try { setAbierta(await api.get<Corrida>(`/admin/test-llm/corridas/${id}`)) }
    catch (err) { setMsg((err as Error).message) }
  }

  const costoTotalSel = useMemo(() => estimacion?.total_usd ?? 0, [estimacion])
  const saldoOR = estado?.saldo_openrouter?.disponible ?? null
  const sobrepasaSaldo = !!(estimacion && saldoOR != null && estimacion.costo_openrouter_usd > saldoOR)

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Cpu size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-ink">Motores LLM</h1>
          <p className="text-xs text-muted">Comparar cómo se comporta Camila con distintos motores — calidad y costo por tipo de conversación.</p>
        </div>
        <button onClick={cargar} className="ml-auto flex items-center gap-1 text-xs font-semibold border border-line text-muted rounded-lg px-3 py-1.5 hover:text-ink">
          <RefreshCw size={13} /> Actualizar
        </button>
      </header>

      {msg && (
        <div className="text-xs bg-red-500/10 text-red-500 border border-red-500/30 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={14} /> {msg}
        </div>
      )}

      {/* Estado: sobre + gate + keys */}
      {estado && (
        <section className="bg-card border border-line rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap items-start gap-6">
            <div className="min-w-[220px]">
              <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">Sobre reconstruido (OpenClaw vivo)</div>
              {estado.sobre?.error ? (
                <div className="text-xs text-red-500">No se pudo leer el sobre: {estado.sobre.error}</div>
              ) : (
                <div className="text-xs text-ink space-y-0.5">
                  <div>Modelo actual de Camila: <b>{estado.sobre?.modelo_actual ?? '—'}</b></div>
                  <div>System prompt: <b>{(estado.sobre?.system_chars ?? 0).toLocaleString()}</b> caracteres</div>
                  <div className="text-muted">Archivos: {(estado.sobre?.archivos ?? []).join(', ')}</div>
                </div>
              )}
            </div>
            <div className="min-w-[200px]">
              <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">Keys por proveedor</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(estado.keys).map(([p, ok]) => (
                  <span key={p} className={`text-[11px] font-semibold rounded px-2 py-0.5 border ${ok ? 'text-emerald-500 border-emerald-500/40' : 'text-muted border-line'}`}>
                    {p}: {ok ? 'cargada' : 'falta'}
                  </span>
                ))}
              </div>
            </div>
            {/* Saldo OpenRouter */}
            <div className="min-w-[150px]">
              <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">Saldo OpenRouter</div>
              {estado.saldo_openrouter ? (
                <div className="text-xs">
                  <div className="text-emerald-500 font-bold text-base">{money(estado.saldo_openrouter.disponible)}</div>
                  <div className="text-muted">de {money(estado.saldo_openrouter.total)} · usado {money(estado.saldo_openrouter.usado)}</div>
                </div>
              ) : <div className="text-xs text-muted">sin key / —</div>}
            </div>
            {/* Gate */}
            <div className="ml-auto">
              <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${estado.habilitado ? 'border-amber/50 bg-amber/5' : 'border-line'}`}>
                <ShieldAlert size={18} className={estado.habilitado ? 'text-amber' : 'text-muted'} />
                <div className="text-xs">
                  <div className="font-semibold text-ink">{estado.habilitado ? 'Correr HABILITADO' : 'Correr bloqueado'}</div>
                  <div className="text-muted">{estado.habilitado ? 'Las corridas consumen tokens.' : 'Estimar no gasta. Correr sí.'}</div>
                </div>
                <button
                  onClick={() => habilitar(!estado.habilitado)}
                  disabled={busy}
                  className={`text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50 ${estado.habilitado ? 'border border-line text-muted hover:text-ink' : 'bg-primary text-on-primary hover:bg-primary-dark'}`}
                >
                  {estado.habilitado ? 'Bloquear' : 'Habilitar'}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Nueva comparación */}
      <section className={`rounded-2xl p-6 space-y-4 transition-colors ${runId != null ? 'bg-amber/5 border-2 border-amber/60 shadow-[0_0_0_3px_rgba(245,158,11,0.12)]' : 'bg-card border border-line'}`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink flex items-center gap-2">
            {runId != null && <Loader2 size={15} className="animate-spin text-amber" />}
            {runId != null ? 'Comparación en proceso…' : 'Nueva comparación'}
          </h2>
          <button onClick={() => setShowMotorForm(v => !v)} className="flex items-center gap-1 text-xs font-semibold border border-primary/50 text-primary rounded-lg px-2.5 py-1.5 hover:bg-primary/10">
            <Plus size={13} /> Motor
          </button>
        </div>

        {showMotorForm && <MotorForm onSaved={() => { setShowMotorForm(false); cargar() }} />}

        <div className="grid md:grid-cols-2 gap-6">
          {/* Motores */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-2">Motores ({selMot.size}/{motores.length})</div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {motores.map(m => (
                <label key={m.id} className="flex items-center gap-2 text-xs text-ink border border-line rounded-lg px-2.5 py-2 cursor-pointer hover:border-primary/40">
                  <input type="checkbox" checked={selMot.has(m.id)} onChange={() => toggle(selMot, m.id, setSelMot)} />
                  <span className="flex-1">
                    <span className="font-semibold">{m.nombre}</span>
                    {m.es_actual && <span className="ml-1 text-[10px] font-bold text-amber border border-amber/50 rounded px-1">actual</span>}
                    <span className="block text-muted">{m.model_id} · in {money(m.precio_in * 1e6)}/M</span>
                  </span>
                  <button onClick={(ev) => { ev.preventDefault(); if (confirm(`¿Borrar motor "${m.nombre}"?`)) api.delete(`/admin/test-llm/motores/${m.id}`).then(cargar) }} className="text-muted hover:text-red-500">
                    <Trash2 size={13} />
                  </button>
                </label>
              ))}
            </div>
          </div>
          {/* Escenarios */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">Escenarios ({selEsc.size}/{escenarios.length})</div>
              <div className="flex gap-2 text-[11px]">
                <button onClick={() => { setSelEsc(new Set(escenarios.map(e => e.id))); setEstimacion(null) }} className="text-primary hover:underline">todos</button>
                <button onClick={() => { setSelEsc(new Set()); setEstimacion(null) }} className="text-muted hover:underline">ninguno</button>
              </div>
            </div>
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {escenarios.map(e => (
                <label key={e.id} className="flex items-center gap-2 text-xs text-ink border border-line rounded-lg px-2.5 py-2 cursor-pointer hover:border-primary/40">
                  <input type="checkbox" checked={selEsc.has(e.id)} onChange={() => toggle(selEsc, e.id, setSelEsc)} />
                  <span className="flex-1">
                    <span className="font-semibold">{e.nombre}</span>
                    <span className="block text-muted">{e.caso_uso}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Estimar / correr */}
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button onClick={estimar} disabled={busy || selMot.size === 0 || selEsc.size === 0} className="flex items-center gap-1.5 text-sm font-semibold border border-primary/50 text-primary rounded-lg px-4 py-2 hover:bg-primary/10 disabled:opacity-40">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <DollarSign size={15} />} Estimar costo
          </button>
          {estimacion && (
            <div className="text-xs text-ink flex items-center gap-4 flex-wrap">
              <span className="text-muted">{estimacion.motores} motores × {estimacion.escenarios} escenarios</span>
              <span className="flex items-center gap-1">
                <span className="text-muted">Sin juez</span>
                <b className={`text-sm ${!conJuez ? 'text-emerald-500' : 'text-ink'}`}>{money(estimacion.total_sin_juez_usd)}</b>
              </span>
              <span className="flex items-center gap-1">
                <span className="text-muted">Con juez</span>
                <b className={`text-sm ${conJuez ? 'text-primary' : 'text-ink'}`}>{money(estimacion.total_usd)}</b>
                <span className="text-[10px] text-muted">(juez {money(estimacion.juez_costo_usd)})</span>
              </span>
              <span className="flex items-center gap-1.5 flex-wrap">
                {Object.entries(estimacion.por_proveedor).filter(([p]) => conJuez || !p.includes('juez')).map(([prov, c]) => (
                  <span key={prov} className={`text-[11px] rounded px-1.5 py-0.5 border ${prov === 'openrouter' ? 'border-primary/40 text-primary' : 'border-line text-muted'}`}>
                    {prov}: {money(c)}
                  </span>
                ))}
              </span>
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-ink cursor-pointer select-none ml-auto" title="Con juez: evalúa por la API (Sonnet). Sin juez: corré ahora y pedime 'juzgá la corrida X' en una sesión (plan Pro, gratis).">
            <input type="checkbox" checked={conJuez} onChange={e => setConJuez(e.target.checked)} />
            <span>Con juez <span className="text-muted">(API)</span></span>
          </label>
          <button
            onClick={crearYCorrer}
            disabled={busy || runId != null || selMot.size === 0 || selEsc.size === 0 || !estado?.habilitado || sobrepasaSaldo}
            title={sobrepasaSaldo ? 'El estimado de OpenRouter supera tu saldo' : (!estado?.habilitado ? 'Habilitá "Correr" arriba (consume tokens)' : undefined)}
            className="ml-auto flex items-center gap-1.5 text-sm font-semibold bg-emerald-500 text-white rounded-lg px-4 py-2 hover:bg-emerald-600 disabled:opacity-40"
          >
            {(busy || runId != null) ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {runId != null ? 'Corriendo…' : 'Correr comparación'}
          </button>
        </div>
        {sobrepasaSaldo && estimacion && estado?.saldo_openrouter && (
          <div className="text-xs bg-red-500/10 text-red-500 border border-red-500/40 rounded-lg px-3 py-2 flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0" />
            El estimado de OpenRouter (<b>{money(estimacion.costo_openrouter_usd)}</b>) supera tu saldo disponible
            (<b>{money(estado.saldo_openrouter.disponible)}</b>). Sacá algún motor de OpenRouter, achicá la selección, o cargá créditos.
            {' '}(MyClaw y el juez se facturan aparte y no dependen de este saldo.)
          </div>
        )}
        {runId != null ? (
          <CorridaEnVivo vivo={vivo} onVerTranscript={setTranscript} />
        ) : vivo?.estado === 'sin_juzgar' ? (
          <div className="text-xs bg-primary/5 text-ink border border-primary/40 rounded-lg px-3 py-2.5 flex items-start gap-2">
            <Cpu size={14} className="text-primary shrink-0 mt-0.5" />
            <div className="flex-1">
              <div>
                Corrida <b>#{vivo.id}</b> lista — los motores corrieron y las conversaciones quedaron guardadas.
                <b> Pendiente de juzgar.</b> En una sesión decime <i>"juzgá la corrida {vivo.id}"</i> y la evalúo con
                el plan Pro (juez Sonnet, gratis) → ahí aparecen los puntajes.
              </div>
              <button onClick={() => abrirCorrida(vivo.id)} className="mt-2 flex items-center gap-1 text-[11px] font-semibold border border-primary/50 text-primary rounded-lg px-2.5 py-1 hover:bg-primary/10">
                <BarChart2 size={12} /> Ver resultados
              </button>
            </div>
          </div>
        ) : !conJuez ? (
          <p className="text-[11px] text-muted flex items-center gap-1">
            <ShieldAlert size={12} /> Juez en modo <b>sesión (plan Pro)</b>: corré los motores ahora y después pedime que juzgue. Marcá "Con juez (API)" para que evalúe solo.
          </p>
        ) : !estado?.habilitado && (
          <p className="text-[11px] text-muted flex items-center gap-1"><ShieldAlert size={12} /> "Correr" está bloqueado hasta que habilites el switch. Podés estimar el costo sin gastar nada.</p>
        )}
      </section>

      {/* Catálogo OpenRouter: ranking + precios + costo de testear */}
      <CatalogoOpenRouter selEsc={[...selEsc]} onAdded={cargar} />

      {/* Banco de escenarios — editable (crear / modificar / borrar) */}
      <section className="bg-card border border-line rounded-2xl p-6">
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => setShowEsc(v => !v)} className="flex items-center gap-2 text-sm font-bold text-ink">
            Banco de escenarios ({escenarios.length})
            <ChevronDown size={16} className={`transition-transform ${showEsc ? '' : '-rotate-90'}`} />
          </button>
          {showEsc && (
            <button onClick={() => setEditEsc('nuevo')} className="flex items-center gap-1 text-xs font-semibold border border-primary/50 text-primary rounded-lg px-2.5 py-1.5 hover:bg-primary/10">
              <Plus size={13} /> Nuevo escenario
            </button>
          )}
        </div>
        {showEsc && (
          <div className="mt-4 space-y-2">
            {editEsc === 'nuevo' && <EscenarioForm onSaved={() => { setEditEsc(null); cargar() }} onCancel={() => setEditEsc(null)} />}
            {escenarios.map(e => (
              editEsc === e.id ? (
                <EscenarioForm key={e.id} esc={e} onSaved={() => { setEditEsc(null); cargar() }} onCancel={() => setEditEsc(null)} />
              ) : (
                <div key={e.id} className="border border-line rounded-lg px-3 py-2 text-xs flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-ink">{e.nombre} <span className="text-muted font-normal">· {e.caso_uso}</span>{!e.activo && <span className="ml-1 text-[10px] text-muted border border-line rounded px-1">inactivo</span>}</div>
                    {e.descripcion && <div className="text-muted">{e.descripcion}</div>}
                    <div className="text-ink/70 mt-1 font-mono text-[11px]">{e.guion.map((g, i) => `[${i + 1}] ${g}`).join('  ')}</div>
                  </div>
                  <button onClick={() => setEditEsc(e.id)} className="text-muted hover:text-primary shrink-0" title="Editar"><Pencil size={13} /></button>
                  <button onClick={() => { if (confirm(`¿Borrar escenario "${e.nombre}"?`)) api.delete(`/admin/test-llm/escenarios/${e.id}`).then(cargar) }} className="text-muted hover:text-red-500 shrink-0" title="Borrar"><Trash2 size={13} /></button>
                </div>
              )
            ))}
          </div>
        )}
      </section>

      {/* Historial de corridas */}
      <section className="bg-card border border-line rounded-2xl p-6 space-y-3">
        <h2 className="text-sm font-bold text-ink">Historial de comparaciones</h2>
        {corridas.length === 0 && <p className="text-xs text-muted">Todavía no corriste ninguna comparación.</p>}
        <div className="space-y-1.5">
          {corridas.map(c => (
            <div key={c.id} className={`w-full flex items-center gap-3 border rounded-lg px-3 py-2 text-xs ${abierta?.id === c.id ? 'border-primary/50 bg-primary/5' : 'border-line'}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${c.estado === 'lista' ? 'bg-emerald-500' : c.estado === 'sin_juzgar' ? 'bg-primary' : c.estado === 'estimada' || c.estado === 'corriendo' ? 'bg-amber animate-pulse' : c.estado === 'error' ? 'bg-red-500' : 'bg-muted'}`} />
              <span className="flex-1 text-ink font-medium truncate">{c.nombre}{c.estado === 'sin_juzgar' && <span className="ml-1 text-[10px] font-bold text-primary border border-primary/50 rounded px-1">sin juzgar</span>}{c.estado === 'corriendo' && <span className="ml-1 text-[10px] font-bold text-amber border border-amber/50 rounded px-1">corriendo</span>}</span>
              <span className="text-muted shrink-0">{c.motores.length} motores · {c.escenarios.length} esc.</span>
              <span className="text-muted shrink-0">{(c.estado === 'lista' || c.estado === 'sin_juzgar') ? `real ${money(c.costo_real_usd)}` : `est. ${money(c.costo_estimado_usd)}`}</span>
              {(c.estado === 'lista' || c.estado === 'sin_juzgar') && (
                <button onClick={() => abrirCorrida(c.id)} className="shrink-0 flex items-center gap-1 text-[11px] font-semibold border border-primary/50 text-primary rounded-lg px-2.5 py-1 hover:bg-primary/10">
                  <BarChart2 size={12} /> Resultados
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Resultados de la corrida abierta (juzgada o sin juzgar) */}
      {abierta && (abierta.estado === 'lista' || abierta.estado === 'sin_juzgar') && (
        <ResultadosView corrida={abierta} onVerTranscript={setTranscript} onClose={() => setAbierta(null)} />
      )}

      {transcript && <TranscriptModal r={transcript} onClose={() => setTranscript(null)} />}
    </div>
  )
}

/* ── Vista de resultados: ranking + conversaciones por motor (juzgada o sin juzgar) ── */
function ResultadosView({ corrida, onVerTranscript, onClose }: { corrida: Corrida; onVerTranscript: (r: Resultado) => void; onClose: () => void }) {
  const juzgada = corrida.estado === 'lista'
  const res = corrida.resultados || []
  const [abiertoMotor, setAbiertoMotor] = useState<number | null>(null)
  const [selCmp, setSelCmp] = useState<Set<number>>(new Set())
  const [comparando, setComparando] = useState(false)
  const toggleCmp = (id: number) => setSelCmp(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // Veredicto / conclusión final del juez: la pido (marca 'procesando') y la genera Claude en
  // sesión con el plan Pro (subagente Sonnet). Acá solo muestro la animación y polleo hasta 'lista'.
  const [conc, setConc] = useState({
    estado: corrida.conclusion_estado || '', texto: corrida.conclusion || '',
    motores: corrida.conclusion_motores || [] as number[], at: corrida.conclusion_at || null as string | null,
  })
  const [pidiendo, setPidiendo] = useState(false)
  async function pedirVeredicto() {
    setPidiendo(true)
    try {
      const ids = [...selCmp]
      await api.post(`/admin/test-llm/corridas/${corrida.id}/pedir-conclusion`, { motor_ids: ids })
      setConc({ estado: 'procesando', texto: '', motores: ids, at: null })
    } catch { /* noop */ } finally { setPidiendo(false) }
  }
  useEffect(() => {
    if (conc.estado !== 'procesando') return
    const t = setInterval(async () => {
      try {
        const d = await api.get<Corrida>(`/admin/test-llm/corridas/${corrida.id}`)
        if ((d.conclusion_estado || '') === 'lista') {
          setConc({ estado: 'lista', texto: d.conclusion || '', motores: d.conclusion_motores || [], at: d.conclusion_at || null })
        }
      } catch { /* noop */ }
    }, 5000)
    return () => clearInterval(t)
  }, [conc.estado, corrida.id])
  const nombreMotor = (id: number) => motores.find(m => m.id === id)?.nombre || String(id)
  const motores = [...new Set(res.map(r => r.motor_id))].map(id => {
    const rs = res.filter(r => r.motor_id === id)
    const bien = rs.filter(r => r.veredicto === 'bien').length
    const mal = rs.filter(r => r.veredicto === 'mal').length
    const dudoso = rs.filter(r => r.veredicto === 'dudoso').length
    const errores = rs.filter(r => r.error).length
    const costo = rs.reduce((a, r) => a + r.costo_usd, 0)
    const latencia = rs.length ? Math.round(rs.reduce((a, r) => a + r.latencia_ms, 0) / rs.length) : 0
    const score = rs.length ? Math.round((100 * bien) / rs.length) : 0
    return { id, nombre: rs[0]?.motor_nombre || String(id), rs, bien, mal, dudoso, errores, costo, latencia, score }
  })
  motores.sort((a, b) => (juzgada ? (b.score - a.score) || (a.costo - b.costo) : a.costo - b.costo))

  return (
    <section className="bg-card border border-line rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <BarChart2 size={18} className="text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-ink truncate">{corrida.nombre}</h2>
          <p className="text-[11px] text-muted">
            {motores.length} motores · costo real {money(corrida.costo_real_usd)} ·{' '}
            {juzgada
              ? <span className="text-emerald-500 font-semibold">juzgada</span>
              : <span className="text-primary font-semibold">sin juzgar</span>}
          </p>
        </div>
        <button onClick={onClose} className="text-muted hover:text-ink"><X size={16} /></button>
      </div>

      {!juzgada && (
        <div className="text-xs bg-primary/5 text-ink border border-primary/40 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="text-primary shrink-0 mt-0.5" />
          <span>
            Esta comparación <b>todavía no fue juzgada</b> — podés ver las conversaciones de cada motor, pero
            no hay puntajes ni ranking de calidad. Pedí en una sesión <i>"juzgá la corrida {corrida.id}"</i> y
            la evalúo con el juez Sonnet (plan Pro) → ahí aparecen los puntajes.
          </span>
        </div>
      )}

      {/* Veredicto / conclusión final del juez */}
      {conc.estado === 'procesando' && (
        <div className="bg-emerald-500/5 border border-emerald-500/40 rounded-xl px-4 py-3 flex items-start gap-3">
          <Loader2 size={16} className="text-emerald-500 shrink-0 mt-0.5 animate-spin" />
          <div className="text-xs text-ink">
            <b>Generando veredicto…</b>{conc.motores.length ? ` (${conc.motores.length} motores tildados)` : ' (todos los motores)'}
            <div className="text-[11px] text-muted mt-0.5">
              Pedímelo por el chat de Claude — <i>"dame el veredicto de la corrida {corrida.id}"</i> — y lo genero con el
              plan Pro (gratis). Apenas lo aplico, aparece acá solo.
            </div>
          </div>
        </div>
      )}
      {conc.estado === 'lista' && conc.texto && (
        <div className="bg-emerald-500/5 border border-emerald-500/40 rounded-xl px-4 py-3 flex items-start gap-3">
          <TrendingUp size={16} className="text-emerald-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-emerald-500 font-bold mb-1">
              Veredicto del juez{conc.motores.length ? ` · ${conc.motores.map(nombreMotor).join(' · ')}` : ' · todos los motores'}
            </div>
            <div className="text-xs text-ink whitespace-pre-wrap leading-relaxed">{conc.texto}</div>
            {conc.at && <div className="text-[10px] text-muted mt-2">generado {new Date(conc.at).toLocaleString('es-AR')} · plan Pro</div>}
          </div>
        </div>
      )}

      {juzgada && <ResultadosTablero corrida={corrida} onVerTranscript={onVerTranscript} />}

      {comparando && selCmp.size >= 2 && (
        <ComparacionMotores corrida={corrida} motorIds={[...selCmp]} juzgada={juzgada}
          onVerTranscript={onVerTranscript} onClose={() => setComparando(false)} />
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">
            {juzgada ? 'Ranking y conversaciones por motor' : 'Conversaciones por motor (ordenados por costo)'}
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-muted hidden sm:inline">tildá motores</span>
            <button onClick={() => setComparando(true)} disabled={selCmp.size < 2}
              className="flex items-center gap-1 font-semibold border border-primary/50 text-primary rounded-lg px-2.5 py-1 hover:bg-primary/10 disabled:opacity-40">
              <BarChart2 size={12} /> Comparar {selCmp.size >= 2 ? `(${selCmp.size})` : ''}
            </button>
            {juzgada && (
              <button onClick={pedirVeredicto} disabled={pidiendo || conc.estado === 'procesando'}
                title={selCmp.size ? `Veredicto de los ${selCmp.size} motores tildados` : 'Veredicto de todos los motores'}
                className="flex items-center gap-1 font-semibold border border-emerald-500/50 text-emerald-500 rounded-lg px-2.5 py-1 hover:bg-emerald-500/10 disabled:opacity-40">
                <TrendingUp size={12} /> Ver veredicto {selCmp.size ? `(${selCmp.size})` : ''}
              </button>
            )}
          </div>
        </div>
        <div className="space-y-2">
          {motores.map((m, i) => (
            <div key={m.id} className={`border rounded-xl overflow-hidden ${selCmp.has(m.id) ? 'border-primary/50 bg-primary/5' : 'border-line'}`}>
              <div className="w-full flex items-center gap-3 px-3 py-2.5 text-xs hover:bg-white/[0.02]">
                <input type="checkbox" checked={selCmp.has(m.id)} onChange={() => toggleCmp(m.id)} onClick={e => e.stopPropagation()} className="shrink-0" title="Elegir para comparar" />
                <button onClick={() => setAbiertoMotor(v => (v === m.id ? null : m.id))} className="flex-1 flex items-center gap-3 min-w-0">
                <span className="text-muted font-bold w-5 shrink-0">{i + 1}º</span>
                <span className="flex-1 text-left text-ink font-semibold truncate">{m.nombre}</span>
                {juzgada && (
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-emerald-500 font-bold">{m.score}%</span>
                    <span className="text-[10px] text-muted">{m.bien}✓ {m.mal}✗ {m.dudoso}?</span>
                  </span>
                )}
                {m.errores > 0 && <span className="text-[10px] text-red-500 shrink-0">{m.errores} error</span>}
                <span className="text-muted shrink-0">{money(m.costo)}</span>
                <span className="text-muted shrink-0 hidden sm:inline">{m.latencia}ms</span>
                <ChevronDown size={14} className={`text-muted transition-transform shrink-0 ${abiertoMotor === m.id ? '' : '-rotate-90'}`} />
                </button>
              </div>
              {abiertoMotor === m.id && (
                <div className="border-t border-line">
                  {m.rs.map((r, j) => (
                    <button key={j} onClick={() => onVerTranscript(r)} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left border-t border-line/50 hover:bg-primary/5">
                      {juzgada && <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${VER_BG[r.veredicto] || 'bg-muted'}`} />}
                      <span className="flex-1 text-ink truncate">{r.escenario_nombre} <span className="text-muted">· {r.caso_uso}</span></span>
                      {r.tool_calls.length > 0 && <span className="text-primary flex items-center gap-0.5 shrink-0"><Zap size={10} />{r.tool_calls.map(t => t.nombre).join(',')}</span>}
                      {r.error ? <span className="text-red-500 shrink-0">error</span> : <MessageSquare size={11} className="text-muted shrink-0" />}
                      <span className="text-muted shrink-0">{money(r.costo_usd)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ── Comparación lado a lado de motores elegidos ── */
function ComparacionMotores({ corrida, motorIds, juzgada, onVerTranscript, onClose }: {
  corrida: Corrida; motorIds: number[]; juzgada: boolean
  onVerTranscript: (r: Resultado) => void; onClose: () => void
}) {
  const res = corrida.resultados || []
  const motores = motorIds.map(id => {
    const rs = res.filter(r => r.motor_id === id)
    const bien = rs.filter(r => r.veredicto === 'bien').length
    const mal = rs.filter(r => r.veredicto === 'mal').length
    const dudoso = rs.filter(r => r.veredicto === 'dudoso').length
    const costo = rs.reduce((a, r) => a + r.costo_usd, 0)
    const latencia = rs.length ? Math.round(rs.reduce((a, r) => a + r.latencia_ms, 0) / rs.length) : 0
    const score = rs.length ? Math.round((100 * bien) / rs.length) : 0
    return { id, nombre: rs[0]?.motor_nombre || String(id), rs, bien, mal, dudoso, costo, latencia, score }
  })
  const slugs: string[] = []
  for (const r of res) if (!slugs.includes(r.escenario_slug)) slugs.push(r.escenario_slug)
  const cel = (mid: number, slug: string) => res.find(r => r.motor_id === mid && r.escenario_slug === slug)
  const camila = (r?: Resultado) => r ? r.transcript.filter(t => t.quien === 'Camila').map(t => t.texto).filter(Boolean).join('\n') : ''
  const genCols = { gridTemplateColumns: `130px repeat(${motores.length}, minmax(200px, 1fr))` }
  const escCols = { gridTemplateColumns: `repeat(${motores.length}, minmax(240px, 1fr))` }

  return (
    <div className="border-2 border-primary/50 rounded-2xl p-4 bg-primary/5 space-y-3">
      <div className="flex items-center gap-2">
        <BarChart2 size={16} className="text-primary" />
        <h3 className="text-sm font-bold text-ink flex-1">Comparación ({motores.length} motores)</h3>
        <button onClick={onClose} className="text-muted hover:text-ink"><X size={16} /></button>
      </div>

      {/* Datos generales */}
      <div className="overflow-x-auto">
        <div className="grid gap-px bg-line rounded-lg overflow-hidden text-[11px]" style={genCols}>
          <div className="bg-card px-2 py-1.5 text-muted font-semibold">Motor</div>
          {motores.map(m => <div key={m.id} className="bg-card px-2 py-1.5 text-ink font-semibold truncate">{m.nombre}</div>)}
          {juzgada && <>
            <div className="bg-card px-2 py-1.5 text-muted">Score</div>
            {motores.map(m => <div key={m.id} className="bg-card px-2 py-1.5 text-emerald-500 font-bold">{m.score}%</div>)}
            <div className="bg-card px-2 py-1.5 text-muted">Bien / Mal / Dud</div>
            {motores.map(m => <div key={m.id} className="bg-card px-2 py-1.5 text-ink">{m.bien} / {m.mal} / {m.dudoso}</div>)}
          </>}
          <div className="bg-card px-2 py-1.5 text-muted">Costo</div>
          {motores.map(m => <div key={m.id} className="bg-card px-2 py-1.5 text-ink">{money(m.costo)}</div>)}
          <div className="bg-card px-2 py-1.5 text-muted">Latencia</div>
          {motores.map(m => <div key={m.id} className="bg-card px-2 py-1.5 text-ink">{m.latencia}ms</div>)}
        </div>
      </div>

      {/* Respuestas enfrentadas por escenario */}
      <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">Respuestas en cada escenario</div>
      <div className="space-y-2">
        {slugs.map(slug => {
          const any = res.find(r => r.escenario_slug === slug)
          return (
            <div key={slug} className="border border-line rounded-lg bg-card overflow-hidden">
              <div className="px-3 py-1.5 text-[11px] font-semibold text-ink border-b border-line">
                {any?.escenario_nombre} <span className="text-muted font-normal">· {any?.caso_uso}</span>
              </div>
              <div className="overflow-x-auto">
                <div className="grid gap-px bg-line" style={escCols}>
                  {motores.map(m => {
                    const r = cel(m.id, slug)
                    return (
                      <div key={m.id} className="bg-card p-2 text-[11px]">
                        <div className="flex items-center gap-1 mb-1">
                          {juzgada && r && <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${VER_BG[r.veredicto] || 'bg-muted'}`} />}
                          <span className="text-muted font-semibold truncate flex-1">{m.nombre}</span>
                          {r && r.tool_calls.length > 0 && <span className="text-primary flex items-center gap-0.5 shrink-0"><Zap size={9} />{r.tool_calls.map(t => t.nombre).join(',')}</span>}
                        </div>
                        <div className="text-ink whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                          {r?.error ? <span className="text-red-500">Error: {r.error}</span> : (camila(r) || <span className="text-muted">—</span>)}
                        </div>
                        {juzgada && r?.detalle && <div className="text-muted mt-1 italic">Juez: {r.detalle}</div>}
                        {r && <button onClick={() => onVerTranscript(r)} className="text-primary hover:underline mt-1 flex items-center gap-0.5"><MessageSquare size={10} /> ver conversación</button>}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Resultados: tablero con 2 gráficos + tabla ── */
function ResultadosTablero({ corrida, onVerTranscript }: { corrida: Corrida; onVerTranscript: (r: Resultado) => void }) {
  const motores = Object.entries(corrida.resumen).map(([id, r]) => ({ id: Number(id), ...r }))
  const maxScore = 100
  const maxCosto = Math.max(0.0001, ...motores.map(m => m.costo_usd))
  const escenarios = [...new Set((corrida.resultados ?? []).map(r => r.escenario_slug))]

  return (
    <DashboardGrid pantalla="test-llm" defaultLayout={RESULT_LAYOUT}>
      <div key="score">
        <Widget id="score" title="Calidad por motor (% de respuestas 'bien')" fuente="openclaw">
          <svg viewBox="0 0 300 160" className="w-full h-full">
            {motores.map((m, i) => {
              const bw = 260 / motores.length - 12
              const x = 20 + i * (260 / motores.length) + 6
              const h = (m.score / maxScore) * 120
              return (
                <g key={m.id}>
                  <rect x={x} y={140 - h} width={bw} height={h} rx={3} className="fill-emerald-500" />
                  <text x={x + bw / 2} y={135 - h} textAnchor="middle" className="fill-current text-ink text-[9px]">{m.score}%</text>
                  <text x={x + bw / 2} y={152} textAnchor="middle" className="fill-current text-muted text-[7px]">{m.nombre.slice(0, 14)}</text>
                </g>
              )
            })}
          </svg>
        </Widget>
      </div>
      <div key="costo">
        <Widget id="costo" title="Costo por motor (esta comparación)" fuente="openclaw" right={<span className="text-[11px] text-muted">USD</span>}>
          <svg viewBox="0 0 300 160" className="w-full h-full">
            {motores.map((m, i) => {
              const bw = 260 / motores.length - 12
              const x = 20 + i * (260 / motores.length) + 6
              const h = (m.costo_usd / maxCosto) * 120
              return (
                <g key={m.id}>
                  <rect x={x} y={140 - h} width={bw} height={h} rx={3} className="fill-amber" />
                  <text x={x + bw / 2} y={135 - h} textAnchor="middle" className="fill-current text-ink text-[8px]">{money(m.costo_usd)}</text>
                  <text x={x + bw / 2} y={152} textAnchor="middle" className="fill-current text-muted text-[7px]">{m.nombre.slice(0, 14)}</text>
                </g>
              )
            })}
          </svg>
        </Widget>
      </div>
      <div key="tabla">
        <Widget id="tabla" title="Detalle por escenario × motor" fuente="openclaw">
          <div className="overflow-auto h-full">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-muted text-left">
                  <th className="py-1 pr-2 sticky left-0 bg-card">Escenario</th>
                  {motores.map(m => <th key={m.id} className="py-1 px-2 text-center">{m.nombre.slice(0, 16)}</th>)}
                </tr>
              </thead>
              <tbody>
                {escenarios.map(slug => {
                  const nombre = (corrida.resultados ?? []).find(r => r.escenario_slug === slug)?.escenario_nombre ?? slug
                  return (
                    <tr key={slug} className="border-t border-line">
                      <td className="py-1.5 pr-2 text-ink sticky left-0 bg-card">{nombre}</td>
                      {motores.map(m => {
                        const r = (corrida.resultados ?? []).find(x => x.escenario_slug === slug && x.motor_id === m.id)
                        if (!r) return <td key={m.id} className="text-center text-muted">—</td>
                        return (
                          <td key={m.id} className="py-1.5 px-2 text-center">
                            <button onClick={() => onVerTranscript(r)} title={r.detalle} className="inline-flex flex-col items-center gap-0.5">
                              <span className={`w-2.5 h-2.5 rounded-full ${VER_BG[r.veredicto]}`} />
                              <span className="text-[9px] text-muted">{money(r.costo_usd)}</span>
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Widget>
      </div>
    </DashboardGrid>
  )
}

/* ── Modal de transcript ── */
function TranscriptModal({ r, onClose }: { r: Resultado; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-line rounded-2xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${VER_BG[r.veredicto]}`} />
          <h3 className="text-sm font-bold text-ink flex-1">{r.escenario_nombre} — {r.motor_nombre}</h3>
          <span className={`text-xs font-semibold ${VER_COLOR[r.veredicto]}`}>{r.veredicto}</span>
        </div>
        {r.detalle && <p className="text-xs text-muted">{r.categoria && <b className="text-ink">{r.categoria}: </b>}{r.detalle}</p>}
        {r.tool_calls.length > 0 && (
          <div className="text-[11px] text-primary flex items-center gap-1 flex-wrap">
            <Zap size={12} /> {r.tool_calls.map(t => t.nombre).join(', ')}
          </div>
        )}
        <div className="space-y-1.5">
          {r.transcript.map((t, i) => (
            <div key={i} className={`text-xs rounded-lg px-3 py-2 ${t.quien === 'Cliente' ? 'bg-black/20' : 'bg-primary/10'}`}>
              <b className="text-muted">{t.quien}:</b> <span className="text-ink whitespace-pre-wrap">{t.texto}</span>
            </div>
          ))}
        </div>
        {r.error && <p className="text-xs text-red-500">Error: {r.error}</p>}
        <div className="text-[11px] text-muted">Tokens: {r.tokens_in} in / {r.tokens_out} out · {r.latencia_ms} ms</div>
        <button onClick={onClose} className="text-sm font-semibold bg-primary text-on-primary rounded-lg px-4 py-1.5 hover:bg-primary-dark">Cerrar</button>
      </div>
    </div>
  )
}

/* ── Form de alta de motor ── */
function MotorForm({ onSaved }: { onSaved: () => void }) {
  const [f, setF] = useState({
    nombre: '', provider: 'openrouter', model_id: '', base_url: 'https://openrouter.ai/api/v1',
    api_key: '', precio_in_m: '', precio_out_m: '', notas: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function guardar() {
    setBusy(true); setErr('')
    try {
      await api.post('/admin/test-llm/motores', {
        nombre: f.nombre, provider: f.provider, model_id: f.model_id, base_url: f.base_url,
        api_key: f.api_key || null,
        precio_in: (parseFloat(f.precio_in_m) || 0) / 1e6,
        precio_out: (parseFloat(f.precio_out_m) || 0) / 1e6,
        notas: f.notas,
      })
      onSaved()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const inp = 'w-full text-xs bg-transparent border border-line rounded-lg px-2.5 py-1.5 text-ink placeholder:text-muted'
  return (
    <div className="border border-line rounded-xl p-4 space-y-2 bg-black/10">
      <div className="grid md:grid-cols-2 gap-2">
        <input className={inp} placeholder="Nombre (ej: Gemini 3 Pro)" value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} />
        <input className={inp} placeholder="model_id (ej: google/gemini-3-pro)" value={f.model_id} onChange={e => setF({ ...f, model_id: e.target.value })} />
        <input className={inp} placeholder="base_url" value={f.base_url} onChange={e => setF({ ...f, base_url: e.target.value })} />
        <input className={inp} placeholder="provider (openrouter/myclaw/...)" value={f.provider} onChange={e => setF({ ...f, provider: e.target.value })} />
        <input className={inp} placeholder="precio input US$/M tokens" value={f.precio_in_m} onChange={e => setF({ ...f, precio_in_m: e.target.value })} />
        <input className={inp} placeholder="precio output US$/M tokens" value={f.precio_out_m} onChange={e => setF({ ...f, precio_out_m: e.target.value })} />
        <input className={`${inp} md:col-span-2`} placeholder="api_key propia (opcional, usa la del proveedor si va vacía)" value={f.api_key} onChange={e => setF({ ...f, api_key: e.target.value })} />
        <input className={`${inp} md:col-span-2`} placeholder="notas" value={f.notas} onChange={e => setF({ ...f, notas: e.target.value })} />
      </div>
      {err && <p className="text-[11px] text-red-500">{err}</p>}
      <button onClick={guardar} disabled={busy || !f.nombre || !f.model_id} className="text-xs font-semibold bg-primary text-on-primary rounded-lg px-3 py-1.5 hover:bg-primary-dark disabled:opacity-50">
        {busy ? 'Guardando…' : 'Agregar motor'}
      </button>
    </div>
  )
}

/* ── Form de escenario (crear / editar) ── */
function EscenarioForm({ esc, onSaved, onCancel }: { esc?: Escenario; onSaved: () => void; onCancel: () => void }) {
  const [nombre, setNombre] = useState(esc?.nombre || '')
  const [caso, setCaso] = useState(esc?.caso_uso || '')
  const [desc, setDesc] = useState(esc?.descripcion || '')
  const [guion, setGuion] = useState<string[]>(esc?.guion?.length ? [...esc.guion] : [''])
  const [tool, setTool] = useState((esc?.esperado?.tool as string) || '')
  const [conducta, setConducta] = useState((esc?.esperado?.conducta as string) || '')
  const [activo, setActivo] = useState(esc?.activo ?? true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const setTurno = (i: number, v: string) => setGuion(g => g.map((x, j) => (j === i ? v : x)))

  async function guardar() {
    setBusy(true); setErr('')
    const esperado: Record<string, string> = {}
    if (tool.trim()) esperado.tool = tool.trim()
    if (conducta.trim()) esperado.conducta = conducta.trim()
    const base = (nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 44)) || 'escenario'
    const body = {
      slug: esc?.slug || `${base}_${Math.random().toString(36).slice(2, 5)}`,
      nombre: nombre.trim(), caso_uso: caso.trim(), descripcion: desc.trim(),
      guion: guion.map(g => g.trim()).filter(Boolean),
      esperado, activo, orden: esc?.orden ?? 99,
    }
    try {
      if (esc) await api.put(`/admin/test-llm/escenarios/${esc.id}`, body)
      else await api.post('/admin/test-llm/escenarios', body)
      onSaved()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const inp = 'w-full text-xs bg-transparent border border-line rounded-lg px-2.5 py-1.5 text-ink placeholder:text-muted'
  return (
    <div className="border border-primary/40 rounded-xl p-4 space-y-2 bg-primary/5">
      <div className="text-[11px] font-semibold text-primary">{esc ? `Editar: ${esc.nombre}` : 'Nuevo escenario'}</div>
      <input className={inp} placeholder="Nombre del escenario" value={nombre} onChange={e => setNombre(e.target.value)} />
      <input className={inp} list="casos-uso" placeholder="Caso de uso (prospeccion, consulta, rechazo, interesado…)" value={caso} onChange={e => setCaso(e.target.value)} />
      <textarea className={`${inp} resize-none`} rows={2} placeholder="Descripción (qué representa este escenario)" value={desc} onChange={e => setDesc(e.target.value)} />
      <div>
        <div className="text-[11px] text-muted mb-1">Guion — mensajes del cliente, uno por turno:</div>
        {guion.map((g, i) => (
          <div key={i} className="flex items-center gap-1 mb-1">
            <span className="text-[10px] text-muted w-5 shrink-0">[{i + 1}]</span>
            <input className={inp} placeholder={`Mensaje ${i + 1} del cliente`} value={g} onChange={e => setTurno(i, e.target.value)} />
            {guion.length > 1 && <button onClick={() => setGuion(gg => gg.filter((_, j) => j !== i))} className="text-muted hover:text-red-500 shrink-0"><X size={12} /></button>}
          </div>
        ))}
        <button onClick={() => setGuion(g => [...g, ''])} className="text-[11px] text-primary hover:underline">+ turno</button>
      </div>
      <input className={inp} placeholder="Herramienta esperada (opcional: interesado, no_interesa, escalar_consulta, agendar_contacto, redireccionar)" value={tool} onChange={e => setTool(e.target.value)} />
      <textarea className={`${inp} resize-none`} rows={2} placeholder="Conducta esperada (qué debería hacer/decir Camila) — orienta al juez" value={conducta} onChange={e => setConducta(e.target.value)} />
      <label className="flex items-center gap-2 text-xs text-ink cursor-pointer"><input type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)} /> Activo (entra en las comparaciones)</label>
      {err && <p className="text-[11px] text-red-500">{err}</p>}
      <div className="flex gap-2 pt-1">
        <button onClick={guardar} disabled={busy || !nombre.trim() || guion.every(g => !g.trim())} className="text-xs font-semibold bg-primary text-on-primary rounded-lg px-3 py-1.5 hover:bg-primary-dark disabled:opacity-50">{busy ? 'Guardando…' : 'Guardar'}</button>
        <button onClick={onCancel} className="text-xs font-semibold border border-line text-muted rounded-lg px-3 py-1.5 hover:text-ink">Cancelar</button>
      </div>
      <datalist id="casos-uso">
        {['prospeccion', 'lead', 'recontacto', 'inbound', 'consulta', 'callback', 'redireccion', 'rechazo', 'interesado', 'derivacion', 'cotizacion'].map(c => <option key={c} value={c} />)}
      </datalist>
    </div>
  )
}

/* ── Catálogo OpenRouter: ranking por uso + precios + costo de testear ── */
type CatModel = {
  id: string; name: string; precio_in: number; precio_out: number
  precio_cache_read: number; precio_cache_write: number
  context: number | null; rank_uso: number | null; tokens_uso: number | null
  elo: number | null; costo_test_usd: number
}
type Catalogo = { escenarios: number; turnos_totales: number; system_tokens: number; total: number; items: CatModel[] }

function CatalogoOpenRouter({ selEsc, onAdded }: { selEsc: number[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<Catalogo | null>(null)
  const [filtro, setFiltro] = useState('')
  const [orden, setOrden] = useState('rank')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [addId, setAddId] = useState('')

  async function cargar() {
    setBusy(true); setErr('')
    try {
      setData(await api.post<Catalogo>('/admin/test-llm/catalogo', {
        source: SOURCE, escenario_ids: selEsc, filtro, orden, limit: 80,
      }))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  useEffect(() => { if (open) cargar() }, [open, orden])  // eslint-disable-line react-hooks/exhaustive-deps

  async function agregar(id: string) {
    setAddId(id); setErr('')
    try { await api.post('/admin/test-llm/motores-desde-catalogo', { model_id: id }); onAdded() }
    catch (e) { setErr((e as Error).message) } finally { setAddId('') }
  }

  const m6 = (n: number) => `$${(n * 1e6).toFixed(2)}`

  return (
    <section className="bg-card border border-line rounded-2xl p-6 space-y-3">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 text-sm font-bold text-ink">
        <TrendingUp size={16} className="text-primary" />
        Catálogo OpenRouter — ranking, precios y costo de testear
        <ChevronDown size={16} className={`ml-auto transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 border border-line rounded-lg px-2 flex-1 min-w-[180px]">
              <Search size={13} className="text-muted" />
              <input value={filtro} onChange={e => setFiltro(e.target.value)} onKeyDown={e => e.key === 'Enter' && cargar()}
                placeholder="filtrar (claude, gemini, deepseek…)" className="bg-transparent text-xs py-1.5 text-ink placeholder:text-muted flex-1 outline-none" />
            </div>
            <select value={orden} onChange={e => setOrden(e.target.value)} className="text-xs bg-transparent border border-line rounded-lg px-2 py-1.5 text-ink">
              <option value="rank">Más usados</option>
              <option value="costo">Más barato de testear</option>
              <option value="precio_in">Precio input</option>
              <option value="nombre">Nombre</option>
            </select>
            <button onClick={cargar} disabled={busy} className="flex items-center gap-1 text-xs font-semibold border border-line text-muted rounded-lg px-2.5 py-1.5 hover:text-ink disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Buscar
            </button>
          </div>
          {data && (
            <p className="text-[11px] text-muted">
              "Costo test" = correr los <b>{data.escenarios}</b> escenarios seleccionados arriba
              ({data.turnos_totales} turnos, prompt ~{data.system_tokens.toLocaleString()} tokens) en ese modelo.
              {' '}{data.total} modelos con precio.
            </p>
          )}
          {err && <p className="text-xs text-red-500">{err}</p>}
          <div className="overflow-auto max-h-[28rem]">
            <table className="w-full text-[11px]">
              <thead className="text-muted text-left sticky top-0 bg-card">
                <tr>
                  <th className="py-1 pr-2">Modelo</th>
                  <th className="py-1 px-2">Uso</th>
                  <th className="py-1 px-2 text-right">in $/M</th>
                  <th className="py-1 px-2 text-right">out $/M</th>
                  <th className="py-1 px-2 text-right">Costo test</th>
                  <th className="py-1 pl-2"></th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map(m => (
                  <tr key={m.id} className="border-t border-line">
                    <td className="py-1.5 pr-2">
                      <span className="text-ink font-medium">{m.name}</span>
                      <span className="block text-muted font-mono">{m.id}</span>
                    </td>
                    <td className="py-1.5 px-2 text-muted">{m.rank_uso ? `#${m.rank_uso}` : '—'}</td>
                    <td className="py-1.5 px-2 text-right text-ink">{m6(m.precio_in)}</td>
                    <td className="py-1.5 px-2 text-right text-ink">{m6(m.precio_out)}</td>
                    <td className="py-1.5 px-2 text-right font-semibold text-primary">{money(m.costo_test_usd)}</td>
                    <td className="py-1.5 pl-2 text-right">
                      <button onClick={() => agregar(m.id)} disabled={addId === m.id} title="Agregar como motor"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold border border-primary/50 text-primary rounded px-1.5 py-1 hover:bg-primary/10 disabled:opacity-50">
                        {addId === m.id ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

/* ── Progreso en vivo de una corrida (mientras corre) ── */
function CorridaEnVivo({ vivo, onVerTranscript }: { vivo: Corrida | null; onVerTranscript: (r: Resultado) => void }) {
  if (!vivo) return (
    <div className="text-xs text-muted flex items-center gap-2 border-t border-amber/30 pt-3">
      <Loader2 size={13} className="animate-spin text-amber" /> Iniciando la corrida…
    </div>
  )
  const total = (vivo.motores?.length || 0) * (vivo.escenarios?.length || 0)
  const res = vivo.resultados || []
  const hechas = res.length
  const pct = total ? Math.round((100 * hechas) / total) : 0
  const ultimo = res[res.length - 1]
  const escTot = vivo.escenarios?.length || 0
  const porMotor = new Map<number, { nombre: string; bien: number; mal: number; dudoso: number; res: Resultado[] }>()
  for (const r of res) {
    const g = porMotor.get(r.motor_id) || { nombre: r.motor_nombre, bien: 0, mal: 0, dudoso: 0, res: [] }
    g[r.veredicto]++; g.res.push(r); porMotor.set(r.motor_id, g)
  }
  return (
    <div className="space-y-3 border-t border-amber/30 pt-3">
      <div>
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-ink font-medium flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber animate-pulse" />
            {ultimo ? <>Procesando: <b>{ultimo.motor_nombre}</b> · {ultimo.escenario_nombre}</> : 'Arrancando…'}
          </span>
          <span className="text-muted">{hechas} / {total} celdas · {pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-black/20 overflow-hidden">
          <div className="h-full bg-amber transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="space-y-1.5">
        {[...porMotor.entries()].map(([id, g]) => (
          <div key={id} className="flex items-center gap-2 text-[11px]">
            <span className="text-ink font-medium w-40 truncate shrink-0">{g.nombre}</span>
            <span className="text-muted shrink-0 w-12">{g.res.length}/{escTot}</span>
            <div className="flex gap-0.5 flex-wrap flex-1">
              {g.res.map((r, i) => (
                <button key={i} onClick={() => onVerTranscript(r)} title={`${r.escenario_nombre}: ${r.veredicto}`}
                  className={`w-2.5 h-2.5 rounded-full ${VER_BG[r.veredicto]}`} />
              ))}
            </div>
            <span className="text-emerald-500 shrink-0">{g.bien}✓</span>
            {g.mal > 0 && <span className="text-red-500 shrink-0">{g.mal}✗</span>}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted">Se actualiza cada 3 s. Tocá un punto para ver la conversación. Cuando termine, aparece el tablero completo abajo.</p>
    </div>
  )
}
