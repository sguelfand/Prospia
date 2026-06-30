export type SourceOpt = { source: string; nombre: string }

/** Selector por cliente + tilde "definir por defecto". El padre maneja el valor y
 *  el default guardado (vía /me/preferences); este componente es solo la UI. */
export function ClienteSelector({
  sources,
  value,
  onChange,
  isDefault,
  onSetDefault,
}: {
  sources: SourceOpt[]
  value: string
  onChange: (s: string) => void
  isDefault: boolean
  onSetDefault: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm bg-card border border-line rounded-lg px-3 py-1.5 text-ink focus:border-primary outline-none"
      >
        {sources.map((s) => (
          <option key={s.source} value={s.source}>
            {s.nombre}
          </option>
        ))}
      </select>
      <label
        className="flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none"
        title="Usar esta opción como predeterminada al abrir la pantalla"
      >
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => onSetDefault(e.target.checked)}
          className="accent-primary w-3.5 h-3.5"
        />
        Definir por defecto
      </label>
    </div>
  )
}
