import { ChevronDown, Eye, EyeOff } from 'lucide-react'
import { FormEvent, ReactNode, useEffect, useState } from 'react'
import { api } from '../api/client'
import InfoNegocio from '../components/InfoNegocio'

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

// ── Sección colapsable: el título es un botón con chevron; arranca cerrada ────
function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-card border border-line rounded-2xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-6 py-4 text-left"
      >
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <ChevronDown size={18} className={`text-muted transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="px-6 pb-6">{children}</div>}
    </div>
  )
}

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
      <CollapsibleSection title="Perfil">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* ── Perfil / usuario ── */}
      <form onSubmit={saveProfile} className="space-y-4">
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
      <form onSubmit={savePassword} className="space-y-4">
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
      </CollapsibleSection>

      {/* ── Información del negocio (relevamiento) — solo el cliente; el superadmin
           la gestiona por cliente desde Admin clientes ── */}
      {nivel !== null && nivel !== 1 && <InfoNegocio />}

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
type NotifEvento = { evento: string; label: string; descripcion?: string; enabled: boolean }
type NotifPrefs = { expo_token: string; platform: string | null; eventos: NotifEvento[] }
type Device = { expo_token: string; platform: string | null }

// Ícono "i" con descripción breve al lado de cada notificación (ver
// feedback_notificacion_info_descripcion): toda notificación nueva lleva su "i".
function InfoDot({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o) }}
        onBlur={() => setOpen(false)}
        title={descripcion}
        aria-label={`Qué es ${titulo}`}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-muted text-[10px] font-bold leading-none text-muted hover:border-primary hover:text-primary"
      >
        i
      </button>
      {open && (
        <span className="absolute left-0 top-6 z-10 w-60 rounded-lg border border-line bg-card p-3 text-xs leading-relaxed text-ink-soft shadow-lg">
          <span className="mb-1 block font-semibold text-ink">{titulo}</span>
          {descripcion}
        </span>
      )}
    </span>
  )
}

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
                <span className="flex items-center gap-2">
                  {e.descripcion && <InfoDot titulo={e.label} descripcion={e.descripcion} />}
                  <span className="text-sm text-ink-soft">{e.label}</span>
                </span>
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
