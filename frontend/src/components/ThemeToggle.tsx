import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../theme'

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      onClick={toggle}
      title={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      aria-label="Cambiar tema"
      className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line text-muted hover:text-ink hover:bg-subtle transition-colors ${className}`}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  )
}
