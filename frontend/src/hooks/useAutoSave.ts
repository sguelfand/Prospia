import { useCallback, useEffect, useRef } from 'react'
import { useSaveStatus } from '../context/SaveStatus'

const BASE = '/api'

/**
 * Auto-guardado con debounce + flush al salir.
 *
 * - Detecta cambios serializando `payload` y comparándolo con lo último guardado.
 * - Guarda ~`delay`ms después de la última edición.
 * - Flushea lo pendiente al SALIR: al desmontar (navegación interna en la SPA) y
 *   en `beforeunload` (cerrar/recargar la pestaña), con `keepalive` para que el
 *   PUT sobreviva aunque la página se esté cerrando.
 * - Devuelve `flush()` para forzar el guardado manualmente antes de cambiar de
 *   entidad (p.ej. al elegir otro cliente sin desmontar el componente).
 *
 * `path` debe cambiar cuando cambia la entidad editada: al cambiar (o al pasar a
 * `ready`), la baseline se resetea a lo recién cargado (no re-guarda eso).
 */
export function useAutoSave({
  ready,
  payload,
  path,
  delay = 1000,
}: {
  ready: boolean
  payload: unknown
  path: string
  delay?: number
}) {
  const { beginSave, endSave } = useSaveStatus()
  const serialized = ready ? JSON.stringify(payload) : null

  const lastSavedRef = useRef<string | null>(null)
  // Siempre apunta al estado más reciente, para poder flushear desde cleanups.
  const latestRef = useRef<{ path: string; serialized: string | null }>({ path, serialized })
  latestRef.current = { path, serialized }

  const flush = useCallback(
    (keepalive = false) => {
      const { path: p, serialized: s } = latestRef.current
      if (s === null || s === lastSavedRef.current) return
      lastSavedRef.current = s // optimista: evita guardar dos veces lo mismo
      beginSave()
      const token = localStorage.getItem('token') ?? ''
      fetch(`${BASE}${p}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: s,
        keepalive,
      })
        .then((r) => {
          if (!r.ok) throw new Error('Error al guardar')
          endSave(true)
        })
        .catch((e) => {
          lastSavedRef.current = null // permitir reintento
          endSave(false, e instanceof Error ? e.message : 'Error al guardar')
        })
    },
    [beginSave, endSave],
  )

  // Baseline: al cargar o cambiar de entidad, tomamos lo actual como "guardado"
  // (no dispara un PUT por traer datos). No corre en cada edición.
  useEffect(() => {
    if (ready) lastSavedRef.current = serialized
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ready])

  // Debounce: guarda tras `delay` de inactividad desde la última edición.
  useEffect(() => {
    if (serialized === null || serialized === lastSavedRef.current) return
    const t = setTimeout(() => flush(false), delay)
    return () => clearTimeout(t)
  }, [serialized, delay, flush])

  // Flush al salir: desmontar (navegación interna) + cerrar/recargar la pestaña.
  useEffect(() => {
    const onBeforeUnload = () => flush(true)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      flush(true)
    }
  }, [flush])

  return flush
}
