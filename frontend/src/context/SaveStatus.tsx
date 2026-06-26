import { AlertCircle, Check, Loader2 } from 'lucide-react'
import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react'

// Estado de guardado global, compartido por las páginas con auto-save (Admin
// clientes, Información del negocio) y el indicador del header. Cuenta los PUT
// en vuelo: mientras haya ≥1, muestra "Guardando…"; al terminar todos, "Todo
// guardado · HH:MM".
type Status = 'idle' | 'saving' | 'saved' | 'error'

type Ctx = {
  status: Status
  savedAt: number | null
  errorText: string | null
  beginSave: () => void
  endSave: (ok: boolean, errorText?: string) => void
}

const SaveStatusContext = createContext<Ctx | null>(null)

export function SaveStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const inFlight = useRef(0)

  const beginSave = useCallback(() => {
    inFlight.current += 1
    setStatus('saving')
    setErrorText(null)
  }, [])

  const endSave = useCallback((ok: boolean, err?: string) => {
    inFlight.current = Math.max(0, inFlight.current - 1)
    if (!ok) {
      setStatus('error')
      setErrorText(err ?? 'Error al guardar')
      return
    }
    if (inFlight.current === 0) {
      setSavedAt(Date.now())
      setStatus('saved')
    }
  }, [])

  const value = useMemo(
    () => ({ status, savedAt, errorText, beginSave, endSave }),
    [status, savedAt, errorText, beginSave, endSave],
  )
  return <SaveStatusContext.Provider value={value}>{children}</SaveStatusContext.Provider>
}

const NOOP: Ctx = { status: 'idle', savedAt: null, errorText: null, beginSave: () => {}, endSave: () => {} }

export function useSaveStatus(): Ctx {
  return useContext(SaveStatusContext) ?? NOOP
}

export function SaveStatusIndicator() {
  const { status, savedAt, errorText } = useSaveStatus()
  if (status === 'idle') return null
  if (status === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <Loader2 size={14} className="animate-spin" />
        Guardando…
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-500">
        <AlertCircle size={14} />
        {errorText ?? 'Error al guardar'}
      </span>
    )
  }
  const hora = savedAt ? new Date(savedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''
  return (
    <span className="flex items-center gap-1.5 text-xs text-emerald-500">
      <Check size={14} />
      Todo guardado{hora ? ` · ${hora}` : ''}
    </span>
  )
}
