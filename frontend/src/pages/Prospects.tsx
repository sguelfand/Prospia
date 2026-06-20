import { Check, CheckCircle2, Clock, MessageCircle, Pencil, Plus, Trash2, X } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { ESTADOS, HISTORIAL_TIPOS, HistorialEntry, Mensaje, Prospect, ProspectsPage } from '../api/types'
import StatusBadge from '../components/StatusBadge'

const PAGE_SIZE = 15

const MESES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
function mesChipLabel(yyyymm: string) {
  const [y, m] = yyyymm.split('-')
  return `${MESES_ABR[parseInt(m) - 1] ?? m} ${y}`
}

const TIPOS_OPCIONES = [
  { value: 'contactado_wa',    label: 'WA enviado' },
  { value: 'contactado_email', label: 'Email enviado' },
  { value: 'en_conversacion',  label: 'En conversación' },
  { value: 'estado_cambiado',  label: 'Estado cambiado' },
  { value: 'en_cola_auto',     label: 'Re-encolado auto' },
  { value: 'cancelado_auto',   label: 'Cancelado auto' },
  { value: 'nota',             label: 'Nota manual' },
]

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

// Convierte datetime local (YYYY-MM-DDTHH:MM) a ISO UTC
function localInputToISO(value: string) {
  if (!value) return undefined
  return new Date(value).toISOString()
}

// Convierte ISO a valor para input datetime-local
function isoToLocalInput(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface EntryFormState {
  tipo: string
  detalle: string
  fecha: string  // datetime-local value
}

function emptyForm(): EntryFormState {
  return { tipo: 'nota', detalle: '', fecha: isoToLocalInput(new Date().toISOString()) }
}

function HistorialPanel({ prospect, onClose }: { prospect: Prospect; onClose: () => void }) {
  const [entries, setEntries] = useState<HistorialEntry[] | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<EntryFormState>(emptyForm())
  const [addForm, setAddForm] = useState<EntryFormState>(emptyForm())
  const [showAddForm, setShowAddForm] = useState(false)
  const [saving, setSaving] = useState(false)

  function reload() {
    api.get<HistorialEntry[]>(`/prospects/${prospect.id}/historial`)
      .then(setEntries)
      .catch(console.error)
  }

  useEffect(() => { reload() }, [prospect.id])

  function startEdit(e: HistorialEntry) {
    setEditingId(e.id)
    setEditForm({ tipo: e.tipo, detalle: e.detalle ?? '', fecha: isoToLocalInput(e.fecha) })
  }

  async function saveEdit() {
    if (!editingId) return
    setSaving(true)
    try {
      await api.patch(`/prospects/historial/${editingId}`, {
        tipo: editForm.tipo,
        detalle: editForm.detalle || null,
        fecha: localInputToISO(editForm.fecha),
      })
      setEditingId(null)
      reload()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function deleteEntry(id: number) {
    if (!confirm('¿Borrar esta entrada del historial?')) return
    try {
      await api.delete(`/prospects/historial/${id}`)
      reload()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al borrar')
    }
  }

  async function saveAdd() {
    setSaving(true)
    try {
      await api.post(`/prospects/${prospect.id}/historial`, {
        tipo: addForm.tipo,
        detalle: addForm.detalle || null,
        fecha: localInputToISO(addForm.fecha),
      })
      setAddForm(emptyForm())
      setShowAddForm(false)
      reload()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-[420px] bg-card h-full shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <p className="font-semibold text-ink">{prospect.nombre}</p>
            <p className="text-xs text-muted mt-0.5">Historial de contacto</p>
          </div>
          <button onClick={onClose} className="text-faint hover:text-muted p-1 rounded">
            <X size={18} />
          </button>
        </div>

        {/* Stats */}
        <div className="flex gap-4 px-5 py-3 border-b bg-app text-sm">
          <div><span className="text-muted">Contactos: </span><span className="font-semibold">{prospect.cant_contactos}</span></div>
          <div><span className="text-muted">Último: </span><span className="font-semibold">{formatDate(prospect.ult_contacto)}</span></div>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {entries === null && <p className="text-center text-faint py-8">Cargando...</p>}
          {entries?.length === 0 && <p className="text-center text-faint py-8">Sin historial todavía</p>}
          {entries && entries.length > 0 && (
            <ol className="relative border-l border-line space-y-5 ml-2">
              {entries.map(e => {
                const meta = HISTORIAL_TIPOS[e.tipo] ?? { label: e.tipo, color: '#94a3b8' }
                const isEditing = editingId === e.id
                return (
                  <li key={e.id} className="ml-4 group">
                    <span
                      className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white"
                      style={{ backgroundColor: meta.color }}
                    />
                    {isEditing ? (
                      <div className="space-y-2 bg-app rounded-lg p-3 border">
                        <select
                          value={editForm.tipo}
                          onChange={ev => setEditForm(f => ({ ...f, tipo: ev.target.value }))}
                          className="w-full text-xs border border-line rounded px-2 py-1 focus:outline-none"
                        >
                          {TIPOS_OPCIONES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <textarea
                          value={editForm.detalle}
                          onChange={ev => setEditForm(f => ({ ...f, detalle: ev.target.value }))}
                          placeholder="Detalle (opcional)"
                          rows={2}
                          className="w-full text-xs border border-line rounded px-2 py-1 focus:outline-none resize-none"
                        />
                        <input
                          type="datetime-local"
                          value={editForm.fecha}
                          onChange={ev => setEditForm(f => ({ ...f, fecha: ev.target.value }))}
                          className="w-full text-xs border border-line rounded px-2 py-1 focus:outline-none"
                        />
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setEditingId(null)} className="text-xs text-muted hover:text-ink-soft px-2 py-1">Cancelar</button>
                          <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1 text-xs bg-primary text-on-primary px-3 py-1 rounded hover:bg-primary-dark disabled:opacity-50">
                            <Check size={11} /> Guardar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-faint">{formatDate(e.fecha)}</p>
                          <p className="text-sm font-medium" style={{ color: meta.color }}>{meta.label}</p>
                          {e.detalle && <p className="text-xs text-muted mt-0.5 break-words">{e.detalle}</p>}
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
                          <button onClick={() => startEdit(e)} className="text-faint hover:text-accent p-1 rounded">
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => deleteEntry(e.id)} className="text-faint hover:text-red-500 p-1 rounded">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        {/* Add entry */}
        <div className="border-t bg-card px-5 py-4">
          {!showAddForm ? (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 text-sm text-accent hover:text-accent font-medium"
            >
              <Plus size={14} /> Agregar registro
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-ink-soft">Nuevo registro</p>
              <select
                value={addForm.tipo}
                onChange={ev => setAddForm(f => ({ ...f, tipo: ev.target.value }))}
                className="w-full text-xs border border-line rounded px-2 py-1.5 focus:outline-none"
              >
                {TIPOS_OPCIONES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <textarea
                value={addForm.detalle}
                onChange={ev => setAddForm(f => ({ ...f, detalle: ev.target.value }))}
                placeholder="Detalle (opcional)"
                rows={2}
                className="w-full text-xs border border-line rounded px-2 py-1.5 focus:outline-none resize-none"
              />
              <input
                type="datetime-local"
                value={addForm.fecha}
                onChange={ev => setAddForm(f => ({ ...f, fecha: ev.target.value }))}
                className="w-full text-xs border border-line rounded px-2 py-1.5 focus:outline-none"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowAddForm(false)} className="text-xs text-muted hover:text-ink-soft px-2 py-1">Cancelar</button>
                <button onClick={saveAdd} disabled={saving} className="flex items-center gap-1 text-xs bg-primary text-on-primary px-3 py-1.5 rounded hover:bg-primary-dark disabled:opacity-50">
                  <Plus size={11} /> Guardar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const CLASIF_STYLES = {
  ALTO:      { bg: 'bg-green-100',  text: 'text-green-700',  border: 'border-green-300',  label: 'ALTO'      },
  MEDIO:     { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300', label: 'MEDIO'     },
  BAJO:      { bg: 'bg-red-100',    text: 'text-red-700',    border: 'border-red-300',    label: 'BAJO'      },
  CANCELADO: { bg: 'bg-subtle',   text: 'text-muted',   border: 'border-line',   label: 'CANCELADO' },
} as const

type NivelClasif = keyof typeof CLASIF_STYLES
const NIVELES: NivelClasif[] = ['ALTO', 'MEDIO', 'BAJO', 'CANCELADO']

function ClasificacionCell({
  prospect,
  onVerificar,
  onCambiar,
}: {
  prospect: Prospect
  onVerificar: (p: Prospect) => void
  onCambiar: (p: Prospect, nivel: NivelClasif, razon: string) => Promise<void>
}) {
  const [open, setOpen]     = useState(false)
  const [nivel, setNivel]   = useState<NivelClasif>('ALTO')
  const [razon, setRazon]   = useState('')
  const [saving, setSaving] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const [openUp, setOpenUp]         = useState(false)
  const anchorRef           = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function startEdit() {
    setNivel((prospect.clasificacion as NivelClasif) ?? 'ALTO')
    setRazon('')
    // Si no hay espacio a la derecha (w-52 = 208px) o abajo (~220px) para el popover, voltearlo
    const POPOVER_W = 208
    const POPOVER_H = 220
    const rect = anchorRef.current?.getBoundingClientRect()
    setAlignRight(rect ? rect.left + POPOVER_W + 16 > window.innerWidth : false)
    setOpenUp(rect ? rect.bottom + POPOVER_H + 16 > window.innerHeight : false)
    setOpen(true)
  }

  async function handleOk() {
    if (saving) return
    setSaving(true)
    try {
      await onCambiar(prospect, nivel, razon)
      setOpen(false)
      setRazon('')
    } finally {
      setSaving(false)
    }
  }

  const s = prospect.clasificacion
    ? CLASIF_STYLES[prospect.clasificacion as NivelClasif]
    : null

  return (
    <div className="flex items-center gap-1.5">
      {/* Badge / placeholder — ancla del popover */}
      <div ref={anchorRef} className="relative group/clasif">
        {s ? (
          <span
            onClick={startEdit}
            className={`text-xs font-semibold px-2 py-0.5 rounded border ${s.bg} ${s.text} ${s.border} leading-tight cursor-pointer hover:opacity-75 select-none`}
            title="Clic para cambiar"
          >
            {s.label}
          </span>
        ) : (
          <span
            onClick={startEdit}
            className="text-faint text-xs cursor-pointer hover:text-faint select-none"
            title="Clic para clasificar"
          >—</span>
        )}

        {/* Tooltip con detalle (solo cuando el popover está cerrado) */}
        {!open && prospect.clasificacion_detalle && (
          <div className="absolute left-0 top-full mt-1 z-20 w-56 bg-card border border-line rounded-lg shadow-lg px-3 py-2 hidden group-hover/clasif:block pointer-events-none">
            <p className="text-xs text-ink-soft leading-snug">{prospect.clasificacion_detalle}</p>
          </div>
        )}

        {/* Popover */}
        {open && (
          <div className={`absolute ${alignRight ? 'right-0' : 'left-0'} ${openUp ? 'bottom-full mb-2' : 'top-full mt-2'} z-50 w-52 bg-card border border-line rounded-xl shadow-xl p-3 flex flex-col gap-2`}>
            {/* Flechita */}
            <div className={`absolute ${openUp ? '-bottom-[5px] border-r border-b' : '-top-[5px] border-l border-t'} ${alignRight ? 'right-3' : 'left-3'} w-2.5 h-2.5 bg-card border-line rotate-45`} />

            <p className="text-[11px] font-semibold text-faint uppercase tracking-wide">Clasificación</p>

            <select
              value={nivel}
              onChange={e => setNivel(e.target.value as NivelClasif)}
              autoFocus
              className="text-xs border border-line rounded-lg px-2 py-1.5 bg-app focus:outline-none focus:border-primary focus:bg-card"
            >
              {NIVELES.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>

            <textarea
              value={razon}
              onChange={e => setRazon(e.target.value)}
              placeholder="¿Por qué? (opcional)"
              rows={2}
              className="text-xs border border-line rounded-lg px-2 py-1.5 bg-app resize-none focus:outline-none focus:border-primary focus:bg-card"
            />

            <div className="flex gap-1.5 pt-0.5">
              <button
                onClick={handleOk}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-1 text-xs font-semibold bg-primary text-on-primary rounded-lg py-1.5 hover:bg-primary-dark disabled:opacity-50 transition-colors"
              >
                <Check size={11} />
                {saving ? '...' : 'OK'}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="text-xs text-faint hover:text-muted px-2 rounded-lg hover:bg-subtle transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Botón verificar */}
      <button
        onClick={() => onVerificar(prospect)}
        title={prospect.clasificacion_verificada ? 'Verificado — clic para quitar' : 'Confirmar clasificación'}
        className="shrink-0 transition-colors"
      >
        <CheckCircle2
          size={15}
          className={prospect.clasificacion_verificada
            ? 'text-green-500'
            : 'text-faint hover:text-green-400'}
        />
      </button>
    </div>
  )
}

// ── Card mobile de prospect ──────────────────────────────────────────────────

function ProspectCard({
  prospect: p,
  contacting,
  onContactar,
  onHistorial,
  onConversacion,
  onVerificar,
  onCambiar,
}: {
  prospect: Prospect
  contacting: Set<number>
  onContactar: (id: number) => void
  onHistorial: (p: Prospect) => void
  onConversacion: (p: Prospect) => void
  onVerificar: (p: Prospect) => void
  onCambiar: (p: Prospect, nivel: NivelClasif, razon: string) => Promise<void>
}) {
  const [expanded, setExpanded] = React.useState(false)
  const estadoInfo = ESTADOS[p.estado]

  return (
    <div className="bg-card rounded-xl shadow overflow-hidden">
      {/* Cuerpo principal */}
      <div className="p-4 space-y-2.5">
        {/* Nombre + clasificación */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-ink text-sm leading-snug">{p.nombre}</p>
            {p.url && (
              <a href={p.url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-accent hover:underline truncate block">
                {p.url.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
          <ClasificacionCell prospect={p} onVerificar={onVerificar} onCambiar={onCambiar} />
        </div>

        {/* Meta: estado + contactos + fecha */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: estadoInfo?.color ?? '#94a3b8' }} />
            {estadoInfo?.label ?? p.estado}
          </span>
          {p.cant_contactos > 0 && (
            <span>💬 {p.cant_contactos} {p.cant_contactos === 1 ? 'contacto' : 'contactos'}</span>
          )}
          {p.ult_contacto && (
            <span>🕐 {new Date(p.ult_contacto).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</span>
          )}
        </div>
      </div>

      {/* Expandible */}
      {expanded && (
        <div className="px-4 pb-3 border-t border-line pt-3 space-y-1.5">
          {p.email       && <div className="flex gap-2 text-xs"><span className="text-faint w-20 shrink-0">Email</span><span className="text-ink-soft">{p.email}</span></div>}
          {p.whatsapp    && <div className="flex gap-2 text-xs"><span className="text-faint w-20 shrink-0">WhatsApp</span><span className="text-ink-soft">{p.whatsapp}</span></div>}
          {p.termino_texto && <div className="flex gap-2 text-xs"><span className="text-faint w-20 shrink-0">Término</span><span className="text-ink-soft">{p.termino_texto}</span></div>}
          {p.rubro_nombre  && <div className="flex gap-2 text-xs"><span className="text-faint w-20 shrink-0">Rubro</span><span className="text-ink-soft">{p.rubro_nombre}</span></div>}
          {p.clasificacion_detalle && <div className="flex gap-2 text-xs"><span className="text-faint w-20 shrink-0">Detalle IA</span><span className="text-ink-soft italic">{p.clasificacion_detalle}</span></div>}
        </div>
      )}

      {/* Toggle expandir */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full text-center text-xs text-faint hover:text-muted py-1.5 border-t border-line"
      >
        {expanded ? '▴ Ver menos' : '▾ Ver más'}
      </button>

      {/* Acciones */}
      <div className="flex gap-2 px-4 py-3 bg-app border-t border-line">
        <button
          onClick={() => onContactar(p.id)}
          disabled={contacting.has(p.id) || p.estado === 'contactado' || p.estado === 'en_conversacion'}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-primary-soft text-accent py-2 rounded-lg hover:bg-primary-soft disabled:opacity-40"
        >
          <MessageCircle size={12} />
          {contacting.has(p.id) ? 'Enviando...' : 'Contactar'}
        </button>
        <button
          onClick={() => onConversacion(p)}
          className="relative flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-lg bg-green-50 text-green-700 hover:bg-green-100"
        >
          <MessageCircle size={12} />
          Chat
          {p.cant_mensajes > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-green-600 text-white text-[10px] font-bold flex items-center justify-center shadow">
              {p.cant_mensajes}
            </span>
          )}
        </button>
        <button
          onClick={() => onHistorial(p)}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-subtle text-muted py-2 rounded-lg hover:bg-subtle"
        >
          <Clock size={12} />
          Historial
        </button>
      </div>
    </div>
  )
}

// ── Panel de conversación estilo WhatsApp ────────────────────────────────────

function horaMsg(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fechaSeparador(iso: string) {
  const d = new Date(iso)
  const hoy = new Date()
  const ayer = new Date(); ayer.setDate(hoy.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, hoy)) return 'Hoy'
  if (sameDay(d, ayer)) return 'Ayer'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function ConversacionPanel({ prospect, onClose }: { prospect: Prospect; onClose: () => void }) {
  const [mensajes, setMensajes] = useState<Mensaje[] | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  function reload() {
    api.get<Mensaje[]>(`/prospects/${prospect.id}/mensajes`)
      .then(setMensajes)
      .catch(console.error)
  }

  // Carga inicial + refresco cada 10s mientras el panel está abierto (la conversación
  // la actualiza el plugin de OpenClaw del lado del server).
  useEffect(() => {
    reload()
    const t = setInterval(reload, 10000)
    return () => clearInterval(t)
  }, [prospect.id])

  // Auto-scroll al último mensaje cuando cambia la lista.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [mensajes])

  let ultimaFecha = ''

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-[420px] bg-card h-full shadow-2xl flex flex-col">

        {/* Header estilo WhatsApp */}
        <div className="flex items-center justify-between px-5 py-3 border-b bg-[#008069] text-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-full bg-card/20 flex items-center justify-center shrink-0">
              <MessageCircle size={18} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold truncate">{prospect.nombre}</p>
              <p className="text-xs text-white/80 truncate">{prospect.whatsapp || prospect.telefono || 'sin número'}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white p-1 rounded">
            <X size={18} />
          </button>
        </div>

        {/* Hilo de mensajes */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-[#efeae2]">
          {mensajes === null && <p className="text-center text-muted py-8 text-sm">Cargando...</p>}
          {mensajes?.length === 0 && (
            <p className="text-center text-muted py-8 text-sm">Todavía no hay mensajes en esta conversación</p>
          )}
          {mensajes?.map(m => {
            const sep = fechaSeparador(m.fecha)
            const mostrarSep = sep !== ultimaFecha
            ultimaFecha = sep
            const out = m.direccion === 'out'
            return (
              <React.Fragment key={m.id}>
                {mostrarSep && (
                  <div className="flex justify-center my-3">
                    <span className="text-[11px] text-muted bg-card/80 rounded-md px-2 py-0.5 shadow-sm">{sep}</span>
                  </div>
                )}
                <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[78%] rounded-lg px-2.5 py-1.5 shadow-sm text-sm whitespace-pre-wrap break-words ${
                      out
                        ? 'bg-[#d9fdd3] text-[#0C1730] dark:bg-[#005c4b] dark:text-white'
                        : 'bg-card text-ink'
                    }`}
                  >
                    <span>{m.texto}</span>
                    <span className={`text-[10px] ml-2 float-right mt-1.5 ${out ? 'opacity-60' : 'text-muted'}`}>{horaMsg(m.fecha)}</span>
                  </div>
                </div>
              </React.Fragment>
            )
          })}
        </div>

        {/* Footer informativo: el chat es de solo lectura (lo maneja Camila) */}
        <div className="border-t bg-app px-5 py-2.5 text-center">
          <p className="text-[11px] text-faint">Conversación gestionada por Camila — solo lectura</p>
        </div>
      </div>
    </div>
  )
}

// ── Columnas redimensionables ────────────────────────────────────────────────

const COL_DEFS = [
  { id: 'check',         defaultW: 40,  resizable: false },
  { id: 'nombre',        defaultW: 180, resizable: true  },
  { id: 'web',           defaultW: 150, resizable: true  },
  { id: 'email',         defaultW: 160, resizable: true  },
  { id: 'whatsapp',      defaultW: 120, resizable: true  },
  { id: 'termino',       defaultW: 110, resizable: true  },
  { id: 'rubro',         defaultW: 110, resizable: true  },
  { id: 'contactos',     defaultW: 90,  resizable: true  },
  { id: 'ult_contacto',  defaultW: 130, resizable: true  },
  { id: 'clasificacion', defaultW: 130, resizable: true  },
  { id: 'estado',        defaultW: 140, resizable: true  },
  { id: 'acciones',      defaultW: 170, resizable: false },
]

const WIDTHS_KEY = 'prospects_col_widths_v1'

function useColumnWidths() {
  const defaults: Record<string, number> = Object.fromEntries(COL_DEFS.map(c => [c.id, c.defaultW]))

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(WIDTHS_KEY) || '{}') } }
    catch { return defaults }
  })

  const widthsRef = useRef<Record<string, number>>(widths)
  useEffect(() => { widthsRef.current = widths }, [widths])

  const drag = useRef<{ id: string; startX: number; startW: number } | null>(null)

  function startResize(id: string, e: React.MouseEvent) {
    e.preventDefault()
    drag.current = { id, startX: e.clientX, startW: widths[id] ?? 100 }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev: MouseEvent) {
      if (!drag.current) return
      const newW = Math.max(50, drag.current.startW + ev.clientX - drag.current.startX)
      setWidths(prev => ({ ...prev, [drag.current!.id]: newW }))
    }

    function onUp() {
      if (drag.current) {
        localStorage.setItem(WIDTHS_KEY, JSON.stringify(widthsRef.current))
        drag.current = null
      }
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return { widths, startResize }
}

function ResizableTh({ id, children, startResize }: {
  id: string
  children: React.ReactNode
  startResize: (id: string, e: React.MouseEvent) => void
}) {
  return (
    <th className="px-4 py-3 text-left relative">
      {children}
      <div
        onMouseDown={e => startResize(id, e)}
        className="absolute right-0 top-2 bottom-2 w-[3px] rounded-full cursor-col-resize bg-faint opacity-0 hover:opacity-100 transition-opacity"
      />
    </th>
  )
}

export default function Prospects() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<ProspectsPage | null>(null)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState(() => searchParams.get('estado') ?? '')
  const [terminoId, setTerminoId] = useState(() => searchParams.get('termino_id') ?? '')
  const [mes, setMes] = useState(() => searchParams.get('mes') ?? '')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [contacting, setContacting] = useState<Set<number>>(new Set())
  const [historialProspect, setHistorialProspect] = useState<Prospect | null>(null)
  const [conversacionProspect, setConversacionProspect] = useState<Prospect | null>(null)
  const { widths, startResize } = useColumnWidths()

  useEffect(() => {
    const e = searchParams.get('estado') ?? ''
    const t = searchParams.get('termino_id') ?? ''
    setEstado(e)
    setTerminoId(t)
    setMes(searchParams.get('mes') ?? '')
    setPage(1)
  }, [searchParams.toString()])

  function buildUrl() {
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) })
    if (q) params.set('q', q)
    if (estado) params.set('estado', estado)
    if (terminoId) params.set('termino_id', terminoId)
    if (mes) params.set('mes', mes)
    return `/prospects?${params}`
  }

  useEffect(() => {
    api.get<ProspectsPage>(buildUrl()).then(setData).catch(console.error)
  }, [page, q, estado, terminoId, mes])

  async function toggleVerificacion(p: Prospect) {
    try {
      const updated = await api.patch<Prospect>(`/prospects/${p.id}/clasificacion`, {
        clasificacion_verificada: !p.clasificacion_verificada,
      })
      setData(prev => prev ? {
        ...prev,
        items: prev.items.map(item => item.id === p.id ? updated : item),
      } : prev)
    } catch {
      alert('Error al verificar')
    }
  }

  async function cambiarClasificacion(p: Prospect, nivel: NivelClasif, razon: string) {
    const updated = await api.patch<Prospect>(`/prospects/${p.id}/clasificacion`, {
      clasificacion: nivel,
      ...(razon.trim() ? { clasificacion_detalle: razon.trim() } : {}),
      clasificacion_verificada: true,
    })
    setData(prev => prev ? {
      ...prev,
      items: prev.items.map(item => item.id === p.id ? updated : item),
    } : prev)
  }

  async function changeEstado(id: number, nuevoEstado: string) {
    try {
      const updated = await api.patch<Prospect>(`/prospects/${id}/estado`, { estado: nuevoEstado })
      setData(prev => prev ? {
        ...prev,
        items: prev.items.map(p => p.id === id ? updated : p),
      } : prev)
    } catch {
      alert('Error cambiando estado')
    }
  }

  async function contactar(id: number) {
    setContacting(prev => new Set(prev).add(id))
    try {
      await api.post(`/prospects/${id}/contactar`)
      // Refrescar ese prospect
      const updated = await api.patch<Prospect>(`/prospects/${id}/estado`, { estado: 'contactado' })
      setData(prev => prev ? {
        ...prev,
        items: prev.items.map(p => p.id === id ? updated : p),
      } : prev)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error contactando')
    } finally {
      setContacting(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  async function contactarSeleccionados() {
    for (const id of selected) {
      await contactar(id)
      await new Promise(r => setTimeout(r, 1000))
    }
    setSelected(new Set())
  }

  function toggleSelect(id: number) {
    setSelected(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  function toggleAll() {
    if (!data) return
    if (selected.size === data.items.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(data.items.map(p => p.id)))
    }
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1

  return (
    <div className="space-y-4">
      {historialProspect && (
        <HistorialPanel
          prospect={historialProspect}
          onClose={() => setHistorialProspect(null)}
        />
      )}

      {conversacionProspect && (
        <ConversacionPanel
          prospect={conversacionProspect}
          onClose={() => setConversacionProspect(null)}
        />
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold">Prospects</h1>
        {selected.size > 0 && (
          <button
            onClick={contactarSeleccionados}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700"
          >
            <MessageCircle size={16} />
            Contactar {selected.size} seleccionados
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <input
          type="text"
          placeholder="Buscar nombre, email, web..."
          value={q}
          onChange={e => { setQ(e.target.value); setPage(1) }}
          className="border border-line rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <select
          value={estado}
          onChange={e => { setEstado(e.target.value); setPage(1) }}
          className="border border-line rounded-lg px-3 py-2 text-sm focus:outline-none"
        >
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        {mes && (
          <button
            onClick={() => {
              const n = new URLSearchParams(searchParams)
              n.delete('mes')
              setSearchParams(n)
              setMes('')
              setPage(1)
            }}
            className="flex items-center gap-1 bg-primary-soft text-accent border border-line rounded-lg px-3 py-2 text-sm hover:bg-primary-soft whitespace-nowrap"
            title="Quitar filtro de mes"
          >
            Mes: {mesChipLabel(mes)} ✕
          </button>
        )}
      </div>

      {/* Mobile: cards */}
      <div className="md:hidden space-y-3">
        {!data && <p className="text-center text-faint py-8">Cargando...</p>}
        {data?.items.length === 0 && <p className="text-center text-faint py-8">No hay prospects</p>}
        {data?.items.map(p => (
          <ProspectCard
            key={p.id}
            prospect={p}
            contacting={contacting}
            onContactar={contactar}
            onHistorial={setHistorialProspect}
            onConversacion={setConversacionProspect}
            onVerificar={toggleVerificacion}
            onCambiar={cambiarClasificacion}
          />
        ))}
      </div>

      {/* Desktop: tabla */}
      <div className="hidden md:block bg-card rounded-xl shadow overflow-x-auto">
        <table className="text-sm" style={{ tableLayout: 'fixed', width: COL_DEFS.reduce((s, c) => s + widths[c.id], 0), minWidth: '100%' }}>
          <colgroup>
            {COL_DEFS.map(c => <col key={c.id} style={{ width: widths[c.id] }} />)}
          </colgroup>
          <thead>
            <tr className="border-b bg-app text-muted">
              <th className="px-4 py-3 text-left">
                <input type="checkbox" onChange={toggleAll} checked={data ? selected.size === data.items.length && data.items.length > 0 : false} />
              </th>
              <ResizableTh id="nombre"        startResize={startResize}>Nombre</ResizableTh>
              <ResizableTh id="web"           startResize={startResize}>Web</ResizableTh>
              <ResizableTh id="email"         startResize={startResize}>Email</ResizableTh>
              <ResizableTh id="whatsapp"      startResize={startResize}>WhatsApp</ResizableTh>
              <ResizableTh id="termino"       startResize={startResize}>Término</ResizableTh>
              <ResizableTh id="rubro"         startResize={startResize}>Rubro</ResizableTh>
              <ResizableTh id="contactos"     startResize={startResize}>Contactos</ResizableTh>
              <ResizableTh id="ult_contacto"  startResize={startResize}>Últ. contacto</ResizableTh>
              <ResizableTh id="clasificacion" startResize={startResize}>Clasificación</ResizableTh>
              <ResizableTh id="estado"        startResize={startResize}>Estado</ResizableTh>
              <th className="px-4 py-3 text-left">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map(p => (
              <tr key={p.id} className="border-b hover:bg-app">
                <td className="px-4 py-3">
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} />
                </td>
                <td className="px-4 py-3 font-medium truncate overflow-hidden">{p.nombre}</td>
                <td className="px-4 py-3 truncate overflow-hidden">
                  {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{p.url.replace(/^https?:\/\//, '')}</a> : '—'}
                </td>
                <td className="px-4 py-3 text-muted truncate overflow-hidden">{p.email || '—'}</td>
                <td className="px-4 py-3 text-muted truncate overflow-hidden">{p.whatsapp || '—'}</td>
                <td className="px-4 py-3 text-muted text-xs truncate overflow-hidden">{p.termino_texto || '—'}</td>
                <td className="px-4 py-3 text-muted text-xs truncate overflow-hidden">{p.rubro_nombre || '—'}</td>
                <td className="px-4 py-3 text-center">
                  {p.cant_contactos > 0
                    ? <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-soft text-accent text-xs font-semibold">{p.cant_contactos}</span>
                    : <span className="text-faint">—</span>
                  }
                </td>
                <td className="px-4 py-3 text-muted text-xs whitespace-nowrap">{formatDate(p.ult_contacto)}</td>
                <td className="px-4 py-3">
                  <ClasificacionCell prospect={p} onVerificar={toggleVerificacion} onCambiar={cambiarClasificacion} />
                </td>
                <td className="px-4 py-3">
                  <select
                    value={p.estado}
                    onChange={e => changeEstado(p.id, e.target.value)}
                    className="text-xs border-0 bg-transparent cursor-pointer focus:outline-none"
                    style={{ color: ESTADOS[p.estado]?.color }}
                  >
                    {Object.entries(ESTADOS).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => contactar(p.id)}
                      disabled={contacting.has(p.id) || p.estado === 'contactado' || p.estado === 'en_conversacion'}
                      className="flex items-center gap-1 text-xs bg-primary-soft text-accent px-2.5 py-1.5 rounded hover:bg-primary-soft disabled:opacity-40"
                    >
                      <MessageCircle size={12} />
                      {contacting.has(p.id) ? 'Enviando...' : 'Contactar'}
                    </button>
                    <button
                      onClick={() => setConversacionProspect(p)}
                      title={p.cant_mensajes > 0 ? `${p.cant_mensajes} mensajes` : 'Sin conversación'}
                      className="relative flex items-center gap-1 text-xs px-2.5 py-1.5 rounded bg-green-50 text-green-700 hover:bg-green-100"
                    >
                      <MessageCircle size={12} />
                      Chat
                      {p.cant_mensajes > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-green-600 text-white text-[10px] font-bold flex items-center justify-center shadow">
                          {p.cant_mensajes}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setHistorialProspect(p)}
                      className="flex items-center gap-1 text-xs bg-subtle text-muted px-2.5 py-1.5 rounded hover:bg-subtle"
                    >
                      <Clock size={12} />
                      Historial
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data && <div className="p-6 text-center text-faint">Cargando...</div>}
        {data?.items.length === 0 && <div className="p-6 text-center text-faint">No hay prospects</div>}
      </div>{/* /tabla desktop */}

      {/* Paginación */}
      {data && totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-muted">
          <span>{data.total} prospects en total</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-subtle">← Ant.</button>
            <span className="px-3 py-1">Pág. {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-subtle">Sig. →</button>
          </div>
        </div>
      )}
    </div>
  )
}
