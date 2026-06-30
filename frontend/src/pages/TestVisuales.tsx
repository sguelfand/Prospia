import { CheckCircle2, ChevronDown, ChevronRight, Circle, Clock, FlaskConical, Play, X, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { FUNCIONES_TEST, PANTALLAS_ORDEN, type FuncionTest, type NivelTest } from '../data/testVisuales'

type Tab = 'pendientes' | 'realizados' | 'historial'

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

function nivelLabel(n: NivelTest): string {
  if (n === 'publico') return 'público'
  if (n === 'ambos') return 'N1 + N2'
  return `N${n}`
}

export default function TestVisuales() {
  const [tab, setTab] = useState<Tab>('pendientes')
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [runNote, setRunNote] = useState<string[] | null>(null)

  // Historial de corridas
  const [runs, setRuns] = useState<RunResumen[] | null>(null)
  const [runDet, setRunDet] = useState<Record<number, RunDetalle>>({})
  const [runAbierto, setRunAbierto] = useState<number | null>(null)

  useEffect(() => {
    if (tab === 'historial' && runs === null) {
      api.get<RunResumen[]>('/admin/test-runs').then(setRuns).catch(() => setRuns([]))
    }
  }, [tab, runs])

  async function abrirRun(id: number) {
    if (runAbierto === id) { setRunAbierto(null); return }
    setRunAbierto(id)
    if (!runDet[id]) {
      try {
        const d = await api.get<RunDetalle>(`/admin/test-runs/${id}`)
        setRunDet((prev) => ({ ...prev, [id]: d }))
      } catch { /* noop */ }
    }
  }

  const total = FUNCIONES_TEST.length
  const cubiertos = useMemo(() => FUNCIONES_TEST.filter((f) => f.cubierto).length, [])
  const pct = total ? Math.round((cubiertos / total) * 100) : 0

  // Pendientes = TODAS las funciones (las cubiertas quedan marcadas, no se quitan).
  // Realizados = solo las que ya tienen test.
  const visibles = useMemo(
    () => (tab === 'realizados' ? FUNCIONES_TEST.filter((f) => f.cubierto) : FUNCIONES_TEST),
    [tab],
  )

  // Agrupar por pantalla respetando el orden definido.
  const grupos = useMemo(() => {
    const map = new Map<string, FuncionTest[]>()
    for (const f of visibles) {
      if (!map.has(f.pantalla)) map.set(f.pantalla, [])
      map.get(f.pantalla)!.push(f)
    }
    return PANTALLAS_ORDEN.filter((p) => map.has(p)).map((p) => ({ pantalla: p, fns: map.get(p)! }))
  }, [visibles])

  function toggleAbierto(id: string) {
    setAbiertos((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }
  function toggleSel(id: string) {
    setSel((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function correr(ids: string[]) {
    if (!ids.length) return
    setRunNote(ids)
  }

  const tabs: [Tab, string][] = [
    ['pendientes', `Pendientes (${total})`],
    ['realizados', `Realizados (${cubiertos})`],
    ['historial', 'Historial'],
  ]

  return (
    <div className="max-w-4xl mx-auto pb-28">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <FlaskConical size={20} className="text-primary" />
        <h1 className="text-xl font-semibold text-ink">Test visuales</h1>
      </div>
      <p className="text-sm text-muted mb-4">
        Cada función de la web con su test automático. Los tests usan Playwright (manejan
        un navegador real, $0 de API). El listado vive en <code className="text-ink-soft">e2e/INVENTARIO-FUNCIONES.md</code>.
      </p>

      {/* Progreso (no en historial) */}
      {tab !== 'historial' && (
        <div className="bg-card border border-line rounded-xl p-4 mb-5">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-ink-soft font-medium">Cobertura</span>
            <span className="text-muted">{cubiertos} de {total} funciones · {pct}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-app overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
              tab === k ? 'bg-card border-primary text-ink' : 'border-line text-muted hover:text-ink'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Nota del runner (2da etapa) */}
      {runNote && (
        <div className="bg-card border border-primary/40 rounded-xl p-4 mb-5 relative">
          <button onClick={() => setRunNote(null)} className="absolute top-3 right-3 text-muted hover:text-ink">
            <X size={16} />
          </button>
          <p className="text-sm text-ink font-medium mb-1">🔧 Correr {runNote.length} test(s) — runner en 2da etapa</p>
          <p className="text-sm text-muted mb-2">
            Por ahora estos tests los corre Claude desde la compu (Playwright, $0 de API). El botón
            quedará activo cuando cableemos el runner en el servidor. Funciones seleccionadas:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {runNote.map((id) => (
              <span key={id} className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-app text-ink-soft border border-line">{id}</span>
            ))}
          </div>
        </div>
      )}

      {/* Historial de corridas */}
      {tab === 'historial' && (
        <div className="space-y-2">
          {runs === null && <p className="text-sm text-muted">Cargando…</p>}
          {runs !== null && runs.length === 0 && (
            <p className="text-sm text-muted">
              Todavía no hay corridas registradas. Aparecen acá cuando se corre la suite
              (por ahora la corre Claude con <code className="text-ink-soft">npm run test:e2e:registrar</code>).
            </p>
          )}
          {(runs || []).map((r) => {
            const open = runAbierto === r.id
            const det = runDet[r.id]
            const ok = r.fallaron === 0
            return (
              <div key={r.id} className="rounded-xl border border-line bg-card">
                <button onClick={() => abrirRun(r.id)} className="w-full flex items-center gap-3 p-3 text-left">
                  {ok
                    ? <CheckCircle2 size={18} className="shrink-0 text-emerald-500" />
                    : <XCircle size={18} className="shrink-0 text-red-500" />}
                  <span className="text-sm text-ink font-medium">{fmtFecha(r.created_at)}</span>
                  <span className="text-xs text-muted flex items-center gap-1"><Clock size={12} />{fmtDur(r.duracion_ms)}</span>
                  <span className="ml-auto text-xs flex items-center gap-2">
                    <span className="text-emerald-500">✓ {r.pasaron}</span>
                    {r.fallaron > 0 && <span className="text-red-500">✗ {r.fallaron}</span>}
                    <span className="text-muted">/ {r.total}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted border border-line rounded px-1.5 py-0.5">{r.origen}</span>
                  </span>
                  {open ? <ChevronDown size={15} className="shrink-0 text-muted" /> : <ChevronRight size={15} className="shrink-0 text-muted" />}
                </button>
                {open && (
                  <div className="px-3 pb-3 space-y-1.5">
                    {!det && <p className="text-xs text-muted pl-1">Cargando detalle…</p>}
                    {det && det.detalle.length === 0 && <p className="text-xs text-muted pl-1">Sin detalle por test.</p>}
                    {det && det.detalle.map((t, i) => (
                      <div key={i} className={`rounded-lg border p-2 text-sm ${t.estado === 'failed' ? 'border-red-500/40 bg-red-500/5' : 'border-line/60'}`}>
                        <div className="flex items-center gap-2">
                          {t.estado === 'failed'
                            ? <XCircle size={14} className="shrink-0 text-red-500" />
                            : t.estado === 'skipped'
                              ? <Circle size={14} className="shrink-0 text-muted" />
                              : <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />}
                          <span className={`min-w-0 truncate ${t.estado === 'failed' ? 'text-ink' : 'text-ink-soft'}`}>{t.nombre}</span>
                          <span className="ml-auto shrink-0 text-xs text-muted">{fmtDur(t.duracion_ms)}</span>
                        </div>
                        {t.estado === 'failed' && t.error && (
                          <pre className="mt-1.5 text-[11px] text-red-400 whitespace-pre-wrap break-words font-mono bg-app rounded p-2 max-h-48 overflow-auto">{t.error}</pre>
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

      {/* Lista agrupada (pendientes / realizados) */}
      {tab !== 'historial' && (
      <div className="space-y-6">
        {grupos.map(({ pantalla, fns }) => {
          const cub = fns.filter((f) => f.cubierto).length
          return (
            <div key={pantalla}>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">{pantalla}</h2>
                <span className="text-xs text-muted">{cub}/{fns.length}</span>
              </div>
              <div className="space-y-2">
                {fns.map((f) => {
                  const open = abiertos.has(f.id)
                  return (
                    <div
                      key={f.id}
                      className={`rounded-xl border bg-card ${f.cubierto ? 'border-line' : 'border-line/70'}`}
                    >
                      <div className="flex items-center gap-3 p-3">
                        <input
                          type="checkbox"
                          checked={sel.has(f.id)}
                          onChange={() => toggleSel(f.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 w-4 h-4 accent-[var(--color-primary,#3b82f6)]"
                          title="Seleccionar para correr"
                        />
                        <button
                          onClick={() => toggleAbierto(f.id)}
                          className="flex items-center gap-2 min-w-0 flex-1 text-left"
                        >
                          {f.cubierto
                            ? <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />
                            : <Circle size={16} className="shrink-0 text-muted" />}
                          <span className={`text-sm truncate ${f.cubierto ? 'text-ink' : 'text-ink-soft'}`}>{f.nombre}</span>
                          <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted border border-line rounded px-1.5 py-0.5">{nivelLabel(f.nivel)}</span>
                          {open ? <ChevronDown size={15} className="shrink-0 text-muted" /> : <ChevronRight size={15} className="shrink-0 text-muted" />}
                        </button>
                      </div>
                      {open && (
                        <div className="px-4 pb-3 pt-0 pl-12 text-sm">
                          <p className="text-muted">{f.descripcion}</p>
                          <div className="mt-2 flex items-center gap-2 text-xs">
                            <span className="font-mono text-ink-soft">{f.id}</span>
                            {f.cubierto
                              ? <span className="text-emerald-500">✓ test en <code>{f.archivoTest}</code></span>
                              : <span className="text-amber-500">sin test todavía</span>}
                          </div>
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
      )}

      {/* Barra de acciones fija (no en historial) */}
      {tab !== 'historial' && (
      <div className="fixed bottom-0 left-0 right-0 md:left-64 bg-card/95 backdrop-blur border-t border-line p-3 flex items-center gap-3 z-20">
        <span className="text-sm text-muted">{sel.size} seleccionado(s)</span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => correr([...sel])}
            disabled={sel.size === 0}
            className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-line text-ink hover:bg-app disabled:opacity-40"
          >
            <Play size={14} /> Correr seleccionados
          </button>
          <button
            onClick={() => correr(visibles.map((f) => f.id))}
            className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-primary text-on-primary hover:bg-primary-dark"
          >
            <Play size={14} /> Correr todos
          </button>
        </div>
      </div>
      )}
    </div>
  )
}
