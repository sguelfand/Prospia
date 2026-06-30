import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react'
// react-grid-layout v2 movió Responsive/WidthProvider al subpath `/legacy`
// (el entry principal ya no exporta WidthProvider). Importarlos como named
// exports desde ahí. Si se importa del entry principal, WidthProvider queda
// undefined y `WidthProvider(Responsive)` crashea TODA la app al cargar.
import { Responsive, WidthProvider } from 'react-grid-layout/legacy'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import './dashboard-grid.css'
import { api } from '../api/client'

const ResponsiveGrid = WidthProvider(Responsive as any) as any

type LayoutItem = { i: string; x: number; y: number; w: number; h: number; minH?: number; minW?: number; [k: string]: unknown }
type Layouts = { [bp: string]: LayoutItem[] }

const COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }

// Contexto del tablero: títulos custom (renombrables).
type WidgetCtx = {
  get: (id: string, def: string) => string
  set: (id: string, t: string) => void
}
const TitulosContext = createContext<WidgetCtx>({ get: (_i, d) => d, set: () => {} })

/**
 * Tablero de widgets movibles + redimensionables + responsive.
 * Cada hijo <Widget id=…> es un cuadro con grip de 6 puntitos (se arrastra desde
 * ahí) y se puede agrandar/achicar desde la esquina. El layout se guarda por
 * usuario (GET/PUT /me/layout?pantalla=). Patrón a reusar en TODA pantalla con
 * gráficos (ver CLAUDE.md).
 */
export function DashboardGrid({
  pantalla, defaultLayout, rowHeight = 40, children,
}: {
  pantalla: string
  defaultLayout: Layouts
  rowHeight?: number
  children: ReactNode
}) {
  const [layouts, setLayouts] = useState<Layouts>(defaultLayout)
  const [titulos, setTitulos] = useState<Record<string, string>>({})
  const [ready, setReady] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let vivo = true
    api.get<{ layout: Layouts; titulos?: Record<string, string> }>(`/me/layout?pantalla=${encodeURIComponent(pantalla)}`)
      .then((r) => {
        if (!vivo) return
        if (r.layout && Object.keys(r.layout).length > 0) setLayouts(mergeDefaults(r.layout, defaultLayout))
        if (r.titulos) setTitulos(r.titulos)
        setReady(true)
      })
      .catch(() => { if (vivo) setReady(true) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pantalla])

  function onLayoutChange(_cur: LayoutItem[], all: Layouts) {
    if (!ready) return
    setLayouts(all)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api.put('/me/layout', { pantalla, layout: all }).catch(() => {})
    }, 800)
  }

  const titCtx: WidgetCtx = {
    get: (id, def) => titulos[id] ?? def,
    set: (id, t) => {
      setTitulos((prev) => {
        const next = { ...prev }
        if (t.trim()) next[id] = t.trim(); else delete next[id]
        api.put('/me/layout', { pantalla, titulos: next }).catch(() => {})
        return next
      })
    },
  }

  function resetear() {
    setLayouts(defaultLayout)
    setTitulos({})
    api.put('/me/layout', { pantalla, layout: defaultLayout, titulos: {} }).catch(() => {})
  }

  return (
    <TitulosContext.Provider value={titCtx}>
      <div className="relative">
        <button onClick={resetear} title="Volver al orden y títulos originales"
          className="absolute -top-9 right-0 text-xs text-muted hover:text-ink z-10">↺ Reordenar</button>
        <ResponsiveGrid
          className="layout"
          layouts={layouts}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          rowHeight={rowHeight}
          margin={[16, 16]}
          draggableHandle=".rgl-grip"
          isResizable
          isBounded
          onLayoutChange={onLayoutChange}
        >
          {children}
        </ResponsiveGrid>
      </div>
    </TitulosContext.Provider>
  )
}

/** Asegura que todo widget del default exista en el layout guardado (por si se
 * agregó un widget nuevo después de que el usuario guardó su layout). */
function mergeDefaults(saved: Layouts, def: Layouts): Layouts {
  const out: Layouts = { ...saved }
  for (const bp of Object.keys(def)) {
    const d = def[bp] || []
    const s = out[bp] || []
    const ids = new Set(s.map((x) => x.i))
    out[bp] = [...s, ...d.filter((x) => !ids.has(x.i))]
  }
  return out
}

/** Un widget del tablero: cuadro con grip de 6 puntitos (arrastrar) + título
 * EDITABLE (click para renombrar, se guarda por usuario) + chip de fuente. */
export function Widget({ id, title = '', fuente, right, children }: {
  id: string; title?: string; fuente?: 'anthropic' | 'openclaw'; right?: ReactNode; children: ReactNode
}) {
  const tit = useContext(TitulosContext)
  const actual = tit.get(id, title)
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(actual)

  function abrir() { setValor(actual); setEditando(true) }
  function guardar() { setEditando(false); if (valor !== actual) tit.set(id, valor) }

  return (
    <div className="h-full bg-card border border-line rounded-2xl flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line/60">
        <span className="rgl-grip cursor-grab active:cursor-grabbing -ml-0.5 text-muted hover:text-ink shrink-0" title="Arrastrar para reordenar">
          <GripDots />
        </span>
        {editando ? (
          <input
            autoFocus value={valor}
            onChange={(e) => setValor(e.target.value)}
            onBlur={guardar}
            onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditando(false) }}
            className="text-xs font-semibold text-ink uppercase tracking-wide bg-app border border-primary/50 rounded px-1.5 py-0.5 min-w-0 flex-1"
            placeholder="Título del widget"
          />
        ) : (
          <button onClick={abrir} title="Click para renombrar"
            className="group flex items-center gap-1 min-w-0 text-left">
            <h2 className="text-xs font-semibold text-ink-soft uppercase tracking-wide truncate group-hover:text-ink">{actual}</h2>
            <Pencil />
          </button>
        )}
        {fuente && <FuenteChip fuente={fuente} />}
        {right && <div className="ml-auto shrink-0">{right}</div>}
      </div>
      {/* min-h-0 permite que un gráfico hijo con h-full llene el alto del widget */}
      <div className="flex-1 min-h-0 overflow-auto p-4 flex flex-col">{children}</div>
    </div>
  )
}

function Pencil() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="shrink-0 opacity-0 group-hover:opacity-60 text-muted" aria-hidden>
      <path d="M11.5 2.5l2 2L6 12l-2.5.5.5-2.5 7.5-7.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function FuenteChip({ fuente }: { fuente: 'anthropic' | 'openclaw' }) {
  const cfg = fuente === 'anthropic'
    ? { label: 'API Anthropic', cls: 'border-sky-500/50 text-sky-400 bg-sky-500/10' }
    : { label: 'OpenClaw', cls: 'border-primary/50 text-primary bg-primary/10' }
  return (
    <span className={`shrink-0 text-[9.5px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide ${cfg.cls}`}
      title={fuente === 'anthropic' ? 'Funciones internas que usan la API de Anthropic directa' : 'Costo de Camila sobre OpenClaw / gateway MyClaw'}>
      {cfg.label}
    </span>
  )
}

function GripDots() {
  return (
    <svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor" aria-hidden>
      {[5, 10, 15].map((cy) => [4, 10].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.5" />))}
    </svg>
  )
}

/** Helper para armar layouts responsive a partir de una sola definición `lg`
 * (x,y,w,h por id). Para md usa lo mismo; para sm/xs/xxs apila a ancho completo. */
export function buildLayouts(items: { i: string; x: number; y: number; w: number; h: number; minH?: number }[]): Layouts {
  const full = (cols: number, w?: number) => items.map((it, idx) => ({
    ...it, x: 0, y: idx * (it.h + 1), w: w ?? cols,
  }))
  return {
    lg: items.map((it) => ({ ...it })),
    md: items.map((it) => ({ ...it, w: Math.min(it.w, 12) })),
    sm: full(6, 6),
    xs: full(4, 4),
    xxs: full(2, 2),
  }
}

export type { Layouts }
