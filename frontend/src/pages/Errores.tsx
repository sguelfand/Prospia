import { Check, Phone, RotateCcw, Search, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'

type AgentError = {
  id: number
  fuente: string
  agente: string | null
  telefono: string | null
  patron: string | null
  contenido: string
  resuelto: boolean
  fecha: string
}

function fmt(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function Errores() {
  const [errores, setErrores] = useState<AgentError[]>([])
  const [filtro, setFiltro] = useState<'activos' | 'solucionados'>('activos')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setError(null)
    try {
      setErrores(await api.get<AgentError[]>('/admin/errores'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function setResuelto(err: AgentError, resuelto: boolean) {
    setErrores((prev) => prev.map((e) => (e.id === err.id ? { ...e, resuelto } : e)))
    try {
      await api.patch<AgentError>(`/admin/errores/${err.id}`, { resuelto })
    } catch {
      setErrores((prev) => prev.map((e) => (e.id === err.id ? { ...e, resuelto: err.resuelto } : e)))
    }
  }

  async function borrar(err: AgentError) {
    if (!confirm(`¿Borrar el error #${err.id}? No se puede deshacer.`)) return
    const snap = errores
    setErrores((prev) => prev.filter((e) => e.id !== err.id))
    try {
      await api.delete(`/admin/errores/${err.id}`)
    } catch {
      setErrores(snap)
    }
  }

  if (loading) return <p className="text-muted text-sm">Cargando…</p>

  const visibles = errores.filter((e) => (filtro === 'activos' ? !e.resuelto : e.resuelto))
  const nActivos = errores.filter((e) => !e.resuelto).length
  const nResueltos = errores.length - nActivos

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold text-ink mb-1">Errores de Camila</h1>
      <p className="text-xs text-muted mb-4">Mensajes que el outbound-guard frenó para que los revises.</p>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {([['activos', `Activos (${nActivos})`], ['solucionados', `Solucionados (${nResueltos})`]] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setFiltro(k)}
            className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
              filtro === k ? 'bg-card border-primary text-ink' : 'border-line text-muted hover:text-ink'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      <div className="space-y-3">
        {visibles.map((e) => (
          <div key={e.id} className={`rounded-xl border-l-4 border bg-card p-4 ${e.resuelto ? 'opacity-60 border-l-emerald-500' : 'border-l-red-500'} border-line`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base font-extrabold text-ink">#{e.id}</span>
              <span className="text-xs font-bold text-amber">{e.fuente}</span>
              <span className="text-[11px] text-muted">{fmt(e.fecha)}</span>
              {e.resuelto && <span className="ml-auto text-[11px] font-bold text-emerald-500 border border-emerald-500/50 rounded px-1.5 py-0.5">resuelto</span>}
            </div>
            <p className="text-sm text-ink whitespace-pre-wrap break-words">{e.contenido}</p>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              {e.telefono && <span className="flex items-center gap-1 text-xs text-muted"><Phone size={12} /> {e.telefono}</span>}
              {e.patron && <span className="flex items-center gap-1 text-xs text-muted"><Search size={12} /> {e.patron}</span>}
            </div>
            <div className="flex gap-2 mt-3 pt-3 border-t border-dashed border-line">
              {e.resuelto ? (
                <button onClick={() => setResuelto(e, false)} className="flex items-center gap-1 text-xs font-semibold border border-line text-muted rounded-lg px-2.5 py-1.5 hover:text-ink">
                  <RotateCcw size={12} /> Reabrir
                </button>
              ) : (
                <button onClick={() => setResuelto(e, true)} className="flex items-center gap-1 text-xs font-semibold border border-emerald-500/50 text-emerald-500 rounded-lg px-2.5 py-1.5 hover:bg-emerald-500/10">
                  <Check size={12} /> Marcar solucionado
                </button>
              )}
              <button onClick={() => borrar(e)} className="flex items-center gap-1 text-xs font-semibold border border-line text-muted rounded-lg px-2.5 py-1.5 hover:border-red-500 hover:text-red-500">
                <Trash2 size={12} /> Borrar
              </button>
            </div>
          </div>
        ))}
        {visibles.length === 0 && !error && (
          <p className="text-center text-muted text-sm py-16">
            {filtro === 'activos' ? 'Sin errores activos 🎉' : 'No hay errores solucionados.'}
          </p>
        )}
      </div>
    </div>
  )
}
