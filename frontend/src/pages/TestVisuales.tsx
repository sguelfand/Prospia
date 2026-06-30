import { CheckCircle2, ChevronDown, ChevronRight, Circle, Clock, FlaskConical, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'

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

/**
 * Pantalla "Test visuales": el HISTORIAL de corridas de la suite Playwright.
 * Cada corrida muestra día/horario, resultado (✓/✗), duración y, al abrirla, el
 * resultado por test con el mensaje de error de los que fallaron.
 * (La cobertura por función vive en e2e/INVENTARIO-FUNCIONES.md; la regla es que
 * cada función de la web tenga su test → el historial es la foto de cada corrida.)
 */
export default function TestVisuales() {
  const [runs, setRuns] = useState<RunResumen[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [det, setDet] = useState<Record<number, RunDetalle>>({})
  const [abierto, setAbierto] = useState<number | null>(null)

  useEffect(() => {
    api.get<RunResumen[]>('/admin/test-runs').then(setRuns).catch((e) => {
      setError(e instanceof Error ? e.message : 'Error al cargar el historial')
      setRuns([])
    })
  }, [])

  async function abrir(id: number) {
    if (abierto === id) { setAbierto(null); return }
    setAbierto(id)
    if (!det[id]) {
      try {
        const d = await api.get<RunDetalle>(`/admin/test-runs/${id}`)
        setDet((prev) => ({ ...prev, [id]: d }))
      } catch { /* noop */ }
    }
  }

  return (
    <div className="max-w-4xl mx-auto pb-16">
      <div className="flex items-center gap-2 mb-1">
        <FlaskConical size={20} className="text-primary" />
        <h1 className="text-xl font-semibold text-ink">Test visuales</h1>
      </div>
      <p className="text-sm text-muted mb-5">
        Historial de las corridas de tests de la web (Playwright, manejan un navegador
        real, $0 de API). Tocá una corrida para ver el resultado de cada test y, si algo
        falló, el detalle del error.
      </p>

      {error && <p className="text-sm text-red-500 mb-4">{error}</p>}
      {runs === null && <p className="text-sm text-muted">Cargando…</p>}
      {runs !== null && runs.length === 0 && !error && (
        <p className="text-sm text-muted">
          Todavía no hay corridas registradas. Aparecen acá cuando se corre la suite
          (por ahora la corre Claude con <code className="text-ink-soft">npm run test:e2e:registrar</code>).
        </p>
      )}

      <div className="space-y-2">
        {(runs || []).map((r) => {
          const open = abierto === r.id
          const d = det[r.id]
          const ok = r.fallaron === 0
          return (
            <div key={r.id} className={`rounded-xl border bg-card ${ok ? 'border-line' : 'border-red-500/40'}`}>
              <button onClick={() => abrir(r.id)} className="w-full flex items-center gap-3 p-3 text-left">
                {ok
                  ? <CheckCircle2 size={18} className="shrink-0 text-emerald-500" />
                  : <XCircle size={18} className="shrink-0 text-red-500" />}
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
                  {d && d.detalle.length === 0 && <p className="text-xs text-muted pl-1">Sin detalle por test.</p>}
                  {d && d.detalle.map((t, i) => (
                    <div key={i} className={`rounded-lg border p-2 text-sm ${t.estado === 'failed' ? 'border-red-500/40 bg-red-500/5' : 'border-line/60'}`}>
                      <div className="flex items-center gap-2">
                        {t.estado === 'failed'
                          ? <XCircle size={14} className="shrink-0 text-red-500" />
                          : t.estado === 'skipped'
                            ? <Circle size={14} className="shrink-0 text-muted" />
                            : <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />}
                        <span className={`min-w-0 truncate ${t.estado === 'failed' ? 'text-ink' : 'text-ink-soft'}`}>{t.nombre}</span>
                        {t.archivo && <span className="shrink-0 text-[11px] text-muted font-mono">{t.archivo}</span>}
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
    </div>
  )
}
