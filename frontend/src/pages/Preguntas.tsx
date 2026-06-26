import { Check, CheckCircle2, Clock, Phone, Send, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'

type Estado = 'pendiente' | 'contestada'

type Consulta = {
  id: number
  fuente: string
  tenant_id: number | null
  agente: string | null
  telefono: string | null
  pregunta: string
  respuesta: string | null
  estado: Estado
  fecha: string
  fecha_respuesta: string | null
}

function fmt(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function Preguntas() {
  const [items, setItems] = useState<Consulta[]>([])
  const [filtro, setFiltro] = useState<Estado>('pendiente')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<Consulta | null>(null)
  const [selMode, setSelMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // El superadmin (nivel 1) ve TODAS las consultas (Etiguel) vía /admin; el cliente
  // (nivel 2, incl. superadmin impersonando) ve solo las suyas vía /me.
  const [base, setBase] = useState<string | null>(null)

  async function load(b: string) {
    setError(null)
    try {
      setItems(await api.get<Consulta[]>(b))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api.get<{ nivel: number }>('/auth/me')
      .then((me) => { const b = me.nivel === 1 ? '/admin/consultas' : '/me/consultas'; setBase(b); load(b) })
      .catch(() => { setBase('/me/consultas'); load('/me/consultas') })
  }, [])

  async function borrar(c: Consulta) {
    if (!base) return
    if (!confirm(`¿Borrar la consulta #${c.id}? No se puede deshacer.`)) return
    const snap = items
    setItems((prev) => prev.filter((x) => x.id !== c.id))
    try {
      await api.delete(`${base}/${c.id}`)
    } catch {
      setItems(snap)
    }
  }

  async function borrarSeleccionadas() {
    if (!base) return
    const ids = [...selected]
    if (!ids.length) return
    if (!confirm(`¿Borrar ${ids.length} consulta(s)? No se puede deshacer.`)) return
    const snap = items
    setItems((prev) => prev.filter((x) => !selected.has(x.id)))
    setSelected(new Set())
    setSelMode(false)
    try {
      await api.post(`${base}/eliminar`, { ids })
    } catch {
      setItems(snap)
    }
  }

  function toggleSel(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (loading) return <p className="text-muted text-sm">Cargando…</p>

  const visibles = items.filter((c) => c.estado === filtro)
  const n = (s: Estado) => items.filter((c) => c.estado === s).length
  const tabs: [Estado, string][] = [
    ['pendiente', `Pendientes (${n('pendiente')})`],
    ['contestada', `Contestadas (${n('contestada')})`],
  ]

  return (
    <div className="max-w-3xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold text-ink">Preguntas</h1>
        <button
          onClick={() => { setSelMode((v) => !v); setSelected(new Set()) }}
          className="text-xs font-semibold border border-line text-muted rounded-lg px-2.5 py-1.5 hover:text-ink"
        >
          {selMode ? 'Cancelar' : 'Seleccionar'}
        </button>
      </div>
      <p className="text-xs text-muted mb-4">Consultas que Camila escaló porque no supo qué responder. Contestá y la respuesta le llega al cliente.</p>

      {/* Tabs */}
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
        {visibles.map((c) => {
          const isSel = selected.has(c.id)
          return (
            <div
              key={c.id}
              onClick={() => (selMode ? toggleSel(c.id) : setAbierta(c))}
              className={`rounded-xl border-l-4 border bg-card p-4 cursor-pointer transition-colors ${
                c.estado === 'contestada' ? 'border-l-emerald-500' : 'border-l-amber'
              } ${isSel ? 'border-primary ring-1 ring-primary' : 'border-line hover:border-primary/60'}`}
            >
              <div className="flex items-center gap-2 mb-2">
                {selMode && (
                  <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${isSel ? 'bg-primary border-primary' : 'border-line'}`}>
                    {isSel && <Check size={12} className="text-on-primary" />}
                  </span>
                )}
                <span className="text-base font-extrabold text-ink">#{c.id}</span>
                {c.fuente !== 'etiguel' && <span className="text-xs font-bold text-amber">{c.fuente}</span>}
                <span className="text-[11px] text-muted">{fmt(c.fecha)}</span>
                {c.estado === 'pendiente' ? (
                  <span className="ml-auto flex items-center gap-1 text-[11px] font-bold text-amber border border-amber/50 rounded px-1.5 py-0.5"><Clock size={11} /> Pendiente</span>
                ) : (
                  <span className="ml-auto flex items-center gap-1 text-[11px] font-bold text-emerald-500 border border-emerald-500/50 rounded px-1.5 py-0.5"><CheckCircle2 size={11} /> Contestada</span>
                )}
              </div>
              <p className="text-sm text-ink whitespace-pre-wrap break-words line-clamp-3">{c.pregunta}</p>
              {c.telefono && <span className="flex items-center gap-1 text-xs text-muted mt-2"><Phone size={12} /> {c.telefono}</span>}
            </div>
          )
        })}
        {visibles.length === 0 && !error && (
          <p className="text-center text-muted text-sm py-16">
            {filtro === 'pendiente' ? 'No hay preguntas pendientes 🎉' : 'Todavía no contestaste ninguna.'}
          </p>
        )}
      </div>

      {/* Barra flotante de borrado masivo */}
      {selMode && selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-card border-t border-line px-4 md:px-6 py-3 flex items-center justify-between gap-3">
          <span className="text-sm text-ink">{selected.size === 1 ? '1 seleccionada' : `${selected.size} seleccionadas`}</span>
          <button
            onClick={borrarSeleccionadas}
            className="flex items-center gap-1.5 text-sm font-semibold bg-red-500 text-white rounded-lg px-3.5 py-2 hover:bg-red-600"
          >
            <Trash2 size={14} /> Eliminar
          </button>
        </div>
      )}

      {abierta && base && (
        <DetalleModal
          consulta={abierta}
          base={base}
          onClose={() => setAbierta(null)}
          onBorrar={() => { const c = abierta; setAbierta(null); borrar(c) }}
          onContestada={(actualizada) => {
            setItems((prev) => prev.map((x) => (x.id === actualizada.id ? actualizada : x)))
            setAbierta(null)
          }}
        />
      )}
    </div>
  )
}

function DetalleModal({ consulta, base, onClose, onBorrar, onContestada }: {
  consulta: Consulta
  base: string
  onClose: () => void
  onBorrar: () => void
  onContestada: (c: Consulta) => void
}) {
  const [respuesta, setRespuesta] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const pendiente = consulta.estado === 'pendiente'

  async function contestar() {
    const txt = respuesta.trim()
    if (!txt) return
    setEnviando(true)
    setErr(null)
    try {
      const actualizada = await api.post<Consulta>(`${base}/${consulta.id}/responder`, { respuesta: txt })
      onContestada(actualizada)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo enviar la respuesta')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/45 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-card border border-line rounded-2xl w-full max-w-xl p-6 mt-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg font-extrabold text-ink">Consulta #{consulta.id}</span>
          {consulta.telefono && <span className="flex items-center gap-1 text-xs text-muted"><Phone size={12} /> {consulta.telefono}</span>}
          <button onClick={onClose} className="ml-auto text-muted hover:text-ink"><X size={18} /></button>
        </div>

        <label className="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">Preguntó el cliente</label>
        <p className="text-sm text-ink whitespace-pre-wrap break-words bg-app border border-line rounded-lg p-3 mb-4">{consulta.pregunta}</p>

        {pendiente ? (
          <>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">Tu respuesta (se la envío a Camila para el cliente)</label>
            <textarea
              autoFocus
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
              rows={5}
              placeholder="Escribí la respuesta…"
              className="w-full bg-app border border-line text-ink rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {err && <p className="text-sm text-red-500 mt-2">{err}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={onClose} className="flex-1 text-sm font-semibold border border-line text-muted rounded-lg px-4 py-2.5 hover:text-ink">Cerrar</button>
              <button
                onClick={contestar}
                disabled={enviando || !respuesta.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold bg-primary text-on-primary rounded-lg px-4 py-2.5 disabled:opacity-50"
              >
                <Send size={14} /> {enviando ? 'Enviando…' : 'Contestar'}
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">Contestaste {consulta.fecha_respuesta ? `· ${fmt(consulta.fecha_respuesta)}` : ''}</label>
            <p className="text-sm text-ink whitespace-pre-wrap break-words bg-app border border-line rounded-lg p-3 mb-4">{consulta.respuesta}</p>
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 text-sm font-semibold border border-line text-muted rounded-lg px-4 py-2.5 hover:text-ink">Cerrar</button>
              <button onClick={onBorrar} className="flex items-center justify-center gap-1.5 text-sm font-semibold border border-line text-muted rounded-lg px-4 py-2.5 hover:border-red-500 hover:text-red-500">
                <Trash2 size={14} /> Borrar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
