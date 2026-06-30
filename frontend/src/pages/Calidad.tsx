import { Loader2, MessageSquare, Phone, Plus, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { ClienteSelector, type SourceOpt } from '../components/ClienteSelector'

const PANTALLA = 'calidad'
const FALLBACK_SOURCE = 'etiguel'

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
  origen?: 'especialista' | 'sebi'
  estado: Estado
  veredicto: Veredicto
  nota_sebi: string | null
  created_at: string | null
  revisado_at: string | null
}

type Mensaje = { id: number; direccion: 'in' | 'out'; texto: string; fecha: string }

type Consolidacion = {
  id: number; estado: string; bloque_propuesto: string; bloque_anterior: string
  n_lecciones: number; lecciones_ids: number[]; created_at: string | null; aplicada_at: string | null
}
type AprEstado = {
  pendientes: number; umbral: number
  propuesta: Consolidacion | null; ultima_aplicada: Consolidacion | null
  lecciones_pendientes: { id: number; titulo: string; categoria: string }[]
}
type Hallazgo = { tipo: string; detalle: string; sugerencia?: string }
type AuditEstado = {
  ultima_at: string | null; dias_desde: number | null; recomendar: boolean
  dias_recomendado: number; resumen: string | null; reporte: string | null
  hallazgos?: Hallazgo[]; n_hallazgos: number
}

const HALLAZGO_META: Record<string, { emoji: string; label: string; color: string }> = {
  duplicacion: { emoji: '🔁', label: 'Duplicación', color: '#f5b23d' },
  contradiccion: { emoji: '⚠️', label: 'Contradicción', color: '#ef4444' },
  obsoleto: { emoji: '🗑️', label: 'Obsoleto', color: '#64748b' },
  estructura: { emoji: '🧱', label: 'Estructura', color: '#38bdf8' },
}

function reporteHtml(audit: AuditEstado, cliente: string): string {
  const esc = (s: string) => (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
  const fecha = audit.ultima_at ? new Date(audit.ultima_at).toLocaleString('es-AR') : '—'
  const cards = (audit.hallazgos || []).map((h) => {
    const m = HALLAZGO_META[h.tipo] || { emoji: '•', label: h.tipo || 'Hallazgo', color: '#8294b4' }
    return `<div class="card" style="border-left-color:${m.color}">
      <div class="tag" style="color:${m.color}">${m.emoji} ${esc(m.label)}</div>
      <p class="det">${esc(h.detalle)}</p>
      ${h.sugerencia ? `<p class="sug"><b>Sugerencia:</b> ${esc(h.sugerencia)}</p>` : ''}
    </div>`
  }).join('')
  const cuerpo = (audit.hallazgos && audit.hallazgos.length)
    ? cards : `<p class="ok">✅ Sin problemas de mantenimiento detectados.</p>`
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auditoría del prompt — ${esc(cliente)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0C1730; color:#EEF3FB; font-family:'Segoe UI',system-ui,sans-serif; padding:28px; line-height:1.5; }
  .wrap { max-width:780px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 4px; }
  .meta { color:#8294B4; font-size:13px; margin-bottom:6px; }
  .resumen { background:#13213C; border:1px solid #243454; border-radius:12px; padding:14px 16px; margin:14px 0 20px; }
  .card { background:#13213C; border:1px solid #243454; border-left-width:4px; border-radius:10px; padding:14px 16px; margin-bottom:12px; }
  .tag { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px; }
  .det { margin:0; }
  .sug { margin:8px 0 0; color:#9fb3d1; font-size:14px; }
  .ok { color:#34d399; font-size:16px; }
  .foot { color:#5C6E90; font-size:12px; margin-top:24px; }
</style></head><body><div class="wrap">
  <h1>🧱 Auditoría del prompt de Camila</h1>
  <div class="meta">Cliente: ${esc(cliente)} · ${fecha} · ${(audit.hallazgos || []).length} hallazgo(s)</div>
  ${audit.resumen ? `<div class="resumen">${esc(audit.resumen)}</div>` : ''}
  ${cuerpo}
  <div class="foot">Generado por Prospia — auditoría del prompt completo de Camila.</div>
</div></body></html>`
}

function abrirReporteHtml(audit: AuditEstado, cliente: string) {
  const blob = new Blob([reporteHtml(audit, cliente)], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

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

function fmtFecha(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}
function fmtFechaHora(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function Calidad() {
  const [revisiones, setRevisiones] = useState<Revision[]>([])
  const [filtro, setFiltro] = useState<Estado>('nuevo')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notas, setNotas] = useState<Record<number, string>>({})
  const [conv, setConv] = useState<Record<number, Mensaje[] | 'loading'>>({})
  const [apr, setApr] = useState<AprEstado | null>(null)
  const [verBloque, setVerBloque] = useState(false)
  const [aprBusy, setAprBusy] = useState(false)
  const [source, setSource] = useState(FALLBACK_SOURCE)
  const [sources, setSources] = useState<SourceOpt[]>([{ source: 'etiguel', nombre: 'Etiguel' }])
  const [savedDefault, setSavedDefault] = useState(FALLBACK_SOURCE)
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [nuevoTel, setNuevoTel] = useState('')
  const [nuevoTexto, setNuevoTexto] = useState('')
  const [nuevoBusy, setNuevoBusy] = useState(false)
  const [audit, setAudit] = useState<AuditEstado | null>(null)
  const [auditBusy, setAuditBusy] = useState(false)
  const [verReporte, setVerReporte] = useState(false)

  // Cliente inicial: el default guardado por el usuario (tilde) o Etiguel.
  useEffect(() => {
    (async () => {
      try {
        const [srcs, prefs] = await Promise.all([
          api.get<SourceOpt[]>('/admin/calidad/sources'),
          api.get<{ prefs: { default_source?: string } }>(`/me/preferences?pantalla=${PANTALLA}`),
        ])
        if (srcs.length) setSources(srcs)
        const def = prefs.prefs?.default_source
        if (def && srcs.some((s) => s.source === def)) { setSavedDefault(def); setSource(def) }
      } catch { /* usa el fallback */ }
    })()
  }, [])

  async function load(src: string) {
    setError(null)
    try {
      const q = `?source=${encodeURIComponent(src)}`
      const [revs, aprE, auditE] = await Promise.all([
        api.get<Revision[]>(`/admin/calidad/revisiones${q}`),
        api.get<AprEstado>(`/admin/calidad/aprendizajes${q}`),
        api.get<AuditEstado>(`/admin/calidad/auditoria-prompt${q}`),
      ])
      setRevisiones(revs)
      setApr(aprE)
      setAudit(auditE)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(source) }, [source])

  async function setDefault(checked: boolean) {
    const nuevo = checked ? source : FALLBACK_SOURCE
    setSavedDefault(nuevo)
    try { await api.put('/me/preferences', { pantalla: PANTALLA, prefs: { default_source: nuevo } }) } catch { /* noop */ }
  }

  async function crearRegistro() {
    const texto = nuevoTexto.trim()
    if (!texto || nuevoBusy) return
    setNuevoBusy(true)
    try {
      await api.post('/admin/calidad/reportar', { source, telefono: nuevoTel.trim() || null, texto })
      setNuevoOpen(false); setNuevoTel(''); setNuevoTexto('')
      await load(source)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo crear')
    } finally {
      setNuevoBusy(false)
    }
  }

  async function consolidar() {
    setAprBusy(true)
    try { await api.post(`/admin/calidad/aprendizajes/proponer?source=${encodeURIComponent(source)}`); await load(source) }
    finally { setAprBusy(false) }
  }

  async function auditarPrompt() {
    setAuditBusy(true)
    try {
      const r = await api.post<AuditEstado>(`/admin/calidad/auditoria-prompt?source=${encodeURIComponent(source)}`)
      setAudit(r); setVerReporte(true)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo auditar')
    } finally {
      setAuditBusy(false)
    }
  }
  async function aprobarApr(id: number) {
    if (!confirm('¿Aplicar estos aprendizajes al prompt de Camila? Se hace backup automático y es reversible.')) return
    setAprBusy(true)
    try { await api.post(`/admin/calidad/aprendizajes/${id}/aprobar`); setVerBloque(false); await load(source) }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo aplicar') }
    finally { setAprBusy(false) }
  }
  async function descartarApr(id: number) {
    setAprBusy(true)
    try { await api.post(`/admin/calidad/aprendizajes/${id}/descartar`); setVerBloque(false); await load(source) }
    finally { setAprBusy(false) }
  }

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
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <h1 className="text-xl font-semibold text-ink">Calidad de Camila</h1>
        <ClienteSelector
          sources={sources}
          value={source}
          onChange={setSource}
          isDefault={source === savedDefault}
          onSetDefault={setDefault}
        />
      </div>
      <p className="text-xs text-muted mb-3">
        <span className="font-semibold text-ink">Especialista Negocio</span> revisó las conversaciones y marcó
        respuestas que conviene mirar. Confirmá si Camila estuvo bien o mal — con eso afina su criterio.
      </p>

      <div className="mb-4">
        <button onClick={() => setNuevoOpen(true)}
          className="flex items-center gap-1.5 text-xs font-semibold border border-primary/50 text-primary rounded-lg px-3 py-1.5 hover:bg-primary/10">
          <Plus size={14} /> Nuevo registro de calidad
        </button>
      </div>

      {/* Modal: nuevo registro manual (teléfono + descripción) */}
      {nuevoOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setNuevoOpen(false)}>
          <div className="bg-card border border-line rounded-2xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-ink mb-1">Nuevo registro de calidad</h2>
            <p className="text-xs text-muted mb-3">
              Para <span className="font-semibold text-ink">{sources.find((s) => s.source === source)?.nombre ?? source}</span>.
              Entra ya confirmado como "Camila estuvo mal" y suma para las {apr?.umbral ?? 5} lecciones.
            </p>
            <label className="block text-xs text-muted mb-1">Teléfono <span className="text-muted/60">(opcional)</span></label>
            <input value={nuevoTel} onChange={(e) => setNuevoTel(e.target.value)} placeholder="Ej: 5491122334455"
              className="w-full text-sm bg-transparent border border-line rounded-lg px-3 py-2 mb-3 text-ink placeholder:text-muted" />
            <label className="block text-xs text-muted mb-1">¿Qué estuvo mal?</label>
            <textarea value={nuevoTexto} onChange={(e) => setNuevoTexto(e.target.value)} rows={4} autoFocus
              placeholder="Describí qué hizo mal Camila…"
              className="w-full text-sm bg-transparent border border-line rounded-lg px-3 py-2 mb-4 text-ink placeholder:text-muted resize-none" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setNuevoOpen(false)} disabled={nuevoBusy}
                className="text-sm font-semibold text-muted rounded-lg px-3 py-1.5 hover:text-ink disabled:opacity-50">Cancelar</button>
              <button onClick={crearRegistro} disabled={!nuevoTexto.trim() || nuevoBusy}
                className="text-sm font-semibold bg-primary text-on-primary rounded-lg px-4 py-1.5 hover:bg-primary-dark disabled:opacity-50">
                {nuevoBusy ? 'Creando…' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Aprendizajes de Camila (Capa B) */}
      {apr && (
        <div className={`rounded-xl border p-4 mb-5 ${apr.propuesta ? 'border-primary bg-primary/5' : 'border-line bg-card'}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-ink">🎓 Aprendizajes de Camila</span>
            {apr.propuesta ? (
              <span className="text-[11px] font-bold text-primary border border-primary/50 rounded px-1.5 py-0.5">Propuesta lista</span>
            ) : (
              <span className="text-xs text-muted">{apr.pendientes}/{apr.umbral} lecciones confirmadas</span>
            )}
            {apr.ultima_aplicada?.aplicada_at && (
              <span className="text-[11px] text-muted ml-auto">última: {fmtFecha(apr.ultima_aplicada.aplicada_at)}</span>
            )}
          </div>

          {/* Progreso: cuántas modificaciones ya están cargadas de las {umbral} antes de pasarlas al código de Camila */}
          <div className="flex items-center gap-2 mt-2">
            <div className="flex gap-1">
              {Array.from({ length: apr.umbral }).map((_, i) => (
                <span key={i} className={`h-2 w-6 rounded-full ${i < apr.pendientes ? 'bg-primary' : 'bg-line'}`} />
              ))}
            </div>
            <span className="text-xs text-muted">
              <span className="font-semibold text-ink">{apr.pendientes} de {apr.umbral}</span> modificaciones cargadas
            </span>
          </div>

          {apr.propuesta ? (
            <div className="mt-2">
              <p className="text-xs text-muted mb-2">Consolidé {apr.propuesta.n_lecciones} lección(es) en un bloque para el prompt de Camila. Revisalo y aprobalo.</p>
              <button onClick={() => setVerBloque((v) => !v)} className="text-xs text-primary hover:underline mb-2">
                {verBloque ? 'Ocultar' : 'Ver'} bloque propuesto
              </button>
              {verBloque && (
                <pre className="text-xs text-ink whitespace-pre-wrap break-words bg-black/20 rounded-lg p-3 mb-2 max-h-80 overflow-y-auto font-mono">{apr.propuesta.bloque_propuesto}</pre>
              )}
              <div className="flex gap-2">
                <button disabled={aprBusy} onClick={() => aprobarApr(apr.propuesta!.id)} className="text-xs font-semibold border border-emerald-500/50 text-emerald-500 rounded-lg px-3 py-1.5 hover:bg-emerald-500/10 disabled:opacity-50">
                  Aprobar y enseñar a Camila
                </button>
                <button disabled={aprBusy} onClick={() => descartarApr(apr.propuesta!.id)} className="text-xs font-semibold border border-line text-muted rounded-lg px-3 py-1.5 hover:text-ink disabled:opacity-50">
                  Descartar
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-3">
              <p className="text-xs text-muted flex-1">
                {apr.pendientes === 0
                  ? 'Cuando confirmes errores de Camila, se juntan acá para enseñárselos.'
                  : `Al llegar a ${apr.umbral} (o cuando quieras) consolido y te propongo un bloque para Camila.`}
              </p>
              <button disabled={aprBusy || apr.pendientes === 0} onClick={consolidar} className="text-xs font-semibold border border-primary/50 text-primary rounded-lg px-3 py-1.5 hover:bg-primary/10 disabled:opacity-40">
                Consolidar ahora
              </button>
            </div>
          )}
        </div>
      )}

      {/* Auditoría del prompt completo (nivel 2) */}
      {audit && (
        <div className={`rounded-xl border p-4 mb-5 ${audit.recomendar ? 'border-amber/60 bg-amber/5' : 'border-line bg-card'}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-ink">🧱 Auditoría del prompt de Camila</span>
            {audit.recomendar && (
              <span className="text-[11px] font-bold text-amber border border-amber/50 rounded px-1.5 py-0.5">conviene re-auditar</span>
            )}
            <span className="text-[11px] text-muted ml-auto">
              {audit.ultima_at ? `última: ${fmtFechaHora(audit.ultima_at)}` : 'nunca'}
            </span>
          </div>
          <p className="text-xs text-muted mt-2">
            Revisa el prompt entero (reglas duplicadas, contradicciones, estructura) para que al ir
            sumando correcciones nada se pise. <span className="text-ink">Se corre sola 1×/semana</span> y
            te avisa solo si encuentra algo; también podés correrla ahora.
          </p>
          {audit.resumen && <p className="text-xs text-ink mt-2">{audit.resumen}{audit.n_hallazgos ? ` · ${audit.n_hallazgos} hallazgo(s)` : ''}</p>}
          <div className="flex gap-2 mt-2 items-center flex-wrap">
            <button disabled={auditBusy} onClick={auditarPrompt} className="flex items-center gap-1.5 text-xs font-semibold border border-primary/50 text-primary rounded-lg px-3 py-1.5 hover:bg-primary/10 disabled:opacity-50">
              {auditBusy && <Loader2 size={13} className="animate-spin" />}
              {auditBusy ? 'Auditando el prompt…' : 'Auditar ahora'}
            </button>
            {(audit.hallazgos?.length || audit.reporte) && (
              <button onClick={() => setVerReporte((v) => !v)} className="text-xs text-primary hover:underline">
                {verReporte ? 'Ocultar' : 'Ver'} reporte
              </button>
            )}
            {(audit.hallazgos?.length || audit.reporte) && (
              <button onClick={() => abrirReporteHtml(audit, sources.find((s) => s.source === source)?.nombre ?? source)} className="text-xs text-primary hover:underline">
                Abrir en pestaña ↗
              </button>
            )}
          </div>
          {verReporte && (
            <div className="mt-3 space-y-2">
              {audit.hallazgos?.length ? audit.hallazgos.map((h, i) => {
                const m = HALLAZGO_META[h.tipo] || { emoji: '•', label: h.tipo || 'Hallazgo', color: '#8294b4' }
                return (
                  <div key={i} className="rounded-lg border border-line bg-app/40 p-3 border-l-4" style={{ borderLeftColor: m.color }}>
                    <div className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: m.color }}>{m.emoji} {m.label}</div>
                    <p className="text-sm text-ink">{h.detalle}</p>
                    {h.sugerencia && <p className="text-xs text-sky-400 mt-1.5"><span className="font-semibold">Sugerencia:</span> {h.sugerencia}</p>}
                  </div>
                )
              }) : audit.reporte ? (
                <pre className="text-xs text-ink whitespace-pre-wrap break-words bg-black/20 rounded-lg p-3 max-h-96 overflow-y-auto font-mono">{audit.reporte}</pre>
              ) : (
                <p className="text-sm text-emerald-500">✅ Sin problemas detectados.</p>
              )}
            </div>
          )}
        </div>
      )}

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
              {r.origen === 'sebi' && (
                <span className="text-[11px] font-bold text-primary border border-primary/50 rounded px-1.5 py-0.5">Reportado por vos</span>
              )}
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
                <div className="flex gap-2 flex-wrap items-center">
                  <button onClick={() => confirmar(r, 'acierto')} className="flex items-center gap-1 text-xs font-semibold border border-red-500/50 text-red-500 rounded-lg px-2.5 py-1.5 hover:bg-red-500/10">
                    <ThumbsUp size={12} /> Camila estuvo mal (acertaste)
                  </button>
                  <button onClick={() => confirmar(r, 'falso_positivo')} className="flex items-center gap-1 text-xs font-semibold border border-emerald-500/50 text-emerald-500 rounded-lg px-2.5 py-1.5 hover:bg-emerald-500/10">
                    <ThumbsDown size={12} /> Camila estuvo bien (te equivocaste)
                  </button>
                  <button onClick={() => borrar(r)} title="Borrar registro" className="flex items-center gap-1 text-xs font-semibold border border-line text-muted rounded-lg px-2.5 py-1.5 hover:border-red-500 hover:text-red-500 ml-auto">
                    <Trash2 size={12} /> Borrar
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
