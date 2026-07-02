import { Check, Flag, Loader2, Phone, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'

type Estado = 'nuevo' | 'reportado' | 'fixed'
type ColaEstado = 'pendiente' | 'procesado' | 'standby' | null

type AgentError = {
  id: number
  fuente: string
  agente: string | null
  telefono: string | null
  patron: string | null
  contenido: string
  estado: Estado
  resuelto: boolean
  fecha: string
  cola_estado?: ColaEstado
  cola_orden?: string | null
  cola_resultado?: string | null
}

type ImgAdjunta = { b64: string; mime: string; nombre: string }

function fmt(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function Errores() {
  const [errores, setErrores] = useState<AgentError[]>([])
  const [filtro, setFiltro] = useState<Estado>('nuevo')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [toast, setToast] = useState<string | null>(null)

  // Modal "Cargar error a mano"
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [nuevoTexto, setNuevoTexto] = useState('')
  const [nuevoImg, setNuevoImg] = useState<ImgAdjunta | null>(null)
  const [nuevoBusy, setNuevoBusy] = useState(false)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500) }

  const load = useCallback(async () => {
    setError(null)
    try {
      setErrores(await api.get<AgentError[]>('/admin/errores'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh mientras haya algo en la cola esperando/frenado (Claude procesando).
  const hayActivo = errores.some((e) => (e.cola_estado === 'pendiente' || e.cola_estado === 'standby'))
  useEffect(() => {
    if (!hayActivo) return
    const t = setInterval(() => { if (!document.hidden) load() }, 10000)
    return () => clearInterval(t)
  }, [hayActivo, load])

  async function setEstado(err: AgentError, estado: Estado) {
    setErrores((prev) => prev.map((e) => (e.id === err.id ? { ...e, estado } : e)))
    try {
      const upd = await api.patch<AgentError>(`/admin/errores/${err.id}`, { estado })
      setErrores((prev) => prev.map((e) => (e.id === err.id ? upd : e)))
    } catch {
      setErrores((prev) => prev.map((e) => (e.id === err.id ? err : e)))
    }
  }

  async function setCola(err: AgentError, cola_estado: ColaEstado) {
    try {
      const upd = await api.patch<AgentError>(`/admin/errores/${err.id}`, { cola_estado: cola_estado ?? '' })
      setErrores((prev) => prev.map((e) => (e.id === err.id ? upd : e)))
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo')
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

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  async function processSelected() {
    const ids = [...selected]
    if (!ids.length) return
    try {
      await api.post<AgentError[]>('/admin/errores/cola', { ids })
      setSelected(new Set())
      await load()
      showToast(`${ids.length === 1 ? '1 error enviado' : ids.length + ' errores enviados'} a la cola`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo procesar')
    }
  }

  async function eliminarSelected() {
    const ids = [...selected]
    if (!ids.length) return
    if (!confirm(`¿Borrar ${ids.length === 1 ? 'el error' : `los ${ids.length} errores`}? No se puede deshacer.`)) return
    const snap = errores
    setErrores((prev) => prev.filter((e) => !selected.has(e.id)))
    setSelected(new Set())
    try {
      await Promise.all(ids.map((id) => api.delete(`/admin/errores/${id}`)))
    } catch {
      setErrores(snap)
    }
  }

  // ── carga manual de error (texto + imagen) ──
  function leerArchivoImagen(file: File) {
    if (!file.type.startsWith('image/')) { alert('Tiene que ser una imagen.'); return }
    if (file.size > 8 * 1024 * 1024) { alert('La imagen es muy grande (máx 8MB).'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      setNuevoImg({ b64: dataUrl.split(',')[1] || '', mime: file.type || 'image/png', nombre: file.name || 'pegada.png' })
    }
    reader.readAsDataURL(file)
  }

  function onElegirImagen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) leerArchivoImagen(file)
  }

  function onPasteImagen(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData?.items || []).find((it) => it.type.startsWith('image/'))
    if (!item) return
    const file = item.getAsFile()
    if (file) { e.preventDefault(); leerArchivoImagen(file) }
  }

  function abrirNuevo() { setNuevoTexto(''); setNuevoImg(null); setNuevoOpen(true) }

  async function crearErrorManual() {
    const texto = nuevoTexto.trim()
    if ((!texto && !nuevoImg) || nuevoBusy) return
    setNuevoBusy(true)
    try {
      await api.post('/admin/errores', {
        contenido: texto,
        imagen_b64: nuevoImg?.b64 || null,
        imagen_mime: nuevoImg?.mime || 'image/png',
      })
      setNuevoOpen(false)
      await load()
      showToast('Error cargado')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo crear')
    } finally {
      setNuevoBusy(false)
    }
  }

  if (loading) return <p className="text-muted text-sm">Cargando…</p>

  const enCola = (e: AgentError) => !!e.cola_estado
  const visibles = errores.filter((e) => e.estado === filtro && !enCola(e))
  const n = (s: Estado) => errores.filter((e) => e.estado === s).length

  const tabs: [Estado, string][] = [
    ['nuevo', `Nuevos (${n('nuevo')})`],
    ['reportado', `Reportados (${n('reportado')})`],
    ['fixed', `Fixed (${n('fixed')})`],
  ]

  // Cola de procesamiento
  const ORDER: Record<string, number> = { pendiente: 0, standby: 1, procesado: 2 }
  const q = errores.filter(enCola).sort((a, b) => (ORDER[a.cola_estado!] ?? 9) - (ORDER[b.cola_estado!] ?? 9) || a.id - b.id)
  const doneN = q.filter((i) => i.cola_estado === 'procesado').length
  const pendN = q.filter((i) => i.cola_estado === 'pendiente').length
  const standbyN = q.filter((i) => i.cola_estado === 'standby').length
  const colaSettled = q.length > 0 && pendN === 0
  const colaAllDone = colaSettled && standbyN === 0
  const colaWaiting = colaSettled && standbyN > 0
  const colaPct = q.length ? Math.round((doneN / q.length) * 100) : 0

  return (
    <div className="max-w-3xl mx-auto pb-24">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="text-xl font-semibold text-ink">Errores de Camila</h1>
        <button onClick={abrirNuevo} className="flex items-center gap-1.5 bg-primary text-on-primary rounded-lg px-3 py-2 text-sm font-medium hover:bg-primary-dark">
          <Plus size={15} /> Cargar error
        </button>
      </div>
      <p className="text-xs text-muted mb-4">Los que el outbound-guard frenó (o sospechó) y los que cargás a mano. Tildá varios y «Procesar» para que los resuelva.</p>

      {/* Recuadro "Procesando" — cola de errores */}
      {q.length > 0 && (
        <div className={`rounded-2xl border p-4 mb-6 ${colaAllDone ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : colaWaiting ? 'border-amber/50 bg-amber/[0.07]' : 'border-line bg-card'}`}>
          <div className="flex items-center gap-2.5">
            {colaAllDone ? <Check size={16} className="text-emerald-500" /> : colaWaiting ? <span className="text-amber">⏸</span> : pendN ? <Loader2 size={16} className="text-primary animate-spin" /> : null}
            <span className="text-sm font-semibold text-ink">
              {colaAllDone ? (q.length === 1 ? 'Listo, resolví 1' : `Listo, resolví los ${q.length}`) : colaWaiting ? 'Resolví los que pude' : 'Procesando'}
            </span>
            <span className="text-xs text-muted font-mono ml-auto tabular-nums">{doneN}/{q.length}</span>
            <span className="w-20 h-1.5 bg-line rounded-full overflow-hidden">
              <span className="block h-full bg-primary transition-all" style={{ width: `${colaPct}%` }} />
            </span>
          </div>
          {colaAllDone && <p className="text-xs text-muted mt-2">Revisá la conclusión y dale «Confirmar» para pasarlo a Fixed.</p>}
          {colaWaiting && <p className="text-xs text-muted mt-2">{standbyN === 1 ? '1 espera' : `${standbyN} esperan`} tu info para seguir.</p>}
          <div className="mt-3 space-y-2">
            {q.map((e) => (
              <div key={e.id} className={`rounded-xl border bg-card p-3 ${e.cola_estado === 'procesado' ? 'border-emerald-500/30' : e.cola_estado === 'standby' ? 'border-amber/40' : 'border-line'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-extrabold text-ink">#{e.id}</span>
                  <span className="text-xs font-bold text-amber">{e.fuente}</span>
                  {e.cola_estado === 'pendiente' && <span className="ml-auto text-[11px] text-muted flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> en cola</span>}
                  {e.cola_estado === 'procesado' && <span className="ml-auto text-[11px] font-bold text-emerald-500">resuelto</span>}
                  {e.cola_estado === 'standby' && <span className="ml-auto text-[11px] font-bold text-amber">falta info</span>}
                </div>
                <p className="text-sm text-ink whitespace-pre-wrap break-words">{e.contenido}</p>
                {e.cola_resultado && (
                  <p className="text-xs text-muted whitespace-pre-wrap break-words mt-2 pt-2 border-t border-dashed border-line">
                    <span className="font-semibold text-ink">Conclusión: </span>{e.cola_resultado}
                  </p>
                )}
                {colaSettled && e.cola_estado === 'procesado' && (
                  <div className="flex gap-2 mt-2.5">
                    <button onClick={() => setEstado(e, 'fixed')} className="flex items-center gap-1 text-xs font-semibold border border-emerald-500/50 text-emerald-500 rounded-lg px-2.5 py-1.5 hover:bg-emerald-500/10">
                      <Check size={12} /> Confirmar (Fixed)
                    </button>
                    <button onClick={() => setCola(e, 'pendiente')} className="flex items-center gap-1 text-xs font-semibold border border-line text-muted rounded-lg px-2.5 py-1.5 hover:text-ink">
                      <RotateCcw size={12} /> Rechazar
                    </button>
                  </div>
                )}
                {colaSettled && e.cola_estado === 'standby' && (
                  <div className="flex gap-2 mt-2.5">
                    <button onClick={() => setCola(e, 'pendiente')} className="flex items-center gap-1 text-xs font-semibold border border-primary/50 text-primary rounded-lg px-2.5 py-1.5 hover:bg-primary/10">
                      <RotateCcw size={12} /> Ya te pasé la info — volver a la cola
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs por estado */}
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
        {visibles.map((e) => {
          const sel = selected.has(e.id)
          const seleccionable = e.estado !== 'fixed'
          return (
            <div
              key={e.id}
              className={`rounded-xl border-l-4 border bg-card p-4 ${sel ? 'border-primary' : 'border-line'} ${
                e.estado === 'fixed' ? 'opacity-60 border-l-emerald-500'
                : e.estado === 'reportado' ? 'border-l-red-500'
                : 'border-l-amber'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                {seleccionable && (
                  <input type="checkbox" checked={sel} onChange={() => toggleSelect(e.id)}
                    className="w-4 h-4 accent-primary cursor-pointer" title="Seleccionar para procesar" />
                )}
                <span className="text-base font-extrabold text-ink">#{e.id}</span>
                <span className="text-xs font-bold text-amber">{e.fuente}</span>
                {e.agente === 'sebi' && <span className="text-[10px] font-semibold text-muted border border-line rounded px-1.5 py-0.5">manual</span>}
                <span className="text-[11px] text-muted">{fmt(e.fecha)}</span>
                {e.estado === 'reportado' && (
                  <span className="ml-auto text-[11px] font-bold text-red-500 border border-red-500/50 rounded px-1.5 py-0.5">Reportado</span>
                )}
                {e.estado === 'fixed' && (
                  <span className="ml-auto text-[11px] font-bold text-emerald-500 border border-emerald-500/50 rounded px-1.5 py-0.5">Fixed</span>
                )}
              </div>
              <p className="text-sm text-ink whitespace-pre-wrap break-words">{e.contenido}</p>
              <div className="flex flex-wrap items-center gap-3 mt-2">
                {e.telefono && <span className="flex items-center gap-1 text-xs text-muted"><Phone size={12} /> {e.telefono}</span>}
                {e.patron && <span className="flex items-center gap-1 text-xs text-muted"><Search size={12} /> {e.patron}</span>}
              </div>
              <div className="flex gap-2 mt-3 pt-3 border-t border-dashed border-line">
                {e.estado === 'nuevo' && (
                  <button onClick={() => setEstado(e, 'reportado')} className="flex items-center gap-1 text-xs font-semibold border border-red-500/50 text-red-500 rounded-lg px-2.5 py-1.5 hover:bg-red-500/10">
                    <Flag size={12} /> Reportar
                  </button>
                )}
                {e.estado === 'reportado' && (
                  <button onClick={() => setEstado(e, 'nuevo')} className="flex items-center gap-1 text-xs font-semibold border border-line text-muted rounded-lg px-2.5 py-1.5 hover:text-ink">
                    <RotateCcw size={12} /> Quitar reporte
                  </button>
                )}
                {e.estado === 'fixed' && (
                  <button onClick={() => setEstado(e, 'nuevo')} className="flex items-center gap-1 text-xs font-semibold border border-line text-muted rounded-lg px-2.5 py-1.5 hover:text-ink">
                    <RotateCcw size={12} /> Reabrir
                  </button>
                )}
                <button onClick={() => borrar(e)} className="flex items-center gap-1 text-xs font-semibold border border-line text-muted rounded-lg px-2.5 py-1.5 hover:border-red-500 hover:text-red-500">
                  <Trash2 size={12} /> Borrar
                </button>
              </div>
            </div>
          )
        })}
        {visibles.length === 0 && !error && (
          <p className="text-center text-muted text-sm py-16">
            {filtro === 'nuevo' ? 'Sin errores nuevos 🎉' : filtro === 'reportado' ? 'No hay errores reportados.' : 'No hay errores solucionados.'}
          </p>
        )}
      </div>

      {/* Barra de procesamiento: aparece al tildar */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-card border-t border-line px-4 md:px-6 py-3 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-ink">{selected.size === 1 ? '1 seleccionado' : `${selected.size} seleccionados`}</span>
          <div className="flex gap-2">
            <button onClick={() => setSelected(new Set())} className="px-4 py-2 rounded-lg border border-line text-sm text-ink">Cancelar</button>
            <button onClick={eliminarSelected} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-red-500/50 text-red-500 text-sm font-semibold hover:bg-red-500/10">
              <Trash2 size={14} /> Eliminar
            </button>
            <button onClick={processSelected} className="px-5 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold">Procesar</button>
          </div>
        </div>
      )}

      {/* Modal cargar error a mano */}
      {nuevoOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={() => !nuevoBusy && setNuevoOpen(false)}>
          <div className="bg-card border border-line rounded-2xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()} onPaste={onPasteImagen}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-ink">Cargar error a mano</h2>
              <button onClick={() => !nuevoBusy && setNuevoOpen(false)} className="text-muted hover:text-ink"><X size={18} /></button>
            </div>
            <label className="block text-xs text-muted mb-1">¿Qué error viste?</label>
            <textarea value={nuevoTexto} onChange={(e) => setNuevoTexto(e.target.value)} rows={4} autoFocus
              placeholder="Describí el error… (o pegá una captura con Ctrl/Cmd+V)"
              className="w-full text-sm bg-transparent border border-line rounded-lg px-3 py-2 mb-3 text-ink placeholder:text-muted resize-none" />

            <label className="block text-xs text-muted mb-1">Imagen <span className="text-muted/60">(opcional)</span></label>
            {nuevoImg ? (
              <div className="flex items-center gap-2 mb-2 text-sm">
                <span className="text-ink truncate flex-1">📎 {nuevoImg.nombre}</span>
                <button onClick={() => setNuevoImg(null)} disabled={nuevoBusy} className="text-xs text-muted hover:text-red-500">Quitar</button>
              </div>
            ) : (
              <label className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-primary border border-primary/50 rounded-lg px-3 py-1.5 hover:bg-primary/10 cursor-pointer w-fit">
                <Plus size={14} /> Adjuntar imagen o pegá (Ctrl+V)
                <input type="file" accept="image/*" className="hidden" onChange={onElegirImagen} />
              </label>
            )}
            <p className="text-[11px] text-muted mb-4">Podés elegir un archivo o <span className="text-ink">pegar una captura (Ctrl/Cmd+V)</span>. La IA la lee y transcribe el error (cuesta centavos).</p>

            <div className="flex justify-end gap-2">
              <button onClick={() => setNuevoOpen(false)} disabled={nuevoBusy}
                className="text-sm font-semibold text-muted rounded-lg px-3 py-1.5 hover:text-ink disabled:opacity-50">Cancelar</button>
              <button onClick={crearErrorManual} disabled={(!nuevoTexto.trim() && !nuevoImg) || nuevoBusy}
                className="text-sm font-semibold bg-primary text-on-primary rounded-lg px-4 py-1.5 hover:bg-primary-dark disabled:opacity-50">
                {nuevoBusy ? (nuevoImg ? 'Analizando imagen…' : 'Cargando…') : 'Cargar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-ink text-app px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg">{toast}</div>}
    </div>
  )
}
