import { RefreshCw, Wallet } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'

type Proveedor = {
  proveedor: string
  ok: boolean
  tipo?: 'saldo' | 'estado' | 'consumo'
  estado?: string
  saldo_usd?: number
  total_usd?: number
  usado_usd?: number
  consumo_mes_usd?: number | null
  mes_nombre?: string
  detalle?: string
  error?: string
}
type SaldosResp = { proveedores: Proveedor[]; consultado_at: string }

const ESTADO: Record<string, { label: string; color: string }> = {
  activo: { label: 'Con saldo', color: '#22c55e' },
  sin_saldo: { label: 'Sin saldo', color: '#ef4444' },
  sin_api_saldo: { label: 'Sin API de saldo', color: '#64748b' },
  desconocido: { label: 'Desconocido', color: '#f5b23d' },
}

function usd(n?: number | null): string {
  if (n === null || n === undefined) return '—'
  return `US$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function Saldos() {
  const [data, setData] = useState<SaldosResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      setData(await api.get<SaldosResp>('/admin/saldos'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron traer los saldos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Wallet size={20} /> Saldos
        </h1>
        <button
          onClick={() => { setLoading(true); load() }}
          className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-[#243454] hover:bg-[#1B2A47]"
        >
          <RefreshCw size={14} /> Actualizar
        </button>
      </div>
      <p className="text-sm text-[#8294B4] mb-5">
        Saldo de los proveedores de IA que mueven a Camila.
      </p>

      {error && <div className="text-[#ef4444] text-sm mb-4">{error}</div>}
      {loading && !data && <div className="text-[#8294B4]">Cargando…</div>}

      <div className="grid gap-4 sm:grid-cols-3">
        {(data?.proveedores || []).map((p) => {
          const e = (p.ok && p.estado && ESTADO[p.estado]) || { label: p.ok ? '—' : 'Error', color: '#ef4444' }
          return (
            <div key={p.proveedor} className="rounded-xl border border-[#243454] bg-[#13213C] p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-bold">{p.proveedor}</span>
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded-full border"
                  style={{ color: e.color, borderColor: e.color }}
                >
                  {e.label}
                </span>
              </div>

              {p.ok && p.tipo === 'saldo' && (
                <>
                  <div className="text-2xl font-extrabold">{usd(p.saldo_usd)}</div>
                  <div className="text-xs text-[#8294B4] mt-1">
                    disponible · usado {usd(p.usado_usd)} de {usd(p.total_usd)}
                  </div>
                </>
              )}

              {p.ok && p.tipo === 'estado' && (
                <div className={`text-sm ${p.estado === 'sin_saldo' ? 'text-[#ef4444]' : 'text-[#8294B4]'}`}>
                  {p.detalle}
                </div>
              )}

              {p.ok && p.tipo === 'consumo' && (
                <>
                  <div className="text-2xl font-extrabold">{usd(p.consumo_mes_usd)}</div>
                  <div className="text-xs text-[#8294B4] mt-1">consumo {p.mes_nombre}</div>
                  <div className="text-xs text-[#8294B4] mt-2">{p.detalle}</div>
                </>
              )}

              {!p.ok && <div className="text-sm text-[#ef4444]">{p.error}</div>}
            </div>
          )
        })}
      </div>

      {data?.consultado_at && (
        <p className="text-xs text-[#8294B4] mt-4">
          Actualizado {new Date(data.consultado_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
    </div>
  )
}
