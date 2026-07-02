import { AlertTriangle, ChevronDown, Cpu, DollarSign, Loader2, Play, Plus, RefreshCw, Search, ShieldAlert, TrendingUp, Trash2, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { DashboardGrid, Widget, buildLayouts } from '../components/DashboardGrid'

const SOURCE = 'etiguel'

type Sobre = { system_chars?: number; modelo_actual?: string | null; archivos?: string[]; error?: string }
type Estado = {
  habilitado: boolean
  keys: Record<string, boolean>
  motores: number
  escenarios: number
  sobre: Sobre
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
  por_motor: { motor_id: number; nombre: string; costo_usd: number }[]
  juez_costo_usd: number; total_usd: number; nota: string
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
  const [transcript, setTranscript] = useState<Resultado | null>(null)
  const [runId, setRunId] = useState<number | null>(null)   // corrida en curso (polling en vivo)
  const [vivo, setVivo] = useState<Corrida | null>(null)    // último snapshot polleado

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
      await api.post(`/admin/test-llm/corridas/${cor.id}/correr`)
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
        if (d.estado === 'lista' || d.estado === 'error') {
          setRunId(null)
          if (d.estado === 'lista') setAbierta(d)
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
            <div className="text-xs text-ink flex items-center gap-3 flex-wrap">
              <span className="font-bold text-base text-primary">{money(costoTotalSel)}</span>
              <span className="text-muted">
                {estimacion.motores} motores × {estimacion.escenarios} escenarios · {estimacion.turnos_totales} turnos ·
                juez {money(estimacion.juez_costo_usd)}
              </span>
            </div>
          )}
          <button
            onClick={crearYCorrer}
            disabled={busy || runId != null || selMot.size === 0 || selEsc.size === 0 || !estado?.habilitado}
            title={!estado?.habilitado ? 'Habilitá "Correr" arriba (consume tokens)' : undefined}
            className="ml-auto flex items-center gap-1.5 text-sm font-semibold bg-emerald-500 text-white rounded-lg px-4 py-2 hover:bg-emerald-600 disabled:opacity-40"
          >
            {(busy || runId != null) ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {runId != null ? 'Corriendo…' : 'Correr comparación'}
          </button>
        </div>
        {runId != null
          ? <CorridaEnVivo vivo={vivo} onVerTranscript={setTranscript} />
          : !estado?.habilitado && (
            <p className="text-[11px] text-muted flex items-center gap-1"><ShieldAlert size={12} /> "Correr" está bloqueado hasta que habilites el switch. Podés estimar el costo sin gastar nada.</p>
          )}
      </section>

      {/* Catálogo OpenRouter: ranking + precios + costo de testear */}
      <CatalogoOpenRouter selEsc={[...selEsc]} onAdded={cargar} />

      {/* Escenarios (detalle colapsable) */}
      <section className="bg-card border border-line rounded-2xl p-6">
        <button onClick={() => setShowEsc(v => !v)} className="w-full flex items-center justify-between text-sm font-bold text-ink">
          Banco de escenarios ({escenarios.length})
          <ChevronDown size={16} className={`transition-transform ${showEsc ? '' : '-rotate-90'}`} />
        </button>
        {showEsc && (
          <div className="mt-4 space-y-2">
            {escenarios.map(e => (
              <div key={e.id} className="border border-line rounded-lg px-3 py-2 text-xs">
                <div className="font-semibold text-ink">{e.nombre} <span className="text-muted font-normal">· {e.caso_uso}</span></div>
                <div className="text-muted">{e.descripcion}</div>
                <div className="text-ink/70 mt-1 font-mono">{e.guion.map((g, i) => `[${i + 1}] ${g}`).join('  ')}</div>
              </div>
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
            <button key={c.id} onClick={() => abrirCorrida(c.id)} className={`w-full flex items-center gap-3 text-left border rounded-lg px-3 py-2 text-xs hover:border-primary/40 ${abierta?.id === c.id ? 'border-primary/50 bg-primary/5' : 'border-line'}`}>
              <span className={`w-2 h-2 rounded-full ${c.estado === 'lista' ? 'bg-emerald-500' : c.estado === 'estimada' ? 'bg-amber' : c.estado === 'error' ? 'bg-red-500' : 'bg-muted'}`} />
              <span className="flex-1 text-ink font-medium">{c.nombre}</span>
              <span className="text-muted">{c.motores.length} motores · {c.escenarios.length} esc.</span>
              <span className="text-muted">{c.estado === 'lista' ? `real ${money(c.costo_real_usd)}` : `est. ${money(c.costo_estimado_usd)}`}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Resultados de la corrida abierta — tablero movible */}
      {abierta && abierta.estado === 'lista' && (
        <ResultadosTablero corrida={abierta} onVerTranscript={setTranscript} />
      )}

      {transcript && <TranscriptModal r={transcript} onClose={() => setTranscript(null)} />}
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
