import { Eye, EyeOff, KeyRound, Plus, Trash2 } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { api } from '../api/client'
import InfoNegocio from '../components/InfoNegocio'

type ClienteResumen = { tenant_id: number; nombre: string; fuente: string }

type ClienteConfig = {
  tenant_id: number
  nombre: string
  slug: string
  user_id: number | null
  usuario: string | null
  user_nombre: string | null
  negocio_nombre: string | null
  negocio_que_vende: string | null
  negocio_propuesta_valor: string | null
  negocio_zona: string | null
  pais: string | null
  sitio_web: string | null
  deriva_nombre: string | null
  deriva_whatsapp: string | null
  bot_numero_whatsapp: string | null
  // Contacto y envío
  envio_auto_habilitado: boolean
  envio_tope_diario: number
  envio_delay_seg: number
  envio_hora_inicio: number
  envio_hora_fin: number
  wa_templates: string[]
  // Cadencia
  cadencia_dias: Record<string, number>
  cadencia_max_contactos: number
  cadencia_dias_cancelar: number
}

const inputCls =
  'w-full bg-app border border-line text-ink rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
const labelCls = 'block text-sm font-medium text-ink-soft mb-1'
const btnCls =
  'bg-primary text-on-primary rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary-dark disabled:opacity-50'

export default function AdminClientes() {
  const [clientes, setClientes] = useState<ClienteResumen[]>([])
  const [selectedId, setSelectedId] = useState<number | ''>('')
  const [cfg, setCfg] = useState<ClienteConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [resetMsg, setResetMsg] = useState<string | null>(null)
  const [newPwd, setNewPwd] = useState('')
  const [showPwd, setShowPwd] = useState(false)

  useEffect(() => {
    api
      .get<ClienteResumen[]>('/admin/clientes')
      .then((cs) => setClientes(cs.filter((c) => c.fuente === 'plataforma')))
      .catch(() => {})
  }, [])

  async function selectCliente(id: number | '') {
    setSelectedId(id)
    setCfg(null)
    setMsg(null)
    setResetMsg(null)
    setNewPwd('')
    setShowPwd(false)
    if (id === '') return
    setLoading(true)
    try {
      setCfg(await api.get<ClienteConfig>(`/admin/clientes/${id}/config`))
    } catch (err: unknown) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Error al cargar' })
    } finally {
      setLoading(false)
    }
  }

  function field<K extends keyof ClienteConfig>(k: K, v: ClienteConfig[K]) {
    setCfg((c) => (c ? { ...c, [k]: v } : c))
  }

  // Helpers para la lista de mensajes rotativos
  function setTemplate(i: number, v: string) {
    if (cfg) field('wa_templates', cfg.wa_templates.map((t, j) => (j === i ? v : t)))
  }
  function addTemplate() {
    if (cfg) field('wa_templates', [...cfg.wa_templates, ''])
  }
  function removeTemplate(i: number) {
    if (cfg) field('wa_templates', cfg.wa_templates.filter((_, j) => j !== i))
  }
  function setCadencia(k: string, v: number) {
    if (cfg) field('cadencia_dias', { ...cfg.cadencia_dias, [k]: v })
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!cfg) return
    setMsg(null)
    setResetMsg(null)
    setSaving(true)
    try {
      const updated = await api.put<ClienteConfig>(`/admin/clientes/${cfg.tenant_id}/config`, {
        nombre: cfg.nombre,
        usuario: cfg.usuario,
        user_nombre: cfg.user_nombre,
        password: newPwd.trim() || null,
        envio_auto_habilitado: cfg.envio_auto_habilitado,
        envio_tope_diario: cfg.envio_tope_diario,
        envio_delay_seg: cfg.envio_delay_seg,
        envio_hora_inicio: cfg.envio_hora_inicio,
        envio_hora_fin: cfg.envio_hora_fin,
        wa_templates: cfg.wa_templates.map((t) => t.trim()).filter(Boolean),
        cadencia_dias: cfg.cadencia_dias,
        cadencia_max_contactos: cfg.cadencia_max_contactos,
        cadencia_dias_cancelar: cfg.cadencia_dias_cancelar,
      })
      setCfg(updated)
      setClientes((cs) => cs.map((c) => (c.tenant_id === updated.tenant_id ? { ...c, nombre: updated.nombre } : c)))
      const cambioPass = newPwd.trim().length > 0
      setNewPwd('')
      setShowPwd(false)
      setMsg({ ok: true, text: cambioPass ? 'Datos y contraseña guardados' : 'Datos guardados' })
    } catch (err: unknown) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Error al guardar' })
    } finally {
      setSaving(false)
    }
  }

  async function resetPassword() {
    if (!cfg) return
    if (!confirm(`¿Resetear la contraseña de "${cfg.nombre}" a la default?`)) return
    setResetMsg(null)
    setMsg(null)
    try {
      const r = await api.post<{ password: string }>(`/admin/clientes/${cfg.tenant_id}/reset-password`)
      setResetMsg(`Contraseña reseteada a: ${r.password} — avisale al cliente que entre con eso y la cambie.`)
    } catch (err: unknown) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Error al resetear' })
    }
  }

  return (
    <div className="w-full space-y-6">
      <h1 className="text-xl font-semibold text-ink">Admin clientes</h1>

      <div className="bg-card border border-line rounded-2xl p-6 max-w-sm">
        <label className={labelCls}>Cliente</label>
        <select
          value={selectedId}
          onChange={(e) => selectCliente(e.target.value === '' ? '' : Number(e.target.value))}
          className={inputCls}
        >
          <option value="">— Elegí un cliente —</option>
          {clientes.map((c) => (
            <option key={c.tenant_id} value={c.tenant_id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-sm text-muted text-center">Cargando…</p>}

      {cfg && (
        <form onSubmit={save} className="space-y-6">
          <div className="grid lg:grid-cols-2 gap-6 items-start">
          {/* Identidad / acceso */}
          <div className="bg-card border border-line rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Cliente y acceso</h2>
            <div>
              <label className={labelCls}>Nombre del cliente</label>
              <input value={cfg.nombre} onChange={(e) => field('nombre', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Nombre de contacto</label>
              <input
                value={cfg.user_nombre ?? ''}
                onChange={(e) => field('user_nombre', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Usuario (login)</label>
              <input
                value={cfg.usuario ?? ''}
                onChange={(e) => field('usuario', e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                disabled={cfg.user_id === null}
                className={inputCls}
              />
              {cfg.user_id === null && (
                <p className="text-xs text-muted mt-1">Este cliente todavía no tiene usuario.</p>
              )}
            </div>
            <div>
              <label className={labelCls}>Contraseña</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder="••••••••"
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={cfg.user_id === null}
                  className={`${inputCls} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  title={showPwd ? 'Ocultar' : 'Ver'}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-ink"
                >
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-xs text-muted mt-1">
                Escribí una nueva para cambiarla. Vacío = no se modifica. (No se puede ver la actual: está encriptada.)
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={resetPassword}
                disabled={cfg.user_id === null}
                className="inline-flex items-center gap-2 border border-line text-ink rounded-lg px-4 py-2 text-sm font-medium hover:bg-app disabled:opacity-50"
              >
                <KeyRound size={15} />
                Reset a la default (12345)
              </button>
              {resetMsg && <p className="text-sm text-emerald-500 mt-2">{resetMsg}</p>}
            </div>
          </div>

          {/* Contacto y envío */}
          <div className="bg-card border border-line rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Contacto y envío</h2>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={cfg.envio_auto_habilitado}
                onChange={(e) => field('envio_auto_habilitado', e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Envío automático activado
            </label>
            <div>
              <label className={labelCls}>Máximo de contactos por día</label>
              <input
                type="number"
                min={0}
                value={cfg.envio_tope_diario}
                onChange={(e) => field('envio_tope_diario', Number(e.target.value) || 0)}
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Hora desde</label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={cfg.envio_hora_inicio}
                  onChange={(e) => field('envio_hora_inicio', Number(e.target.value) || 0)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Hora hasta</label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={cfg.envio_hora_fin}
                  onChange={(e) => field('envio_hora_fin', Number(e.target.value) || 0)}
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Delay entre envíos (segundos)</label>
              <input
                type="number"
                min={0}
                value={cfg.envio_delay_seg}
                onChange={(e) => field('envio_delay_seg', Number(e.target.value) || 0)}
                className={inputCls}
              />
            </div>
          </div>

          {/* Mensajes rotativos */}
          <div className="bg-card border border-line rounded-2xl p-6 space-y-3">
            <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Mensajes rotativos</h2>
            <p className="text-xs text-muted">
              El sistema elige uno al azar en cada contacto (rotación anti-ban). Podés usar{' '}
              <code className="text-ink">{'{agente}'}</code> y <code className="text-ink">{'{empresa}'}</code>.
              Si la lista queda vacía, se usan mensajes genéricos.
            </p>
            {cfg.wa_templates.map((t, i) => (
              <div key={i} className="flex gap-2 items-start">
                <textarea
                  value={t}
                  onChange={(e) => setTemplate(i, e.target.value)}
                  rows={2}
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={() => removeTemplate(i)}
                  title="Quitar"
                  className="text-muted hover:text-red-500 px-2 py-2 shrink-0"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addTemplate}
              className="inline-flex items-center gap-2 border border-line text-ink rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-app"
            >
              <Plus size={15} />
              Agregar mensaje
            </button>
          </div>

          {/* Cadencia de re-contacto */}
          <div className="bg-card border border-line rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Cadencia de re-contacto</h2>
            <div>
              <label className={labelCls}>Días entre intentos (1° → 2° → 3°)</label>
              <div className="grid grid-cols-3 gap-3">
                {['1', '2', '3'].map((k) => (
                  <input
                    key={k}
                    type="number"
                    min={0}
                    value={cfg.cadencia_dias[k] ?? 0}
                    onChange={(e) => setCadencia(k, Number(e.target.value) || 0)}
                    className={inputCls}
                  />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Máx. de contactos</label>
                <input
                  type="number"
                  min={1}
                  value={cfg.cadencia_max_contactos}
                  onChange={(e) => field('cadencia_max_contactos', Number(e.target.value) || 0)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Cancelar tras (días sin respuesta)</label>
                <input
                  type="number"
                  min={0}
                  value={cfg.cadencia_dias_cancelar}
                  onChange={(e) => field('cadencia_dias_cancelar', Number(e.target.value) || 0)}
                  className={inputCls}
                />
              </div>
            </div>
          </div>
          </div>

          {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-500' : 'text-red-500'}`}>{msg.text}</p>}
          <div>
            <button type="submit" disabled={saving} className={btnCls}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      )}

      {/* ── Información del negocio del cliente (relevamiento) — misma fuente que
           edita el cliente en su Configuración; se actualizan mutuamente ── */}
      {cfg && <InfoNegocio basePath={`/admin/clientes/${cfg.tenant_id}`} />}
    </div>
  )
}
