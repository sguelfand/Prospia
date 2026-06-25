import { Download, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { api } from '../api/client'

type Me = {
  id: number
  tenant_id: number
  email: string
  nombre: string | null
  role: string
  nivel: number
}

const inputCls =
  'w-full bg-app border border-line text-ink rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
const labelCls = 'block text-sm font-medium text-ink-soft mb-1'
const btnCls =
  'bg-primary text-on-primary rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary-dark disabled:opacity-50'

export default function Configuracion() {
  // ── Perfil ──
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // ── Contraseña ──
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [repeatPwd, setRepeatPwd] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [savingPwd, setSavingPwd] = useState(false)
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // nivel 1 = superadmin. Las herramientas internas (push, inicializar prueba)
  // solo se muestran al superadmin; el cliente normal ve Perfil + Información del negocio.
  const [nivel, setNivel] = useState<number | null>(null)

  useEffect(() => {
    api
      .get<Me>('/auth/me')
      .then((me) => {
        setNombre(me.nombre ?? '')
        setEmail(me.email ?? '')
        setNivel(me.nivel)
      })
      .catch(() => {})
  }, [])

  async function saveProfile(e: FormEvent) {
    e.preventDefault()
    setProfileMsg(null)
    setSavingProfile(true)
    try {
      const me = await api.patch<Me>('/auth/me', { nombre: nombre.trim() || null, email: email.trim() })
      setNombre(me.nombre ?? '')
      setEmail(me.email ?? '')
      setProfileMsg({ ok: true, text: 'Datos guardados' })
    } catch (err: unknown) {
      setProfileMsg({ ok: false, text: err instanceof Error ? err.message : 'Error al guardar' })
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault()
    setPwdMsg(null)
    if (newPwd.length < 6) {
      setPwdMsg({ ok: false, text: 'La nueva contraseña debe tener al menos 6 caracteres' })
      return
    }
    if (newPwd !== repeatPwd) {
      setPwdMsg({ ok: false, text: 'Las contraseñas no coinciden' })
      return
    }
    setSavingPwd(true)
    try {
      await api.post('/auth/change-password', { current_password: currentPwd, new_password: newPwd })
      setCurrentPwd('')
      setNewPwd('')
      setRepeatPwd('')
      setPwdMsg({ ok: true, text: 'Contraseña actualizada' })
    } catch (err: unknown) {
      setPwdMsg({ ok: false, text: err instanceof Error ? err.message : 'Error al cambiar la contraseña' })
    } finally {
      setSavingPwd(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-ink">Configuración</h1>

      {/* ── Perfil: usuario + contraseña (lo que ya estaba) ── */}
      <h2 className="text-xs font-semibold text-muted uppercase tracking-wide">Perfil</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* ── Perfil / usuario ── */}
      <form onSubmit={saveProfile} className="bg-card border border-line rounded-2xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Usuario</h2>
        <div>
          <label className={labelCls}>Nombre</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Usuario</label>
          <input
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={inputCls}
          />
        </div>
        {profileMsg && (
          <p className={`text-sm ${profileMsg.ok ? 'text-emerald-500' : 'text-red-500'}`}>{profileMsg.text}</p>
        )}
        <div>
          <button type="submit" disabled={savingProfile} className={btnCls}>
            {savingProfile ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </form>

      {/* ── Cambiar contraseña ── */}
      <form onSubmit={savePassword} className="bg-card border border-line rounded-2xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Cambiar contraseña</h2>
        <div>
          <label className={labelCls}>Contraseña actual</label>
          <input
            type={showPwd ? 'text' : 'password'}
            value={currentPwd}
            onChange={(e) => setCurrentPwd(e.target.value)}
            required
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Nueva contraseña</label>
          <div className="relative">
            <input
              type={showPwd ? 'text' : 'password'}
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              required
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
        </div>
        <div>
          <label className={labelCls}>Repetir nueva contraseña</label>
          <input
            type={showPwd ? 'text' : 'password'}
            value={repeatPwd}
            onChange={(e) => setRepeatPwd(e.target.value)}
            required
            className={inputCls}
          />
        </div>
        {pwdMsg && <p className={`text-sm ${pwdMsg.ok ? 'text-emerald-500' : 'text-red-500'}`}>{pwdMsg.text}</p>}
        <div>
          <button type="submit" disabled={savingPwd} className={btnCls}>
            {savingPwd ? 'Guardando...' : 'Cambiar contraseña'}
          </button>
        </div>
      </form>

      </div>

      {/* ── Información del negocio (relevamiento) — cliente y superadmin ── */}
      <InfoNegocio />

      {/* ── Herramientas internas: solo superadmin (nivel 1) ── */}
      {nivel === 1 && (
        <>
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wide pt-2">Herramientas internas</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* ── Notificaciones push (#38) ── */}
            <NotificacionesPush />
            {/* ── Inicializar prueba de Camila (Etiguel) ── */}
            <InicializarPrueba />
          </div>
        </>
      )}
    </div>
  )
}

// ── Notificaciones push por dispositivo (#38) ────────────────────────────────
type NotifEvento = { evento: string; label: string; enabled: boolean }
type NotifPrefs = { expo_token: string; platform: string | null; eventos: NotifEvento[] }
type Device = { expo_token: string; platform: string | null }

function NotificacionesPush() {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [prefs, setPrefs] = useState<Record<string, NotifEvento[]>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<Device[]>('/admin/devices')
      .then(async (devs) => {
        setDevices(devs)
        const entries = await Promise.all(
          devs.map(async (d) => {
            const p = await api.get<NotifPrefs>(`/admin/notif-prefs?expo_token=${encodeURIComponent(d.expo_token)}`)
            return [d.expo_token, p.eventos] as const
          }),
        )
        setPrefs(Object.fromEntries(entries))
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Error al cargar dispositivos'))
  }, [])

  async function toggle(expoToken: string, evento: string, enabled: boolean) {
    setPrefs((prev) => ({
      ...prev,
      [expoToken]: (prev[expoToken] ?? []).map((e) => (e.evento === evento ? { ...e, enabled } : e)),
    }))
    try {
      await api.put<NotifPrefs>('/admin/notif-prefs', { expo_token: expoToken, evento, enabled })
    } catch {
      setPrefs((prev) => ({
        ...prev,
        [expoToken]: (prev[expoToken] ?? []).map((e) => (e.evento === evento ? { ...e, enabled: !enabled } : e)),
      }))
    }
  }

  function nombreDevice(d: Device, i: number) {
    const plat = d.platform === 'android' ? 'Android' : d.platform === 'ios' ? 'iOS' : 'Dispositivo'
    return `${plat} ${devices && devices.length > 1 ? `#${i + 1}` : ''}`.trim()
  }

  return (
    <div className="bg-card border border-line rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Notificaciones push</h2>
        <p className="text-xs text-muted mt-1">Qué avisos recibe cada dispositivo con la app instalada.</p>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {devices && devices.length === 0 && (
        <p className="text-sm text-muted">No hay dispositivos registrados. Iniciá sesión en la app para registrar uno.</p>
      )}
      {devices?.map((d, i) => (
        <div key={d.expo_token} className="border border-line rounded-xl p-4">
          <p className="text-sm font-medium text-ink mb-2">{nombreDevice(d, i)}</p>
          <div className="space-y-2">
            {(prefs[d.expo_token] ?? []).map((e) => (
              <label key={e.evento} className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-sm text-ink-soft">{e.label}</span>
                <input
                  type="checkbox"
                  checked={e.enabled}
                  onChange={(ev) => toggle(d.expo_token, e.evento, ev.target.checked)}
                  className="h-4 w-4 accent-primary cursor-pointer"
                />
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Inicializar prueba de Camila (Etiguel) ───────────────────────────────────
// Borra todo rastro de un número de teléfono de prueba (espejo en la DB de
// Prospia + memoria local de Camila vía el webhook) para re-testear desde cero.
const TELEFONO_PRUEBA_DEFAULT = '+5491123146373'

type ResetNumeroPruebaOut = {
  telefono: string
  digits: string
  db_borrado: { mirrors: number; mensajes: number }
  webhook_ok: boolean
  webhook_respuesta: Record<string, unknown> | null
  webhook_error: string | null
}

function InicializarPrueba() {
  const [confirmando, setConfirmando] = useState(false)
  const [telefono, setTelefono] = useState(TELEFONO_PRUEBA_DEFAULT)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; text: string } | null>(null)

  function abrir() {
    setTelefono(TELEFONO_PRUEBA_DEFAULT)
    setResultado(null)
    setConfirmando(true)
  }

  async function confirmar() {
    setEnviando(true)
    setResultado(null)
    try {
      const r = await api.post<ResetNumeroPruebaOut>('/admin/etiguel/reset-numero-prueba', {
        telefono,
      })
      const { mirrors, mensajes } = r.db_borrado
      const partesDb = `DB: ${mirrors} espejo${mirrors === 1 ? '' : 's'} y ${mensajes} mensaje${mensajes === 1 ? '' : 's'}`
      const partesWebhook = r.webhook_ok
        ? 'Memoria de Camila limpiada.'
        : `Webhook NO limpió la memoria (${r.webhook_error ?? 'error desconocido'}).`
      setResultado({ ok: r.webhook_ok, text: `${partesDb}. ${partesWebhook}` })
      setConfirmando(false)
    } catch (e) {
      setResultado({ ok: false, text: e instanceof Error ? e.message : 'Error al inicializar la prueba.' })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="bg-card border border-line rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Inicializar prueba</h2>
        <p className="text-xs text-muted mt-1">
          Borra todo rastro de un número de prueba (espejo en la app + memoria de Camila) para volver a testear desde cero.
        </p>
      </div>

      {!confirmando && (
        <button type="button" onClick={abrir} className={btnCls}>
          Inicializar prueba
        </button>
      )}

      {confirmando && (
        <div className="border border-line rounded-xl p-4 space-y-3">
          <p className="text-sm text-ink-soft">
            Esto va a borrar el espejo y la memoria de Camila para este número. Confirmá el teléfono a limpiar:
          </p>
          <div>
            <label className={labelCls}>Teléfono de prueba</label>
            <input
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              className={inputCls}
            />
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={confirmar} disabled={enviando} className={btnCls}>
              {enviando ? 'Limpiando…' : 'Confirmar y limpiar'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              disabled={enviando}
              className="border border-line text-ink rounded-lg px-4 py-2 text-sm font-medium hover:bg-app disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {resultado && (
        <p className={`text-sm ${resultado.ok ? 'text-emerald-500' : 'text-red-500'}`}>{resultado.text}</p>
      )}
    </div>
  )
}

// ── Información del negocio (relevamiento, editable por el cliente) ───────────
// Renderiza el mismo esquema del formulario de intake, ya cargado con lo que el
// cliente completó, todo editable. El cliente puede corregir, ampliar y agregar
// campos libres. Los archivos subidos en el relevamiento se listan para descarga.
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

async function descargarArchivo(a: ArchivoMeta) {
  // El endpoint exige auth (Bearer), por eso no se puede usar un <a href> directo:
  // bajamos el blob con el token y disparamos la descarga.
  const token = localStorage.getItem('token') ?? ''
  const res = await fetch(`/api/me/archivo/${encodeURIComponent(a.id)}`, {
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

function InfoNegocio() {
  const [data, setData] = useState<InfoNegocioResp | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [extra, setExtra] = useState<{ label: string; valor: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    api
      .get<InfoNegocioResp>('/me/info-negocio')
      .then((d) => {
        setData(d)
        setValues(d.values || {})
        setExtra(d.extra || [])
      })
      .catch(() => setData(null))
  }, [])

  function setVal(id: string, v: unknown) {
    setValues((prev) => ({ ...prev, [id]: v }))
  }

  async function guardar() {
    setSaving(true)
    setMsg(null)
    try {
      await api.put('/me/info-negocio', { values, extra: extra.filter((e) => e.label.trim() || e.valor.trim()) })
      setMsg({ ok: true, text: 'Información guardada' })
    } catch (err: unknown) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Error al guardar' })
    } finally {
      setSaving(false)
    }
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
                  <button type="button" onClick={() => descargarArchivo(a)} title="Descargar" className="text-primary hover:text-primary-dark shrink-0">
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wide">Información del negocio</h2>
          <p className="text-xs text-muted mt-1">
            {sinCargar
              ? 'Todavía no se completó el relevamiento. Podés cargarlo acá o desde el formulario que te compartimos.'
              : 'Lo que sabemos de tu negocio. Editá, ampliá o agregá lo que quieras — lo usamos para encontrar mejores clientes.'}
          </p>
        </div>
        {data.updated_at && (
          <span className="text-xs text-muted">Última edición: {new Date(data.updated_at).toLocaleDateString('es-AR')}</span>
        )}
      </div>

      {data.secciones.map((s) => (
        <div key={s.id} className="bg-card border border-line rounded-2xl p-6 space-y-4">
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
      <div className="bg-card border border-line rounded-2xl p-6 space-y-4">
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

      <div className="flex items-center gap-3">
        <button type="button" onClick={guardar} disabled={saving} className={btnCls}>
          {saving ? 'Guardando...' : 'Guardar información'}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-500' : 'text-red-500'}`}>{msg.text}</span>}
      </div>
    </div>
  )
}
