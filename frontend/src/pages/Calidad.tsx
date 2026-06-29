import { MessageSquare, Phone, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'

type Estado = 'nuevo' | 'revisado'
type Veredicto = 'acierto' | 'falso_positivo' | null

type Revision = {
  id: number
  source: string
  mirror_id: number | null
  telefono: string | null
  nombre: string | null
  fecha: string
  categoria: string
  severidad: 'alta' | 'media' | 'baja'
  titulo: string
  detalle: string
  fragmento: string
  sugerencia: string
  estado: Estado
  veredicto: Veredicto
  nota_sebi: string | null
  created_at: string | null
  revisado_at: string | null
}

type Mensaje = { id: number; direccion: 'in' | 'out'; texto: string; fecha: string }

const CAT_LABEL: Record<string, string> = {
  lead_perdido: 'Lead perdido',
  info_incorrecta: 'Info incorrecta',
  oportunidad_venta: 'Oportunidad de venta',
  tono: 'Tono',
  derivacion: 'Derivación',
  confuso: 'Confuso',
  otro: 'Otro',
}

const SEV_CLASS: Record<string, string> = {
  alta: 'border-l-red-500',
  media: 'border-l-amber',
  baja: 'border-l-sky-500',
}

export default function Calidad() {
  const [revisiones, setRevisiones] = useState<Revision[]>([])
  const [filtro, setFiltro] = useState<Estado>('nuevo')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notas, setNotas] = useState<Record<number, string>>({})
  const [conv, setConv] = useState<Record<number, Mensaje[] | 'loading'>>({})

  async function load() {
    setError(null)
    try {
      setRevisiones(await api.get<Revision[]>('/admin/calidad/revisiones'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function confirmar(r: Revision, veredicto: 'acierto' | 'falso_positivo') {
    const nota = notas[r.id]?.trim() || undefined
    const snap = revisiones
    setRevisiones((prev) => prev.map((x) => (x.id === r.id ? { ...x, estado: 'revisado', veredicto, nota_sebi: nota ?? null } : x)))
    try {
      await api.post(`/admin/calidad/revisiones/${r.id}/confirmar`, { veredicto, nota })
    } catch {
      setRevisiones(snap)
    }
  }

  async function borrar(r: Revision) {
    if (!confirm(`¿Borrar la revisión #${r.id}? No se puede deshacer.`)) return
    const snap = revisiones
    setRevisiones((prev) => prev.filter((x) => x.id !== r.id))
    try {
      await api.delete(`/admin/calidad/revisiones/${r.id}`)
    } catch {
      setRevisiones(snap)
    }
  }

  async function toggleConv(r: Revision) {
    if (!r.mirror_id) return
    if (conv[r.id]) { setConv((p) => { const n = { ...p }; delete n[r.id]; return n }); return }
    setConv((p) => ({ ...p, [r.id]: 'loading' }))
    try {
      const msgs = await api.get<Mensaje[]>(`/admin/etiguel/mirror/${r.mirror_id}/mensajes`)
      setConv((p) => ({ ...p, [r.id]: msgs }))
    } catch {
      setConv((p) => { const n = { ...p }; delete n[r.id]; return n })
    }
  }

  if (loading) return <p className="text-muted text-sm">Cargando…</p>

  const visibles = revisiones.filter((r) => r.estado === filtro)
  const n = (s: Estado) => revisiones.filter((r) => r.estado === s).length

  const tabs: [Estado, string][] = [
    ['nuevo', `Nuevas (${n('nuevo')})`],
    ['revisado', `Revisadas (${n('revisado')})`],
  ]

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold text-ink mb-1">Calidad de Camila</h1>
      <p className="text-xs text-muted mb-4">
        El especialista del negocio revisó las conversaciones y marcó respuestas que conviene mirar.
        Confirmá si Camila estuvo bien o mal — con eso el agente aprende y afina su criterio.
      </p>

      <div className="flex gap-2 mb-5">
        {tabs.map(([k, l]) => (
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
        {visibles.map((r) => (
          <div key={r.id} className={`rounded-xl border-l-4 border bg-card p-4 border-line ${
            r.estado === 'revisado' ? 'opacity-70 ' : ''
          }${SEV_CLASS[r.severidad] || 'border-l-line'}`}>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-[11px] font-bold text-amber uppercase tracking-wide">{CAT_LABEL[r.categoria] || r.categoria}</span>
              <span className="text-[11px] text-muted">· {r.severidad}</span>
              <span className="text-[11px] text-muted">· {r.fecha}</span>
              {r.estado === 'revisado' && r.veredicto === 'acierto' && (
                <span className="ml-auto text-[11px] font-bold text-red-500 border border-red-500/50 rounded px-1.5 py-0.5">Camila estuvo mal</span>
              )}
              {r.estado === 'revisado' && r.veredicto === 'falso_positivo' && (
                <span className="ml-auto text-[11px] font-bold text-emerald-500 border border-emerald-500/50 rounded px-1.5 py-0.5">Camila estuvo bien</span>
              )}
            </div>

            <p className="text-sm font-semibold text-ink mb-1">{r.titulo}</p>
            {r.detalle && <p className="text-sm text-ink/90 whitespace-pre-wrap break-words mb-2">{r.detalle}</p>}

            {r.fragmento && (
              <div className="text-xs text-muted border-l-2 border-line pl-3 py-1 my-2 whitespace-pre-wrap break-words italic">
                {r.fragmento}
              </div>
            )}

            {r.sugerencia && (
              <p className="text-xs text-sky-600 dark:text-sky-400 mb-2"><span className="font-semibold">Sugerencia:</span> {r.sugerencia}</p>
            )}

            <div className="flex flex-wrap items-center gap-3 mt-1">
              {(r.nombre || r.telefono) && (
                <span className="flex items-center gap-1 text-xs text-muted"><Phone size={12} /> {r.nombre || r.telefono}</span>
              )}
              {r.mirror_id && (
                <button onClick={() => toggleConv(r)} className="flex items-center gap-1 text-xs text-muted hover:text-ink">
                  <MessageSquare size={12} /> {conv[r.id] ? 'Ocultar' : 'Ver'} conversación
                </button>
              )}
            </div>

            {conv[r.id] === 'loading' && <p className="text-xs text-muted mt-2">Cargando conversación…</p>}
            {Array.isArray(conv[r.id]) && (
              <div className="mt-3 space-y-1.5 max-h-72 overflow-y-auto border-t border-dashed border-line pt-3">
                {(conv[r.id] as Mensaje[]).map((m) => (
                  <div key={m.id} className={`text-xs px-2.5 py-1.5 rounded-lg max-w-[85%] whitespace-pre-wrap break-words ${
                    m.direccion === 'in' ? 'bg-white/[0.04] text-ink' : 'bg-amber/15 text-ink ml-auto'
                  }`}>
                    {m.texto}
                  </div>
                ))}
              </div>
            )}

            {r.estado === 'nuevo' ? (
              <div className="mt-3 pt-3 border-t border-dashed border-line">
                <input
                  value={notas[r.id] || ''}
                  onChange={(e) => setNotas((p) => ({ ...p, [r.id]: e.target.value }))}
                  placeholder="Nota opcional (por qué) — ayuda a que el agente aprenda"
                  className="w-full text-xs bg-transparent border border-line rounded-lg px-2.5 py-1.5 mb-2 text-ink placeholder:text-muted"
                />
                <div className="flex gap-2">
                  <button onClick={() => confirmar(r, 'acierto')} className="flex items-center gap-1 text-xs font-semibold border border-red-500/50 text-red-500 rounded-lg px-2.5 py-1.5 hover:bg-red-500/10">
                    <ThumbsUp size={12} /> Camila estuvo mal (acertaste)
                  </button>
                  <button onClick={() => confirmar(r, 'falso_positivo')} className="flex items-center gap-1 text-xs font-semibold border border-emerald-500/50 text-emerald-500 rounded-lg px-2.5 py-1.5 hover:bg-emerald-500/10">
                    <ThumbsDown size={12} /> Camila estuvo bien (te equivocaste)
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-dashed border-line">
                {r.nota_sebi && <span className="text-xs text-muted italic flex-1">"{r.nota_sebi}"</span>}
                <button onClick={() => borrar(r)} className="flex items-center gap-1 text-xs font-semibold border border-line text-muted rounded-lg px-2.5 py-1.5 hover:border-red-500 hover:text-red-500 ml-auto">
                  <Trash2 size={12} /> Borrar
                </button>
              </div>
            )}
          </div>
        ))}
        {visibles.length === 0 && !error && (
          <p className="text-center text-muted text-sm py-16">
            {filtro === 'nuevo' ? 'Nada para revisar 🎉' : 'Todavía no confirmaste ninguna.'}
          </p>
        )}
      </div>
    </div>
  )
}
