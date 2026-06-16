import { ESTADOS } from '../api/types'

interface Props {
  estado: string
  onClick?: () => void
}

export default function StatusBadge({ estado, onClick }: Props) {
  const info = ESTADOS[estado] ?? { label: estado, color: '#94a3b8' }
  return (
    <span
      onClick={onClick}
      style={{ backgroundColor: info.color + '22', color: info.color, borderColor: info.color + '44' }}
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
    >
      {info.label}
    </span>
  )
}
