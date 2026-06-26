import { ChevronDown, Download, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAutoSave } from '../hooks/useAutoSave'

// ── Información del negocio (relevamiento) ────────────────────────────────────
// Renderiza el esquema del formulario de intake, ya cargado y editable. Lo usan:
//   • la Configuración del cliente   → basePath="/me"
//   • Admin clientes (superadmin)    → basePath="/admin/clientes/{tenant_id}"
// Ambos editan el MISMO info_negocio del tenant, así que se actualizan mutuamente.

const inputCls =
  'w-full bg-app border border-line text-ink rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
const labelCls = 'block text-sm font-medium text-ink-soft mb-1'
const btnCls =
  'bg-primary text-on-primary rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary-dark disabled:opacity-50'

type CampoSchema = {
  id: string
  label: string
  tipo: 'text' | 'textarea' | 'select' | 'multiselect' | 'email' | 'tel' | 'url' | 'number' | 'archivo'
  oblig?: boolean
  ayuda?: string
  opciones?: string[]
  multiple?: boolean
}
type SeccionSchema = { id: string; titulo: string; descripcion?: string; campos: CampoSchema[] }
type ArchivoMeta = { id: string; campo: string; nombre_original: string; content_type: string | null; size: number }
type InfoNegocioResp = {
  secciones: SeccionSchema[]
  values: Record<string, unknown>
  extra: { label: string; valor: string }[]
  intake_at: string | null
  updated_at: string | null
  archivos: ArchivoMeta[]
}

async function descargarArchivo(a: ArchivoMeta, basePath: string) {
  // El endpoint exige auth (Bearer), por eso no se puede usar un <a href> directo:
  // bajamos el blob con el token y disparamos la descarga.
  const token = localStorage.getItem('token') ?? ''
  const res = await fetch(`/api${basePath}/archivo/${encodeURIComponent(a.id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) { alert('No se pudo descargar el archivo.'); return }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = a.nombre_original || 'archivo'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

type Asignacion = { campo: string; label: string; tipo: string; valor: string; accion: 'completar' | 'agregar'; valor_actual: string | null }
type PropuestaAsistir = { asignaciones: Asignacion[]; nota_libre: string; error?: string }

export default function InfoNegocio({ basePath = '/me', defaultOpen = false }: { basePath?: string; defaultOpen?: boolean }) {
  const [data, setData] = useState<InfoNegocioResp | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [extra, setExtra] = useState<{ label: string; valor: string }[]>([])
  const [open, setOpen] = useState(defaultOpen) // arranca cerrada; se expande al tocar el título

  // Auto-guardado (debounce + flush al salir). El estado lo muestra el header.
  useAutoSave({
    ready: !!data,
    payload: { values, extra: extra.filter((e) => e.label.trim() || e.valor.trim()) },
    path: `${basePath}/info-negocio`,
  })

  // ── "Agregar información": modal con IA que reparte texto libre en campos ──
  const [asistirOpen, setAsistirOpen] = useState(false)
  const [asistirTexto, setAsistirTexto] = useState('')
  const [asistirLoading, setAsistirLoading] = useState(false)
  const [propuesta, setPropuesta] = useState<PropuestaAsistir | null>(null)
  const [sel, setSel] = useState<Record<number, boolean>>({})
  const [asistirErr, setAsistirErr] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<InfoNegocioResp>(`${basePath}/info-negocio`)
      .then((d) => {
        setData(d)
        setValues(d.values || {})
        setExtra(d.extra || [])
      })
      .catch(() => setData(null))
  }, [basePath])

  function setVal(id: string, v: unknown) {
    setValues((prev) => ({ ...prev, [id]: v }))
  }

  function abrirAsistir() {
    setAsistirTexto('')
    setPropuesta(null)
    setSel({})
    setAsistirErr(null)
    setAsistirOpen(true)
  }

  async function correrAsistir() {
    if (!asistirTexto.trim()) return
    setAsistirLoading(true)
    setAsistirErr(null)
    try {
      const p = await api.post<PropuestaAsistir>(`${basePath}/info-negocio/asistir`, { texto: asistirTexto })
      setPropuesta(p)
      // Por defecto todas las asignaciones seleccionadas para aplicar.
      setSel(Object.fromEntries((p.asignaciones || []).map((_, i) => [i, true])))
      if ((!p.asignaciones || p.asignaciones.length === 0) && !p.nota_libre) {
        setAsistirErr('No pude identificar datos para cargar. Probá escribiendo un poco más de detalle.')
      }
    } catch (err: unknown) {
      setAsistirErr(err instanceof Error ? err.message : 'No se pudo procesar el texto')
    } finally {
      setAsistirLoading(false)
    }
  }

  function aplicarPropuesta() {
    if (!propuesta) return
    const asigns = propuesta.asignaciones.filter((_, i) => sel[i])
    setValues((prev) => {
      const next = { ...prev }
      for (const a of asigns) {
        const actual = next[a.campo]
        if (a.accion === 'agregar' && typeof actual === 'string' && actual.trim()) {
          const sep = a.tipo === 'textarea' ? '\n' : ', '
          next[a.campo] = `${actual}${sep}${a.valor}`
        } else {
          next[a.campo] = a.valor
        }
      }
      return next
    })
    if (propuesta.nota_libre.trim()) {
      setExtra((prev) => [...prev, { label: 'Información adicional', valor: propuesta.nota_libre }])
    }
    setAsistirOpen(false)
    // Los cambios se guardan solos (auto-save).
  }

  if (!data) return null

  const sinCargar = !data.intake_at && (!data.updated_at) && Object.keys(data.values || {}).length === 0

  function renderCampo(c: CampoSchema) {
    const cur = values[c.id]
    if (c.tipo === 'archivo') {
      const archivos = (data!.archivos || []).filter((a) => a.campo === c.id)
      return (
        <div key={c.id}>
          <label className={labelCls}>{c.label}</label>
          {archivos.length === 0 ? (
            <p className="text-xs text-muted">Sin archivos subidos.</p>
          ) : (
            <ul className="space-y-1">
              {archivos.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-sm text-ink-soft border border-line rounded-lg px-3 py-2">
                  <span className="truncate">{a.nombre_original} <span className="text-muted">· {Math.round(a.size / 1024)} KB</span></span>
                  <button type="button" onClick={() => descargarArchivo(a, basePath)} title="Descargar" className="text-primary hover:text-primary-dark shrink-0">
                    <Download size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    }
    if (c.tipo === 'textarea') {
      return (
        <div key={c.id}>
          <label className={labelCls}>{c.label}</label>
          <textarea value={(cur as string) ?? ''} onChange={(e) => setVal(c.id, e.target.value)} rows={3} className={`${inputCls} resize-y`} />
          {c.ayuda && <p className="text-xs text-muted mt-1">{c.ayuda}</p>}
        </div>
      )
    }
    if (c.tipo === 'select') {
      return (
        <div key={c.id}>
          <label className={labelCls}>{c.label}</label>
          <select value={(cur as string) ?? ''} onChange={(e) => setVal(c.id, e.target.value)} className={inputCls}>
            <option value="">— Elegir —</option>
            {(c.opciones ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {c.ayuda && <p className="text-xs text-muted mt-1">{c.ayuda}</p>}
        </div>
      )
    }
    if (c.tipo === 'multiselect') {
      const arr = Array.isArray(cur) ? (cur as string[]) : []
      return (
        <div key={c.id}>
          <label className={labelCls}>{c.label}</label>
          <div className="flex flex-wrap gap-2">
            {(c.opciones ?? []).map((o) => {
              const on = arr.includes(o)
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => setVal(c.id, on ? arr.filter((x) => x !== o) : [...arr, o])}
                  className={`text-sm rounded-full px-3 py-1.5 border transition-colors ${on ? 'border-primary bg-primary/10 text-ink' : 'border-line text-ink-soft hover:border-primary/50'}`}
                >
                  {o}
                </button>
              )
            })}
          </div>
          {c.ayuda && <p className="text-xs text-muted mt-1">{c.ayuda}</p>}
        </div>
      )
    }
    const type = ({ email: 'email', tel: 'tel', url: 'url', number: 'number' } as Record<string, string>)[c.tipo] || 'text'
    return (
      <div key={c.id}>
        <label className={labelCls}>{c.label}</label>
        <input type={type} value={(cur as string) ?? ''} onChange={(e) => setVal(c.id, e.target.value)} className={inputCls} />
        {c.ayuda && <p className="text-xs text-muted mt-1">{c.ayuda}</p>}
      </div>
    )
  }

  return (
    <div className="bg-card border border-line rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-6 py-4 text-left"
      >
        <h2 className="text-base font-semibold text-ink">Información del negocio</h2>
        <ChevronDown size={18} className={`text-muted transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
      <div className="px-6 pb-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted">
          {sinCargar
            ? 'Todavía no se completó el relevamiento. Podés cargarlo acá o desde el formulario que te compartimos.'
            : 'Lo que sabemos de tu negocio. Editá, ampliá o agregá lo que quieras — lo usamos para encontrar mejores clientes.'}
        </p>
        <div className="flex items-center gap-3">
          {data.updated_at && (
            <span className="text-xs text-muted">Última edición: {new Date(data.updated_at).toLocaleDateString('es-AR')}</span>
          )}
          <button
            type="button"
            onClick={abrirAsistir}
            className="flex items-center gap-2 text-sm font-medium bg-primary/10 text-primary border border-primary/30 rounded-lg px-3 py-2 hover:bg-primary/15"
          >
            <Sparkles size={16} /> Agregar información
          </button>
        </div>
      </div>

      {data.secciones.map((s) => (
        <div key={s.id} className="border border-line rounded-xl p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">{s.titulo}</h3>
            {s.descripcion && <p className="text-xs text-muted mt-1">{s.descripcion}</p>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {s.campos.map(renderCampo)}
          </div>
        </div>
      ))}

      {/* ── Campos libres que agrega el cliente ── */}
      <div className="border border-line rounded-xl p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-ink">Más información</h3>
          <p className="text-xs text-muted mt-1">Agregá cualquier dato extra que nos sirva.</p>
        </div>
        {extra.map((e, i) => (
          <div key={i} className="flex items-start gap-2">
            <input
              placeholder="Título"
              value={e.label}
              onChange={(ev) => setExtra((prev) => prev.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)))}
              className={`${inputCls} max-w-[200px]`}
            />
            <textarea
              placeholder="Detalle"
              value={e.valor}
              onChange={(ev) => setExtra((prev) => prev.map((x, j) => (j === i ? { ...x, valor: ev.target.value } : x)))}
              rows={1}
              className={`${inputCls} resize-y`}
            />
            <button type="button" onClick={() => setExtra((prev) => prev.filter((_, j) => j !== i))} className="text-muted hover:text-red-500 mt-2 shrink-0" title="Quitar">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setExtra((prev) => [...prev, { label: '', valor: '' }])}
          className="flex items-center gap-2 text-sm text-primary hover:text-primary-dark"
        >
          <Plus size={16} /> Agregar campo
        </button>
      </div>

      {/* ── Modal "Agregar información" (IA reparte el texto en los campos) ── */}
      {asistirOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setAsistirOpen(false)} />
          <div className="relative z-10 w-full max-w-xl bg-card border border-line rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-line">
              <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
                <Sparkles size={16} className="text-primary" /> Agregar información
              </h3>
              <button type="button" onClick={() => setAsistirOpen(false)} className="text-muted hover:text-ink">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-4 overflow-auto space-y-4">
              {!propuesta ? (
                <>
                  <p className="text-sm text-ink-soft">
                    Escribí libremente lo que quieras contar de tu negocio. Lo acomodamos solo en el lugar que corresponde.
                  </p>
                  <textarea
                    autoFocus
                    value={asistirTexto}
                    onChange={(e) => setAsistirTexto(e.target.value)}
                    rows={6}
                    placeholder="Ej: También entregamos en Rosario y Córdoba. Aceptamos cheques a 30 días. Nuestro WhatsApp de ventas es el 11 5555-1234…"
                    className={`${inputCls} resize-y`}
                  />
                  {asistirErr && <p className="text-sm text-red-500">{asistirErr}</p>}
                </>
              ) : (
                <>
                  <p className="text-sm text-ink-soft">Encontré esto. Destildá lo que no quieras agregar:</p>
                  {propuesta.asignaciones.length === 0 && !propuesta.nota_libre && (
                    <p className="text-sm text-muted">No identifiqué datos concretos.</p>
                  )}
                  {propuesta.asignaciones.map((a, i) => (
                    <label key={i} className="flex items-start gap-3 border border-line rounded-xl p-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!sel[i]}
                        onChange={(e) => setSel((prev) => ({ ...prev, [i]: e.target.checked }))}
                        className="h-4 w-4 accent-primary mt-0.5"
                      />
                      <div className="min-w-0">
                        <p className="text-xs text-muted uppercase tracking-wide">{a.label}</p>
                        <p className="text-sm text-ink break-words">{a.valor}</p>
                        {a.accion === 'agregar' && (
                          <p className="text-xs text-amber-600 mt-0.5">Se suma a lo que ya había</p>
                        )}
                      </div>
                    </label>
                  ))}
                  {propuesta.nota_libre && (
                    <div className="border border-line rounded-xl p-3">
                      <p className="text-xs text-muted uppercase tracking-wide">Información adicional (nota)</p>
                      <p className="text-sm text-ink break-words">{propuesta.nota_libre}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-line">
              <button
                type="button"
                onClick={() => setAsistirOpen(false)}
                className="text-sm text-ink border border-line rounded-lg px-4 py-2 hover:bg-app"
              >
                Cancelar
              </button>
              {!propuesta ? (
                <button type="button" onClick={correrAsistir} disabled={asistirLoading || !asistirTexto.trim()} className={btnCls}>
                  {asistirLoading ? 'Procesando…' : 'Procesar'}
                </button>
              ) : (
                <button type="button" onClick={aplicarPropuesta} className={btnCls}>
                  Agregar a mi información
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
      )}
    </div>
  )
}
