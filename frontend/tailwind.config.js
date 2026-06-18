/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(${name}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Sora', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Sora', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        /* Marca (fijos) */
        navy:   '#0C1730',
        amber:  '#F5B23D',
        steel:  '#43577B',
        fog:    '#EEF3FB',

        /* Semánticos (cambian con light/dark vía CSS vars) */
        app:        v('--c-app'),
        card:       v('--c-card'),
        subtle:     v('--c-subtle'),
        line:       v('--c-line'),
        ink:        v('--c-ink'),
        'ink-soft': v('--c-ink-soft'),
        muted:      v('--c-muted'),
        faint:      v('--c-faint'),
        primary:        v('--c-primary'),
        'primary-dark': v('--c-primary-dark'),
        'primary-soft': v('--c-primary-soft'),
        'on-primary':   v('--c-on-primary'),
        accent:     v('--c-accent'),
      },
      borderColor: {
        DEFAULT: v('--c-line'),
      },
    },
  },
  plugins: [],
}
