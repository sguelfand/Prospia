import { CheckCircle2, ChevronDown, ChevronRight, Circle, Clock, FlaskConical, Play, X, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'

type Tab = 'tests' | 'historial'
type TestDetalle = { nombre: string; archivo?: string | null; estado: string; error?: string | null; duracion_ms: number }
type RunResumen = { id: number; created_at: string; origen: string; total: number; pasaron: number; fallaron: number; duracion_ms: number }
type RunDetalle = RunResumen & { detalle: TestDetalle[] }

function fmtFecha(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

// Nombre amigable de pantalla a partir del archivo de spec.
const PANTALLA: Record<string, string> = {
  'login.spec.ts': 'Login',
  'navegacion.spec.ts': 'Navegación (cliente)',
  'dashboard.spec.ts': 'Dashboard',
  'prospects.spec.ts': 'Prospects',
  'terminos.spec.ts': 'Términos',
  'configuracion.spec.ts': 'Configuración',
  'preguntas.spec.ts': 'Preguntas',
  'admin.spec.ts': 'Superadmin (N1)',
  'visual.spec.ts': 'Visual (capturas)',
}
function nombrePantalla(archivo?: string | null): string {
  if (!archivo) return 'Otros'
  return PANTALLA[archivo] ?? archivo.replace(/\.spec\.ts$/, '')
}

/**
 * Pantalla "Test visuales". Dos pestañas:
 *  - Tests: el listado de TODOS los tests (de la última corrida), agrupados por
 *    pantalla, con su último resultado y la posibilidad de correr uno o todos.
 *  - Historial: cada corrida con día/hora, resultado y el error de lo que falló.
 */
export default function TestVisuales() {
  const [tab, setTab] = useState<Tab>('tests')
  const [runs, setRuns] = useState<RunResumen[] | null>(null)
  const [det, setDet] = useState<Record<number, RunDetalle>>({})
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<number | null>(null) // historial: run abierta
  const [sel, setSel] = useState<Set<string>>(new Set())      // tests seleccionados
  const [expTest, setExpTest] = useState<Set<string>>(new Set())
  const [runNote, setRunNote] = useState<string[] | null>(null)

  useEffect(() => {
    api.get<RunResumen[]>('/admin/test-runs')
      .then((rs) => { setRuns(rs); if (rs[0]) cargarDetalle(rs[0].id) })
      .catch((e) => { setError(e instanceof Error ? e.message : 'Error'); setRuns([]) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function cargarDetalle(id: number) {
    if (det[id]) return
    try {
      const d = await api.get<RunDetalle>(`/admin/test-runs/${id}`)
      setDet((prev) => ({ ...prev, [id]: d }))
    } catch { /* noop */ }
  }

  const ultima = runs && runs[0] ? det[runs[0].id] : undefined

  // Tests de la última corrida (excluye los setup de sesión), agrupados por pantalla.
  const grupos = useMemo(() => {
    if (!ultima) return []
    const tests = ultima.detalle.filter((t) => !(t.archivo || '').endsWith('.setup.ts'))
    const map = new Map<string, TestDetalle[]>()
    for (const t of tests) {
      const p = nombrePantalla(t.archivo)
      if (!map.has(p)) map.set(p, [])
      map.get(p)!.push(t)
    }
    return [...map.entries()].map(([pantalla, ts]) => ({ pantalla, ts }))
  }, [ultima])

  const totalTests = grupos.reduce((a, g) => a + g.ts.length, 0)

  function toggleSel(n: string) {
    setSel((prev) => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s })
  }
  function toggleExp(n: string) {
    setExpTest((prev) => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s })
  }
  function correr(nombres: string[]) { if (nombres.length) setRunNote(nombres) }

  async function abrirRun(id: number) {
    if (abierto === id) { setAbierto(null); return }
    setAbierto(id)
    await cargarDetalle(id)
  }

  const tabs: [Tab, string][] = [
    ['tests', `Tests${totalTests ? ` (${totalTests})` : ''}`],
    ['historial', 'Historial'],
  ]

  return (
    <div className="max-w-4xl mx-auto pb-28">
      <div className="flex items-center gap-2 mb-1">
        <FlaskConical size={20} className="text-primary" />
        <h1 className="text-xl font-semibold text-ink">Test visuales</h1>
      </div>
      <p className="text-sm text-muted mb-5">
        Tests automáticos de la web (Playwright, manejan un navegador real, $0 de API).
        En <b>Tests</b> ves todo lo que se prueba y podés correr uno o todos; en
        <b> Historial</b>, cada corrida con su resultado y el detalle de lo que falló.
      </p>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
              tab === k ? 'bg-card border-primary text-ink' : 'border-line text-muted hover:text-ink'}`}>
            {l}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-500 mb-4">{error}</p>}
      {runs === null && <p className="text-sm text-muted">Cargando…</p>}

      {/* Nota del runner (2da etapa) */}
      {runNote && (
        <div className="bg-card border border-primary/40 rounded-xl p-4 mb-5 relative">
          <button onClick={() => setRunNote(null)} className="absolute top-3 right-3 text-muted hover:text-ink"><X size={16} /></button>
          <p className="text-sm text-ink font-medium mb-1">▶ Correr {runNote.length} test(s)</p>
          <p className="text-sm text-muted mb-2">
            Por ahora la corrida la dispara Claude desde la compu (Playwright, $0 de API);
            el botón quedará activo cuando cableemos el runner en el servidor. Tests elegidos:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {runNote.map((n) => <span key={n} className="text-[11px] px-1.5 py-0.5 rounded bg-app text-ink-soft border border-line">{n}</span>)}
          </div>
        </div>
      )}

      {/* ── TAB TESTS ── */}
      {tab === 'tests' && runs !== null && (
        <>
          {totalTests === 0 && <p className="text-sm text-muted">Todavía no hay tests registrados (falta una corrida).</p>}
          <div className="space-y-6">
            {grupos.map(({ pantalla, ts }) => {
              const ok = ts.filter((t) => t.estado === 'passed').length
              return (
                <div key={pantalla}>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">{pantalla}</h2>
                    <span className="text-xs text-muted">{ok}/{ts.length}</span>
                  </div>
                  <div className="space-y-2">
                    {ts.map((t) => {
                      const open = expTest.has(t.nombre)
                      const fail = t.estado === 'failed'
                      return (
                        <div key={t.nombre} className={`rounded-xl border bg-card ${fail ? 'border-red-500/40' : 'border-line'}`}>
                          <div className="flex items-center gap-3 p-3">
                            <input type="checkbox" checked={sel.has(t.nombre)} onChange={() => toggleSel(t.nombre)}
                              onClick={(e) => e.stopPropagation()} className="shrink-0 w-4 h-4" title="Seleccionar para correr" />
                            <button onClick={() => toggleExp(t.nombre)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                              {fail ? <XCircle size={16} className="shrink-0 text-red-500" />
                                : t.estado === 'skipped' ? <Circle size={16} className="shrink-0 text-muted" />
                                : <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />}
                              <span className={`text-sm truncate ${fail ? 'text-ink' : 'text-ink-soft'}`}>{t.nombre}</span>
                              {open ? <ChevronDown size={15} className="ml-auto shrink-0 text-muted" /> : <ChevronRight size={15} className="ml-auto shrink-0 text-muted" />}
                            </button>
                            <button onClick={() => correr([t.nombre])} title="Correr este test"
                              className="shrink-0 text-muted hover:text-primary p-1"><Play size={14} /></button>
                          </div>
                          {open && (
                            <div className="px-4 pb-3 pl-12 text-sm">
                              <div className="flex items-center gap-2 text-xs">
                                <span className="font-mono text-ink-soft">{t.archivo}</span>
                                <span className="text-muted">· {fmtDur(t.duracion_ms)}</span>
                              </div>
                              {fail && t.error && (
                                <pre className="mt-1.5 text-[11px] text-red-400 whitespace-pre-wrap break-words font-mono bg-app rounded p-2 max-h-48 overflow-auto">{t.error}</pre>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── TAB HISTORIAL ── */}
      {tab === 'historial' && runs !== null && (
        <div className="space-y-2">
          {runs.length === 0 && <p className="text-sm text-muted">Todavía no hay corridas.</p>}
          {runs.map((r) => {
            const open = abierto === r.id
            const d = det[r.id]
            const ok = r.fallaron === 0
            return (
              <div key={r.id} className={`rounded-xl border bg-card ${ok ? 'border-line' : 'border-red-500/40'}`}>
                <button onClick={() => abrirRun(r.id)} className="w-full flex items-center gap-3 p-3 text-left">
                  {ok ? <CheckCircle2 size={18} className="shrink-0 text-emerald-500" /> : <XCircle size={18} className="shrink-0 text-red-500" />}
                  <span className="text-sm text-ink font-medium">{fmtFecha(r.created_at)}</span>
                  <span className="text-xs text-muted flex items-center gap-1"><Clock size={12} />{fmtDur(r.duracion_ms)}</span>
                  <span className="ml-auto text-xs flex items-center gap-2">
                    <span className="text-emerald-500">✓ {r.pasaron}</span>
                    {r.fallaron > 0 && <span className="text-red-500 font-semibold">✗ {r.fallaron}</span>}
                    <span className="text-muted">/ {r.total}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted border border-line rounded px-1.5 py-0.5">{r.origen}</span>
                  </span>
                  {open ? <ChevronDown size={15} className="shrink-0 text-muted" /> : <ChevronRight size={15} className="shrink-0 text-muted" />}
                </button>
                {open && (
                  <div className="px-3 pb-3 space-y-1.5">
                    {!d && <p className="text-xs text-muted pl-1">Cargando detalle…</p>}
                    {d && d.detalle.map((t, i) => (
                      <div key={i} className={`rounded-lg border p-2 text-sm ${t.estado === 'failed' ? 'border-red-500/40 bg-red-500/5' : 'border-line/60'}`}>
                        <div className="flex items-center gap-2">
                          {t.estado === 'failed' ? <XCircle size={14} className="shrink-0 text-red-500" />
                            : t.estado === 'skipped' ? <Circle size={14} className="shrink-0 text-muted" />
                            : <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />}
                          <span className={`min-w-0 truncate ${t.estado === 'failed' ? 'text-ink' : 'text-ink-soft'}`}>{t.nombre}</span>
                          <span className="ml-auto shrink-0 text-xs text-muted">{fmtDur(t.duracion_ms)}</span>
                        </div>
                        {t.estado === 'failed' && t.error && (
                          <pre className="mt-1.5 text-[11px] text-red-400 whitespace-pre-wrap break-words font-mono bg-app rounded p-2 max-h-56 overflow-auto">{t.error}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Barra de acciones (solo en Tests) */}
      {tab === 'tests' && totalTests > 0 && (
        <div className="fixed bottom-0 left-0 right-0 md:left-64 bg-card/95 backdrop-blur border-t border-line p-3 flex items-center gap-3 z-20">
          <span className="text-sm text-muted">{sel.size} seleccionado(s)</span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => correr([...sel])} disabled={sel.size === 0}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-line text-ink hover:bg-app disabled:opacity-40">
              <Play size={14} /> Correr seleccionados
            </button>
            <button onClick={() => correr(grupos.flatMap((g) => g.ts.map((t) => t.nombre)))}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-primary text-on-primary hover:bg-primary-dark">
              <Play size={14} /> Correr todos
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
