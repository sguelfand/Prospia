import { KeyRound } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { api } from '../api/client'

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

  function field(k: keyof ClienteConfig, v: string) {
    setCfg((c) => (c ? { ...c, [k]: v } : c))
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
        negocio_nombre: cfg.negocio_nombre,
        negocio_que_vende: cfg.negocio_que_vende,
        negocio_propuesta_valor: cfg.negocio_propuesta_valor,
        negocio_zona: cfg.negocio_zona,
        pais: cfg.pais,
        sitio_web: cfg.sitio_web,
        deriva_nombre: cfg.deriva_nombre,
        deriva_whatsapp: cfg.deriva_whatsapp,
      })
      setCfg(updated)
      setClientes((cs) => cs.map((c) => (c.tenant_id === updated.tenant_id ? { ...c, nombre: updated.nombre } : c)))
      setMsg({ ok: true, text: 'Datos guardados' })
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
    <div className="max-w-xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold text-ink">Admin clientes</h1>

      <div className="bg-card border border-line rounded-2xl p-6">
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
          {/* Identidad / acceso */}
          <div className="bg-card border border-line rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Cliente y acceso</h2>
            <div>
              <label className={labelCls}>Nombre del cliente</label>
              <input value={cfg.nombre} onChange={(e) => field('nombre', e.target.value)} className={inputCls} />
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
              <label className={labelCls}>Nombre de contacto</label>
              <input
                value={cfg.user_nombre ?? ''}
                onChange={(e) => field('user_nombre', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <button
                type="button"
                onClick={resetPassword}
                disabled={cfg.user_id === null}
                className="inline-flex items-center gap-2 border border-line text-ink rounded-lg px-4 py-2 text-sm font-medium hover:bg-app disabled:opacity-50"
              >
                <KeyRound size={15} />
                Reset password
              </button>
              {resetMsg && <p className="text-sm text-emerald-500 mt-2">{resetMsg}</p>}
            </div>
          </div>

          {/* Negocio / contacto */}
          <div className="bg-card border border-line rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Negocio y contacto</h2>
            <div>
              <label className={labelCls}>Negocio (nombre)</label>
              <input
                value={cfg.negocio_nombre ?? ''}
                onChange={(e) => field('negocio_nombre', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Qué vende</label>
              <textarea
                value={cfg.negocio_que_vende ?? ''}
                onChange={(e) => field('negocio_que_vende', e.target.value)}
                rows={2}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Propuesta de valor</label>
              <textarea
                value={cfg.negocio_propuesta_valor ?? ''}
                onChange={(e) => field('negocio_propuesta_valor', e.target.value)}
                rows={2}
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Zona</label>
                <input
                  value={cfg.negocio_zona ?? ''}
                  onChange={(e) => field('negocio_zona', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>País</label>
                <input value={cfg.pais ?? ''} onChange={(e) => field('pais', e.target.value)} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Sitio web</label>
              <input
                value={cfg.sitio_web ?? ''}
                onChange={(e) => field('sitio_web', e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Deriva a (nombre)</label>
                <input
                  value={cfg.deriva_nombre ?? ''}
                  onChange={(e) => field('deriva_nombre', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>WhatsApp deriva</label>
                <input
                  value={cfg.deriva_whatsapp ?? ''}
                  onChange={(e) => field('deriva_whatsapp', e.target.value)}
                  className={inputCls}
                />
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
    </div>
  )
}
