import { Loader2, Play, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Termino } from '../api/types'

export default function Terminos() {
  const [terminos, setTerminos] = useState<Termino[]>([])
  const [nuevoTexto, setNuevoTexto] = useState('')
  const [polling, setPolling] = useState<Set<number>>(new Set())
  const navigate = useNavigate()

  async function load() {
    const data = await api.get<Termino[]>('/terminos')
    setTerminos(data)
  }

  useEffect(() => { load() }, [])

  // Polling para terminos con scraper corriendo
  useEffect(() => {
    const running = terminos.filter(t => t.scraper_running).map(t => t.id)
    if (running.length === 0) return
    const interval = setInterval(async () => {
      const updated = await api.get<Termino[]>('/terminos')
      setTerminos(updated)
      if (!updated.some(t => t.scraper_running)) clearInterval(interval)
    }, 3000)
    return () => clearInterval(interval)
  }, [terminos.map(t => t.scraper_running).join(',')])

  async function crear() {
    if (!nuevoTexto.trim()) return
    const t = await api.post<Termino>('/terminos', { texto: nuevoTexto.trim() })
    setTerminos(prev => [t, ...prev])
    setNuevoTexto('')
  }

  async function eliminar(id: number) {
    if (!confirm('¿Eliminar este término?')) return
    await api.delete(`/terminos/${id}`)
    setTerminos(prev => prev.filter(t => t.id !== id))
  }

  async function scrapear(id: number) {
    const status = await api.post<{ running: boolean }>(`/terminos/${id}/scraper/run`)
    if (status.running) {
      setTerminos(prev => prev.map(t => t.id === id ? { ...t, scraper_running: true } : t))
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl md:text-2xl font-bold">Términos de búsqueda</h1>

      {/* Agregar nuevo */}
      <div className="bg-card rounded-xl shadow p-4 md:p-5">
        <h2 className="font-semibold mb-3 text-sm md:text-base">Agregar término</h2>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <input
            type="text"
            placeholder="ej: distribuidores de materiales de construcción argentina"
            value={nuevoTexto}
            onChange={e => setNuevoTexto(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && crear()}
            className="flex-1 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={crear}
            className="flex items-center justify-center gap-2 bg-primary text-on-primary px-4 py-2 rounded-lg text-sm hover:bg-primary-dark"
          >
            <Plus size={16} />
            Agregar
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="space-y-3">
        {terminos.map(t => (
          <div key={t.id} className="bg-card rounded-xl shadow p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink text-sm leading-snug">{t.texto}</p>
                <div className="flex flex-wrap gap-3 mt-1.5 text-xs">
                  <button
                    onClick={() => navigate(`/prospects?termino_id=${t.id}`)}
                    className="text-muted hover:text-accent hover:underline"
                  >
                    {t.encontrados} encontrados
                  </button>
                  <button
                    onClick={() => navigate(`/prospects?termino_id=${t.id}&estado=interesado`)}
                    className="text-green-600 hover:text-green-700 hover:underline"
                  >
                    {t.interesados} interesados
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {t.scraper_running ? (
                  <span className="flex items-center gap-1 text-xs text-accent bg-primary-soft px-3 py-1.5 rounded whitespace-nowrap">
                    <Loader2 size={12} className="animate-spin" />
                    Scrapeando...
                  </span>
                ) : (
                  <button
                    onClick={() => scrapear(t.id)}
                    className="flex items-center gap-1 text-xs bg-green-50 text-green-700 px-3 py-1.5 rounded hover:bg-green-100 whitespace-nowrap"
                  >
                    <Play size={12} />
                    Scrapear
                  </button>
                )}
                <button
                  onClick={() => eliminar(t.id)}
                  className="text-faint hover:text-red-500 p-1.5 rounded"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {terminos.length === 0 && (
          <p className="text-center text-faint py-8">No hay términos todavía</p>
        )}
      </div>
    </div>
  )
}
