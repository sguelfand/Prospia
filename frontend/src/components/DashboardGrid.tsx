import { ReactNode, useEffect, useRef, useState } from 'react'
// react-grid-layout publica sus tipos con `export =`; el default trae Responsive
// y WidthProvider como propiedades (existen en runtime). Tipos propios abajo.
import RGL from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import './dashboard-grid.css'
import { api } from '../api/client'

const Responsive = (RGL as any).Responsive
const WidthProvider = (RGL as any).WidthProvider
const ResponsiveGrid = WidthProvider(Responsive)

type LayoutItem = { i: string; x: number; y: number; w: number; h: number; minH?: number; minW?: number; [k: string]: unknown }
type Layouts = { [bp: string]: LayoutItem[] }

const COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }

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
  const [ready, setReady] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let vivo = true
    api.get<{ layout: Layouts }>(`/me/layout?pantalla=${encodeURIComponent(pantalla)}`)
      .then((r) => {
        if (!vivo) return
        if (r.layout && Object.keys(r.layout).length > 0) setLayouts(mergeDefaults(r.layout, defaultLayout))
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

  function resetear() {
    setLayouts(defaultLayout)
    api.put('/me/layout', { pantalla, layout: defaultLayout }).catch(() => {})
  }

  return (
    <div className="relative">
      <button onClick={resetear} title="Volver al orden original"
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

/** Un widget del tablero: cuadro con grip de 6 puntitos (arrastrar) + título. */
export function Widget({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="h-full bg-card border border-line rounded-2xl flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line/60">
        <span className="rgl-grip cursor-grab active:cursor-grabbing -ml-0.5 text-muted hover:text-ink" title="Arrastrar para reordenar">
          <GripDots />
        </span>
        {title && <h2 className="text-xs font-semibold text-ink-soft uppercase tracking-wide truncate">{title}</h2>}
        {right && <div className="ml-auto">{right}</div>}
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4">{children}</div>
    </div>
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
