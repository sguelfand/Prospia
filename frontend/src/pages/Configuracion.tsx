import { Eye, EyeOff } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { api } from '../api/client'

type Me = {
  id: number
  tenant_id: number
  email: string
  nombre: string | null
  role: string
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

  useEffect(() => {
    api
      .get<Me>('/auth/me')
      .then((me) => {
        setNombre(me.nombre ?? '')
        setEmail(me.email ?? '')
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
    <div className="max-w-xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold text-ink">Configuración</h1>

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

      {/* ── Notificaciones push (#38) ── */}
      <NotificacionesPush />
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
