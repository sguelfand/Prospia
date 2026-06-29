import { Check, Copy, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

// ── Tipos ────────────────────────────────────────────────────────────────────
type Prioridad = 'alta' | 'media' | 'baja'
type Area = 'app' | 'web' | 'etiguel'
type ColaEstado = 'pendiente' | 'procesado' | 'standby' | null

type Pendiente = {
  id: number
  texto: string
  prioridad: Prioridad
  area: Area
  hecho: boolean
  fecha: string | null
  contexto?: string | null
  que_armar?: string | null
  consideraciones?: string | null
  depende?: string | null
  alcance?: string | null
  cola_estado?: ColaEstado
  cola_orden?: string | null
  cola_resultado?: string | null
}

const AREA_LABELS: Record<Area, string> = { app: 'App (Prospia Admin)', web: 'Web / Plataforma', etiguel: 'Etiguel / Scraper' }
const AREA_ORDER: Area[] = ['app', 'web', 'etiguel']
const SECTION_LABELS: Record<string, string> = { contexto: 'Contexto / Por qué', que_armar: 'Qué hay que armar', consideraciones: 'Consideraciones / Riesgos', depende: 'Depende de', alcance: 'Alcance a futuro' }
const LIST_SECTIONS = ['que_armar', 'consideraciones', 'depende']
const SECTION_ORDER = ['contexto', 'que_armar', 'consideraciones', 'depende', 'alcance'] as const
const PRIO_LABELS: Record<Prioridad, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' }
const PRIO_RANK: Record<Prioridad, number> = { alta: 0, media: 1, baja: 2 }
const COLA_LABELS: Record<string, string> = { pendiente: 'En cola', procesado: 'Realizado · sin confirmar', standby: 'En espera · falta info' }
const COLA_COLOR: Record<string, string> = { pendiente: '#7FA6F0', procesado: '#F5B23D', standby: '#EBC944' }
const PRIO_COLOR: Record<Prioridad, string> = { alta: '#E5664D', media: '#F5B23D', baja: '#8294B4' }

// Separa "[DEP.1] Texto" → { badge, title }
function splitBadge(texto: string) {
  const m = /^\[([^\]]+)\]\s*(.*)$/s.exec(texto || '')
  return m ? { badge: m[1], title: m[2] } : { badge: null as string | null, title: texto || '' }
}

export default function Pendientes() {
  const [items, setItems] = useState<Pendiente[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'pending' | 'done' | 'all'>('pending')
  const [areaFilter, setAreaFilter] = useState<Area | ''>('')
  const [orden, setOrden] = useState<'fecha' | 'prioridad'>('fecha')
  const [vista, setVista] = useState<'areas' | 'todas'>('todas')
  const [openIds, setOpenIds] = useState<Record<number, boolean>>({})
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [modal, setModal] = useState<{ editing: Pendiente | null; rejecting: boolean } | null>(null)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2800)
  }

  const load = useCallback(async () => {
    try {
      setItems(await api.get<Pendiente[]>('/admin/pendientes?incluir_hechos=true'))
    } catch (e) {
      if (e instanceof Error) showToast('No se pudo cargar: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh cada 10s mientras haya algo ACTIVO en la cola (pendiente o
  // standby): los círculos se llenan solos y se ve el cambio en vivo cuando
  // Claude procesa o reactiva un standby.
  const hayActivo = items.some((i) => (i.cola_estado === 'pendiente' || i.cola_estado === 'standby') && !i.hecho)
  useEffect(() => {
    if (!hayActivo) return
    const t = setInterval(() => { if (!document.hidden) load() }, 10000)
    return () => clearInterval(t)
  }, [hayActivo, load])

  // ── Acciones ──
  const patch = async (id: number, body: Omit<Partial<Pendiente>, 'cola_estado'> & { cola_estado?: ColaEstado | '' }) => {
    const upd = await api.patch<Pendiente>(`/admin/pendientes/${id}`, body)
    setItems((prev) => prev.map((p) => (p.id === id ? upd : p)))
    return upd
  }
  const marcarRealizado = (it: Pendiente) => patch(it.id, { hecho: true }).then(() => showToast('Marcado como realizado')).catch((e) => showToast(e.message))
  const reabrir = (it: Pendiente) => patch(it.id, { hecho: false }).catch((e) => showToast(e.message))
  const dequeue = (it: Pendiente) => patch(it.id, { cola_estado: '' }).catch((e) => showToast(e.message))
  // Reactivar un standby: vuelve a 'pendiente' al instante (ya pasaste la info).
  const reactivar = (it: Pendiente) => patch(it.id, { cola_estado: 'pendiente' }).then(() => showToast('Volvió a la cola')).catch((e) => showToast(e.message))
  const rechazar = (it: Pendiente) => setModal({ editing: it, rejecting: true })

  const del = async (it: Pendiente) => {
    const { title } = splitBadge(it.texto)
    if (!confirm('¿Borrar este pendiente?\n\n' + title)) return
    try {
      await api.delete(`/admin/pendientes/${it.id}`)
      setItems((prev) => prev.filter((p) => p.id !== it.id))
      setSelected((prev) => { const n = new Set(prev); n.delete(it.id); return n })
    } catch (e) { if (e instanceof Error) showToast(e.message) }
  }

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const processSelected = async () => {
    const ids = [...selected]
    if (!ids.length) return
    try {
      const cola = await api.post<Pendiente[]>('/admin/pendientes/cola', { ids })
      const byId = new Map(cola.map((c) => [c.id, c]))
      setItems((prev) => prev.map((p) => byId.get(p.id) ?? p))
      setSelected(new Set())
      showToast(`${ids.length === 1 ? '1 pendiente enviado' : ids.length + ' pendientes enviados'} a la cola`)
    } catch (e) { if (e instanceof Error) showToast(e.message) }
  }

  // Borrar todos los seleccionados (con confirmación).
  const eliminarSelected = async () => {
    const ids = [...selected]
    if (!ids.length) return
    if (!confirm(`¿Eliminar ${ids.length} pendiente(s)? No se puede deshacer.`)) return
    setItems((prev) => prev.filter((p) => !selected.has(p.id)))
    setSelected(new Set())
    try {
      await Promise.all(ids.map((id) => api.delete(`/admin/pendientes/${id}`)))
    } catch (e) { if (e instanceof Error) showToast(e.message) }
  }

  const copyItem = async (it: Pendiente) => {
    const { badge, title } = splitBadge(it.texto)
    let out = (badge ? `[${badge}] ` : '') + title + '\n' + `Prioridad: ${it.prioridad} · Área: ${it.area}\n`
    for (const k of SECTION_ORDER) {
      const v = it[k]
      if (!v) continue
      out += `\n${SECTION_LABELS[k]}:\n`
      out += LIST_SECTIONS.includes(k)
        ? v.split('\n').map((s) => s.trim()).filter(Boolean).map((l) => `- ${l}`).join('\n') + '\n'
        : v + '\n'
    }
    try { await navigator.clipboard.writeText(out.trim()); showToast('Copiado') } catch { showToast('No se pudo copiar') }
  }

  const onSaved = (saved: Pendiente, wasNew: boolean) => {
    setItems((prev) => (wasNew ? [saved, ...prev] : prev.map((p) => (p.id === saved.id ? saved : p))))
    if (wasNew) setFilter('pending')
  }

  // ── Datos derivados ──
  const visible = (it: Pendiente) => {
    if (areaFilter && it.area !== areaFilter) return false
    if (filter === 'pending') return !it.hecho
    if (filter === 'done') return it.hecho
    return true
  }
  const enCola = (i: Pendiente) => !!i.cola_estado && !i.hecho
  const done = items.filter((i) => i.hecho).length
  const total = items.length

  const fechaMs = (p: Pendiente) => (p.fecha ? new Date(p.fecha).getTime() : 0)
  const cmp = (a: Pendiente, b: Pendiente) =>
    orden === 'prioridad'
      ? (PRIO_RANK[a.prioridad] ?? 3) - (PRIO_RANK[b.prioridad] ?? 3) || fechaMs(b) - fechaMs(a)
      : fechaMs(b) - fechaMs(a) || b.id - a.id

  const queued = items.filter(enCola)
  const ORDER: Record<string, number> = { pendiente: 0, procesado: 1, standby: 2 }
  const q = [...queued].sort((a, b) => (ORDER[a.cola_estado!] ?? 9) - (ORDER[b.cola_estado!] ?? 9) || b.id - a.id)
  const doneN = q.filter((i) => i.cola_estado === 'procesado').length
  const pendN = q.filter((i) => i.cola_estado === 'pendiente').length
  const standbyN = q.filter((i) => i.cola_estado === 'standby').length
  const colaSettled = q.length > 0 && pendN === 0
  const colaAllDone = colaSettled && standbyN === 0
  const colaWaiting = colaSettled && standbyN > 0
  const colaPct = q.length ? Math.round((doneN / q.length) * 100) : 0
  const mostrarCola = filter !== 'done' && q.length > 0

  if (loading) return <p className="text-muted text-sm">Cargando…</p>

  const itemCtx: ItemCtx = { openIds, setOpenIds, selected, toggleSelect, colaSettled, marcarRealizado, reabrir, rechazar, reactivar, dequeue, copyItem, del, openEdit: (it: Pendiente) => setModal({ editing: it, rejecting: false }) }

  return (
    <div className="max-w-4xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="text-xl font-semibold text-ink">Pendientes</h1>
        <button onClick={() => setModal({ editing: null, rejecting: false })} className="flex items-center gap-1.5 bg-primary text-on-primary rounded-lg px-3 py-2 text-sm font-medium hover:bg-primary-dark">
          Nuevo
        </button>
      </div>
      <p className="text-xs text-muted mb-3">Tildá a la izquierda para elegir cuáles procesar; usá «Realizado» para darlos por hechos.</p>

      {/* Progreso */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-1.5 bg-line rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <span className="text-xs text-muted font-mono tabular-nums">{done} / {total}</span>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {([['pending', 'Pendientes'], ['done', 'Hechas'], ['all', 'Todas']] as const).map(([k, l]) => (
          <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>{l}</Chip>
        ))}
        <span className="w-px bg-line mx-1.5 my-0.5" />
        {([['', 'Todas las áreas'], ['app', 'App'], ['web', 'Web'], ['etiguel', 'Etiguel']] as const).map(([k, l]) => (
          <Chip key={k || 'all'} active={areaFilter === k} onClick={() => setAreaFilter(k as Area | '')}>{l}</Chip>
        ))}
      </div>

      {/* Orden */}
      <div className="flex items-center gap-1.5 mb-5">
        <span className="text-xs text-muted mr-1">Ordenar:</span>
        {([['fecha', 'Fecha'], ['prioridad', 'Prioridad']] as const).map(([k, l]) => (
          <Chip key={k} active={orden === k} onClick={() => setOrden(k)}>{l}</Chip>
        ))}
        <span className="w-px bg-line mx-1.5 my-0.5" />
        <span className="text-xs text-muted mr-1">Vista:</span>
        {([['areas', 'Por áreas'], ['todas', 'Todas juntas']] as const).map(([k, l]) => (
          <Chip key={k} active={vista === k} onClick={() => setVista(k)}>{l}</Chip>
        ))}
      </div>

      {/* Recuadro "Procesando" */}
      {mostrarCola && (
        <div className={`rounded-2xl border p-4 mb-6 ${colaAllDone ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : colaWaiting ? 'border-amber/50 bg-amber/[0.07]' : 'border-line bg-card'}`}>
          <div className="flex items-center gap-2.5">
            {colaAllDone ? <Check size={16} className="text-emerald-500" /> : colaWaiting ? <span className="text-amber">⏸</span> : pendN ? <Spinner /> : null}
            <span className="text-sm font-semibold text-ink">
              {colaAllDone ? (q.length === 1 ? 'Listo, terminé 1' : `Listo, terminé los ${q.length}`) : colaWaiting ? 'Terminé los que pude' : 'Procesando'}
            </span>
            <span className="text-xs text-muted font-mono ml-auto tabular-nums">{doneN}/{q.length}</span>
            <span className="w-20 h-1.5 bg-line rounded-full overflow-hidden">
              <span className="block h-full bg-primary transition-all" style={{ width: `${colaPct}%` }} />
            </span>
          </div>
          {colaAllDone && <p className="text-xs text-muted mt-2">Revisá y dale «Realizado» a cada uno para pasarlo a Realizados.</p>}
          {colaWaiting && <p className="text-xs text-muted mt-2">{standbyN === 1 ? '1 espera' : `${standbyN} esperan`} tu info para seguir. Dale «Realizado» a los que ya están listos.</p>}
          <div className="mt-3 space-y-2">
            {q.map((it) => <ItemCard key={it.id} it={it} ctx={itemCtx} />)}
          </div>
        </div>
      )}

      {/* Lista de pendientes: todas juntas o agrupadas por área */}
      {vista === 'todas' ? (
        (() => {
          const lista = items.filter((i) => visible(i) && !enCola(i)).sort(cmp)
          if (!lista.length) return null
          return <div className="space-y-2 mb-7">{lista.map((it) => <ItemCard key={it.id} it={it} ctx={itemCtx} />)}</div>
        })()
      ) : (
        AREA_ORDER.map((area) => {
          const group = items.filter((i) => visible(i) && i.area === area && !enCola(i)).sort(cmp)
          if (!group.length) return null
          return (
            <div key={area} className="mb-7">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2 px-1">{AREA_LABELS[area]}</p>
              <div className="space-y-2">{group.map((it) => <ItemCard key={it.id} it={it} ctx={itemCtx} />)}</div>
            </div>
          )
        })
      )}

      {!mostrarCola && !items.some((i) => visible(i) && !enCola(i)) && (
        <p className="text-center text-muted text-sm py-16">Nada que mostrar en este filtro</p>
      )}

      {/* Barra de procesamiento: aparece al tildar uno o más */}
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

      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-ink text-app px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg">{toast}</div>}

      {modal && (
        <FormModal
          editing={modal.editing}
          rejecting={modal.rejecting}
          onClose={() => setModal(null)}
          onSaved={onSaved}
          areaFilter={areaFilter}
        />
      )}
    </div>
  )
}

// ── Subcomponentes ────────────────────────────────────────────────────────────
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${active ? 'bg-ink text-app border-ink' : 'bg-card text-muted border-line hover:text-ink'}`}>
      {children}
    </button>
  )
}

function Spinner() {
  return <span className="inline-block w-3.5 h-3.5 border-2 border-line border-t-primary rounded-full animate-spin" />
}

function ColaDot({ estado }: { estado: string }) {
  const color = COLA_COLOR[estado] ?? '#8294B4'
  if (estado === 'procesado') return <span className="inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0" style={{ background: color }}><Check size={11} className="text-app" /></span>
  if (estado === 'standby') return <span className="inline-block w-4 h-4 rounded-full border-2 border-dashed shrink-0" style={{ borderColor: color }} />
  return <span className="inline-block w-4 h-4 rounded-full border-2 border-t-transparent animate-spin shrink-0" style={{ borderColor: color, borderTopColor: 'transparent' }} />
}

type ItemCtx = {
  openIds: Record<number, boolean>
  setOpenIds: React.Dispatch<React.SetStateAction<Record<number, boolean>>>
  selected: Set<number>
  toggleSelect: (id: number) => void
  colaSettled: boolean
  marcarRealizado: (it: Pendiente) => void
  reabrir: (it: Pendiente) => void
  rechazar: (it: Pendiente) => void
  reactivar: (it: Pendiente) => void
  dequeue: (it: Pendiente) => void
  copyItem: (it: Pendiente) => void
  del: (it: Pendiente) => void
  openEdit: (it: Pendiente) => void
}

function ItemCard({ it, ctx }: { it: Pendiente; ctx: ItemCtx }) {
  const { badge, title } = splitBadge(it.texto)
  const open = !!ctx.openIds[it.id]
  const cola = it.cola_estado
  const isSel = ctx.selected.has(it.id)
  const fecha = it.fecha ? new Date(it.fecha).toLocaleDateString('es-AR') : ''
  const sections = SECTION_ORDER.filter((k) => it[k])

  // El checkbox de la izquierda = seleccionar para procesar. Solo para pendientes
  // normales sin encolar. Los que están en la cola muestran su círculo de estado.
  const seleccionable = !it.hecho && !cola
  // Misma lógica que la app: pendiente normal → "Realizado"; procesado (cuando la
  // cola terminó) → "Confirmar" + "Rechazar"; standby → "Volver a la cola".
  const esNormal = !it.hecho && !cola
  const esConfirmar = !it.hecho && cola === 'procesado' && ctx.colaSettled
  const esVolverCola = cola === 'standby' && ctx.colaSettled
  const [showConcl, setShowConcl] = useState(false)
  const toggleOpen = () => ctx.setOpenIds((p) => ({ ...p, [it.id]: !p[it.id] }))

  return (
    <div className={`rounded-xl border bg-card overflow-hidden transition-colors ${isSel ? 'border-primary ring-1 ring-primary' : 'border-line'} ${it.hecho ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2.5 px-4 py-3">
        {seleccionable ? (
          <button
            onClick={() => ctx.toggleSelect(it.id)}
            title="Seleccionar para procesar"
            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${isSel ? 'bg-primary border-primary' : 'border-line hover:border-primary'}`}
          >
            {isSel && <Check size={12} className="text-on-primary" />}
          </button>
        ) : cola ? (
          <ColaDot estado={cola} />
        ) : (
          <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 bg-emerald-500"><Check size={12} className="text-white" /></span>
        )}

        <div className={`flex-1 flex gap-2 cursor-pointer min-w-0 ${open ? 'items-start' : 'items-center'}`} onClick={toggleOpen}>
          <span className={`font-mono text-[11px] font-bold text-muted tabular-nums shrink-0 ${open ? 'mt-0.5' : ''}`}>#{it.id}</span>
          {badge && <span className={`font-mono text-[11px] bg-primary-soft text-accent px-1.5 py-0.5 rounded shrink-0 ${open ? 'mt-px' : ''}`}>{badge}</span>}
          <span className={`flex-1 text-sm text-ink ${open ? 'whitespace-pre-wrap break-words' : 'truncate'} ${it.hecho ? 'line-through' : ''}`}>{title}</span>
        </div>

        {/* Estado de cola inline solo mientras NO hay acciones abajo (p.ej. spinner "En cola").
            Cuando la cola terminó (procesado/standby), el estado y los botones van debajo. */}
        {cola && !esConfirmar && !esVolverCola && <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded shrink-0" style={{ color: COLA_COLOR[cola], background: COLA_COLOR[cola] + '22' }}>{COLA_LABELS[cola] ?? cola}</span>}
        {esNormal && (
          <button
            onClick={() => ctx.marcarRealizado(it)}
            className="flex items-center gap-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-md px-2.5 py-1 shrink-0"
          >
            <Check size={13} /> Realizado
          </button>
        )}
        {it.hecho && (
          <button onClick={() => ctx.reabrir(it)} title="Reabrir" className="flex items-center gap-1 text-[11px] font-semibold text-muted border border-line rounded-md px-2 py-1 shrink-0 hover:text-ink">
            <RotateCcw size={12} /> Reabrir
          </button>
        )}
        <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded shrink-0 hidden sm:inline" style={{ color: PRIO_COLOR[it.prioridad], background: PRIO_COLOR[it.prioridad] + '22' }}>{PRIO_LABELS[it.prioridad]}</span>
        <button onClick={toggleOpen} className={`text-muted text-[11px] transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}>▼</button>
      </div>

      {/* Estado + acciones de cola DEBAJO (cola terminada): así la descripción de
          arriba ocupa todo el ancho en vez de competir con los botones a la derecha. */}
      {(esConfirmar || esVolverCola) && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3" style={{ paddingLeft: '2.6rem' }}>
          {cola && <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded shrink-0" style={{ color: COLA_COLOR[cola], background: COLA_COLOR[cola] + '22' }}>{COLA_LABELS[cola] ?? cola}</span>}
          {esVolverCola && (
            <button
              onClick={() => ctx.reactivar(it)}
              title="Ya te pasé la info — volver a la cola"
              className="flex items-center gap-1 text-[11px] font-bold text-white rounded-md px-2.5 py-1"
              style={{ background: COLA_COLOR.pendiente }}
            >
              <RotateCcw size={13} /> Volver a la cola
            </button>
          )}
          {esConfirmar && (
            <>
              <button
                onClick={() => ctx.marcarRealizado(it)}
                className="flex items-center gap-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-md px-2.5 py-1"
              >
                <Check size={13} /> Confirmar
              </button>
              <button
                onClick={() => ctx.rechazar(it)}
                className="flex items-center gap-1 text-[11px] font-bold text-red-500 border border-red-500/50 hover:bg-red-500/10 rounded-md px-2.5 py-1"
              >
                <RotateCcw size={13} /> Rechazar
              </button>
            </>
          )}
        </div>
      )}

      {/* Conclusión: lo que hizo Claude al procesarlo (botón que despliega adentro) */}
      {it.cola_resultado && (
        <div className="px-4 pb-3" style={{ paddingLeft: '2.6rem' }}>
          <button onClick={() => setShowConcl((v) => !v)} className="flex items-center gap-1.5 text-xs font-bold text-emerald-500">
            <span className={`transition-transform ${showConcl ? 'rotate-90' : ''}`}>▸</span>
            {showConcl ? 'Ocultar conclusión' : 'Ver conclusión'}
          </button>
          {showConcl && (
            <div className="mt-2 rounded-lg border px-3 py-2.5 text-[13px] text-ink-soft whitespace-pre-wrap" style={{ background: 'rgba(70,177,123,0.12)', borderColor: 'rgba(70,177,123,0.3)' }}>
              {it.cola_resultado}
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="px-4 pb-4 pt-3 border-t border-line">
          {sections.length ? sections.map((k) => (
            <div key={k} className="mb-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">{SECTION_LABELS[k]}</p>
              {LIST_SECTIONS.includes(k) ? (
                <ul className="space-y-1">
                  {(it[k] as string).split('\n').map((s) => s.trim()).filter(Boolean).map((l, idx) => (
                    <li key={idx} className="text-sm text-ink-soft flex gap-2"><span className="text-primary">›</span>{l}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-soft whitespace-pre-wrap">{it[k]}</p>
              )}
            </div>
          )) : <p className="text-xs text-muted">Sin detalle. Tocá «Editar» para agregar contexto.</p>}
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-dashed border-line">
            {cola && cola !== 'procesado' && <ActBtn onClick={() => ctx.dequeue(it)}>Sacar de cola</ActBtn>}
            <ActBtn onClick={() => ctx.copyItem(it)}><Copy size={12} /> Copiar</ActBtn>
            <ActBtn onClick={() => ctx.openEdit(it)}><Pencil size={12} /> Editar</ActBtn>
            <ActBtn onClick={() => ctx.del(it)} className="hover:border-red-500 hover:text-red-500"><Trash2 size={12} /> Borrar</ActBtn>
            {fecha && <span className="text-[10px] text-muted font-mono ml-auto">Anotado {fecha}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function ActBtn({ onClick, className = '', children }: { onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1 text-xs font-semibold border border-line text-muted rounded-lg px-2.5 py-1.5 hover:text-ink transition-colors ${className}`}>
      {children}
    </button>
  )
}

const inputCls = 'w-full bg-app border border-line text-ink rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
const fieldLabel = 'block text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5'

function FormModal({
  editing, rejecting, onClose, onSaved, areaFilter,
}: {
  editing: Pendiente | null
  rejecting: boolean
  onClose: () => void
  onSaved: (p: Pendiente, wasNew: boolean) => void
  areaFilter: Area | ''
}) {
  const [texto, setTexto] = useState(editing?.texto ?? '')
  const [prioridad, setPrioridad] = useState<Prioridad>(editing?.prioridad ?? 'media')
  const [area, setArea] = useState<Area>(editing?.area ?? (areaFilter || 'app'))
  const [rich, setRich] = useState<Record<string, string>>({
    contexto: editing?.contexto ?? '', que_armar: editing?.que_armar ?? '',
    consideraciones: editing?.consideraciones ?? '', depende: editing?.depende ?? '', alcance: editing?.alcance ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    if (!texto.trim()) { setErr('Poné al menos un título.'); return }
    setSaving(true)
    setErr('')
    try {
      const body: Record<string, unknown> = { texto: texto.trim(), prioridad, area, ...rich }
      if (rejecting && editing) body.cola_estado = '' // rechazar = sacar de la cola
      if (editing) {
        const upd = await api.patch<Pendiente>(`/admin/pendientes/${editing.id}`, body)
        onSaved(upd, false)
      } else {
        const nuevo = await api.post<Pendiente>('/admin/pendientes', body)
        onSaved(nuevo, true)
      }
      onClose()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error al guardar') } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/45 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-card border border-line rounded-2xl w-full max-w-xl p-6 mt-8" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-ink mb-1">{rejecting ? 'Rechazar y reabrir' : editing ? 'Editar pendiente' : 'Nuevo pendiente'}</h2>
        {rejecting && <p className="text-xs text-muted mb-3">Escribí qué viste / qué falta. Al guardar sale del recuadro y vuelve abajo como pendiente normal.</p>}
        <div className="space-y-3 mt-3">
          <div>
            <label className={fieldLabel}>Qué hay que hacer</label>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} className={`${inputCls} min-h-[64px]`} placeholder="Título / descripción corta" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel}>Prioridad</label>
              <select value={prioridad} onChange={(e) => setPrioridad(e.target.value as Prioridad)} className={inputCls}>
                <option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option>
              </select>
            </div>
            <div>
              <label className={fieldLabel}>Área</label>
              <select value={area} onChange={(e) => setArea(e.target.value as Area)} className={inputCls}>
                <option value="app">App</option><option value="web">Web</option><option value="etiguel">Etiguel</option>
              </select>
            </div>
          </div>
          {SECTION_ORDER.map((k) => (
            <div key={k}>
              <label className={fieldLabel}>{SECTION_LABELS[k]}{LIST_SECTIONS.includes(k) ? ' (una línea por punto)' : ''}</label>
              <textarea value={rich[k]} onChange={(e) => setRich((p) => ({ ...p, [k]: e.target.value }))} className={`${inputCls} min-h-[44px]`} placeholder="Opcional" />
            </div>
          ))}
          {err && <p className="text-sm text-red-500">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-line text-sm text-ink">Cancelar</button>
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold disabled:opacity-50">
              {saving ? 'Guardando…' : rejecting ? 'Rechazar' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
