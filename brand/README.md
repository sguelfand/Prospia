# Prospia — Paquete gráfico · Sistema "La señal"

Identidad visual de la plataforma **Prospia** (prospia.app).
Generada en Claude Design (dirección *La señal*) e implementada en SVG limpio.
Abrí **[brand.html](brand.html)** en el navegador para ver todo junto.

## Concepto
Un campo de contactos apagados (color **acero**) y uno encendido en **ámbar**:
Prospia encuentra al prospecto correcto entre el ruido y lo conecta. El nodo
central ámbar es **"la señal"** — en versiones a color nunca cambia de color.

## Estructura
```
brand/
├── brand.html                  ← brandbook visual (abrir en navegador)
├── tokens.css                  ← colores, fuentes, radios, sombras (fuente de verdad)
├── README.md
├── logo/
│   ├── prospia-logo-horizontal.svg        ← uso principal (tinta)
│   ├── prospia-logo-horizontal-white.svg  ← sobre fondo oscuro
│   ├── prospia-logo-stacked.svg           ← apilado
│   ├── prospia-wordmark.svg               ← solo texto
│   ├── prospia-isotipo.svg                ← símbolo a color (acero + ámbar)
│   ├── prospia-isotipo-tile.svg           ← símbolo en tile navy (app icon)
│   ├── prospia-isotipo-mono-white.svg     ← símbolo mono blanco
│   └── prospia-isotipo-mono-ink.svg       ← símbolo mono tinta
├── favicon/
│   └── favicon.svg             ← favicon simplificado (2 nodos + señal)
├── social/
│   ├── og-image.svg            ← 1200×630, para compartir el link
│   └── avatar.svg              ← 400×400, foto de perfil redes
└── from-claude-design/         ← export original de Claude Design (referencia)
```

## Paleta
| Rol           | Hex       | Uso |
|---------------|-----------|-----|
| Navy          | `#0C1730` | base, fondo, tinta |
| Ámbar señal   | `#F5B23D` | acento, CTA, "lo hallado" (único cálido, con moderación) |
| Acero         | `#43577B` | nodos apagados, líneas, bordes |
| Niebla        | `#EEF3FB` | texto sobre oscuro, superficies claras |
| Apoyo         | `#13213C` · `#8294B4` | superficie elevada · texto secundario |

## Tipografía
- **Display / UI / logo:** Sora (400–800)
- **Etiquetas / datos / métricas:** JetBrains Mono
- Ambas son Google Fonts gratis; los SVG con texto las importan embebidas.

## Cómo aplicarlo en la app (frontend)
1. Copiar `favicon.svg` a `frontend/public/` y en `index.html`:
   ```html
   <link rel="icon" type="image/svg+xml" href="/favicon.svg">
   <meta property="og:image" content="https://prospia.app/og-image.png">
   <title>Prospia</title>
   ```
2. Importar Sora + JetBrains Mono y mapear `tokens.css` en `tailwind.config.js`
   (`theme.extend.colors`, `fontFamily.display`/`mono`).
3. Navbar: `prospia-logo-horizontal-white.svg` (la app es de fondo oscuro).

## Notas de producción
- **OG image / favicon.ico:** las redes y los browsers viejos necesitan PNG/ICO.
  Convertir con `rsvg-convert -w 1200 social/og-image.svg -o og-image.png`
  (instalar con `brew install librsvg`) o subir el SVG a realfavicongenerator.net.
- **Wordmark:** usa la fuente Sora por nombre. Para entregables que deban verse
  idénticos sin la fuente instalada (imprenta), vectorizar el texto (convertir a curvas).
- El isotipo es **vectorial puro** (líneas + círculos): escala perfecto y es trivial
  de retocar (ej.: cambiar qué nodo está "encendido").
- El nodo huérfano abajo-izquierda (sin línea) es parte del diseño original ("campo
  disperso"). Si lo querés conectado, agregá una línea desde el centro — avisame.
```
