/**
 * Asistente del cliente (Haiku) — dos accesos, solo para usuarios normales (nivel 2):
 *
 *  - <AyudaFlotante />      botón flotante abajo a la derecha en todas las pantallas:
 *                           chat "¿cómo uso esto?", con el contexto de la pantalla activa.
 *  - <ReportarErrorButton /> botón al lado del toggle de tema: chat para reportar un
 *                           error; cuando Haiku ya tiene la info, carga el ticket en la
 *                           cola de errores y le confirma al cliente.
 *
 * Ambos comparten <ChatPanel>. La identidad es Prospia (navy/ámbar).
 */
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AlertTriangle, HelpCircle, Send, X } from 'lucide-react'
import { api } from '../api/client'
import { pantallaPorPath } from './pantallasAyuda'

type Msg = { role: 'user' | 'assistant'; content: string }

interface ChatPanelProps {
  titulo: string
  subtitulo: string
  saludo: string
  placeholder: string
  enviar: (historial: Msg[]) => Promise<{ respuesta: string; cerrado?: boolean }>
  onClose: () => void
}

function ChatPanel({ titulo, subtitulo, saludo, placeholder, enviar, onClose }: ChatPanelProps) {
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'assistant', content: saludo }])
  const [texto, setTexto] = useState('')
  const [cargando, setCargando] = useState(false)
  const [cerrado, setCerrado] = useState(false)
  const finRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, cargando])

  async function onEnviar() {
    const t = texto.trim()
    if (!t || cargando || cerrado) return
    const historial = [...msgs, { role: 'user' as const, content: t }]
    setMsgs(historial)
    setTexto('')
    setCargando(true)
    try {
      const { respuesta, cerrado: fin } = await enviar(historial)
      setMsgs((m) => [...m, { role: 'assistant', content: respuesta }])
      if (fin) setCerrado(true)
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { role: 'assistant', content: 'Uy, no pude responder en este momento. Probá de nuevo en un ratito.' },
      ])
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-end p-0 sm:p-4 sm:items-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 flex flex-col w-full sm:w-[380px] h-[80vh] sm:h-[520px] max-h-[90vh] bg-card border border-line rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-navy text-fog shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">{titulo}</p>
            <p className="text-xs text-[#8294B4] leading-tight truncate">{subtitulo}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-[#8294B4] hover:text-fog">
            <X size={18} />
          </button>
        </div>

        {/* Mensajes */}
        <div className="flex-1 overflow-auto p-3 space-y-2.5 bg-app">
          {msgs.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={
                  'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ' +
                  (m.role === 'user'
                    ? 'bg-amber text-navy rounded-br-sm'
                    : 'bg-subtle text-ink border border-line rounded-bl-sm')
                }
              >
                {m.content}
              </div>
            </div>
          ))}
          {cargando && (
            <div className="flex justify-start">
              <div className="bg-subtle text-muted border border-line rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm">
                Escribiendo…
              </div>
            </div>
          )}
          <div ref={finRef} />
        </div>

        {/* Input */}
        <div className="p-2.5 border-t border-line bg-card shrink-0">
          {cerrado ? (
            <button
              onClick={onClose}
              className="w-full rounded-xl bg-subtle text-ink border border-line py-2.5 text-sm font-medium hover:bg-line/40"
            >
              Cerrar
            </button>
          ) : (
            <div className="flex items-end gap-2">
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    onEnviar()
                  }
                }}
                rows={1}
                placeholder={placeholder}
                className="flex-1 resize-none max-h-28 rounded-xl border border-line bg-app px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:border-amber"
              />
              <button
                onClick={onEnviar}
                disabled={cargando || !texto.trim()}
                aria-label="Enviar"
                className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl bg-amber text-navy disabled:opacity-40 hover:opacity-90"
              >
                <Send size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Botón flotante de ayuda (abajo a la derecha, en todas las pantallas) ── */
export function AyudaFlotante() {
  const [abierto, setAbierto] = useState(false)
  const loc = useLocation()

  async function enviar(historial: Msg[]) {
    const p = pantallaPorPath(loc.pathname)
    const { respuesta } = await api.post<{ respuesta: string }>('/me/ayuda', {
      mensajes: historial,
      pantalla_titulo: p.titulo,
      pantalla_funciones: p.funciones,
    })
    return { respuesta }
  }

  return (
    <>
      {!abierto && (
        <button
          onClick={() => setAbierto(true)}
          title="¿Necesitás ayuda?"
          aria-label="Abrir ayuda"
          className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full bg-navy text-fog shadow-lg pl-3.5 pr-4 py-3 hover:bg-navy/90 transition-colors"
        >
          <HelpCircle size={20} className="text-amber" />
          <span className="text-sm font-medium hidden sm:inline">Ayuda</span>
        </button>
      )}
      {abierto && (
        <ChatPanel
          titulo="Ayuda de Prospia"
          subtitulo="Te explico cómo usar esta pantalla"
          saludo="¡Hola! Soy la ayuda de Prospia. Contame qué querés hacer y te explico paso a paso. 🙂"
          placeholder="Escribí tu duda…"
          enviar={enviar}
          onClose={() => setAbierto(false)}
        />
      )}
    </>
  )
}

/* ── Botón "Reportar error" (al lado del toggle de tema) ── */
export function ReportarErrorButton({ className = '' }: { className?: string }) {
  const [abierto, setAbierto] = useState(false)
  const loc = useLocation()

  async function enviar(historial: Msg[]) {
    const p = pantallaPorPath(loc.pathname)
    const { respuesta, cargado } = await api.post<{ respuesta: string; cargado: boolean }>(
      '/me/reportar-error',
      { mensajes: historial, pantalla_titulo: p.titulo },
    )
    return { respuesta, cerrado: cargado }
  }

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        title="Reportar un error"
        aria-label="Reportar un error"
        className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line text-muted hover:text-ink hover:bg-subtle transition-colors ${className}`}
      >
        <AlertTriangle size={17} />
      </button>
      {abierto && (
        <ChatPanel
          titulo="Reportar un error"
          subtitulo="Contame qué no funcionó y lo registro"
          saludo="Contame qué fue lo que no funcionó o no anduvo como esperabas. Te voy a hacer un par de preguntas para entenderlo bien y dejarlo registrado para el equipo."
          placeholder="Describí el problema…"
          enviar={enviar}
          onClose={() => setAbierto(false)}
        />
      )}
    </>
  )
}
