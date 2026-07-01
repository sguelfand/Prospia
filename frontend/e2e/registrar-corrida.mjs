// Corre la suite Playwright y registra la corrida en el historial de la web
// (POST /ingest/test-run). Uso: `npm run test:e2e:registrar`.
// El runner en el servidor es 2da etapa; por ahora esto lo dispara Claude.
//
// Token: PROSPIA_MIRROR_TOKEN o ETIGUEL_MIRROR_TOKEN (env), o ~/.config/claude/secrets.env.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// La API vive bajo /api (nginx proxea). El reporter postea ahí (distinto de la
// baseURL del navegador que usa Playwright, que es la web sin /api).
const API = process.env.PROSPIA_API_URL || 'https://prospia.app/api'

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s || '').replace(/\[[0-9;]*m/g, '')
}

function getToken() {
  if (process.env.PROSPIA_MIRROR_TOKEN) return process.env.PROSPIA_MIRROR_TOKEN
  if (process.env.ETIGUEL_MIRROR_TOKEN) return process.env.ETIGUEL_MIRROR_TOKEN
  try {
    const txt = fs.readFileSync(path.join(os.homedir(), '.config/claude/secrets.env'), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*(PROSPIA_MIRROR_TOKEN|ETIGUEL_MIRROR_TOKEN)\s*=\s*(.+)$/)
      if (m) return m[2].trim().replace(/^["']|["']$/g, '')
    }
  } catch { /* noop */ }
  return null
}

// 1. Correr la suite con reporter JSON (exit != 0 si hay fallos; igual trae el JSON).
let raw = ''
try {
  raw = execSync('npx playwright test --reporter=json', { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' })
} catch (e) {
  raw = e.stdout || ''
}
if (!raw.trim()) { console.error('No hubo salida JSON de Playwright.'); process.exit(1) }
const data = JSON.parse(raw)

// 2. Aplanar specs → tests.
const detalle = []
function walk(suite, archivoPadre) {
  const f = suite.file || archivoPadre
  for (const spec of suite.specs || []) {
    for (const test of spec.tests || []) {
      const results = test.results || []
      const res = results[results.length - 1] || {}
      const estado = res.status === 'passed' ? 'passed' : res.status === 'skipped' ? 'skipped' : 'failed'
      const err = (res.error && (res.error.message || res.error.value)) || (res.errors && res.errors[0] && res.errors[0].message)
      detalle.push({
        nombre: spec.title,
        archivo: (spec.file || f || '').split('/').pop() || null,
        estado,
        error: estado === 'failed' ? stripAnsi(err).slice(0, 4000) || null : null,
        duracion_ms: Math.round(res.duration || 0),
      })
    }
  }
  for (const s of suite.suites || []) walk(s, f)
}
for (const s of data.suites || []) walk(s)

const pasaron = detalle.filter((d) => d.estado === 'passed').length
const fallaron = detalle.filter((d) => d.estado === 'failed').length
const duracion_ms = data.stats?.duration ? Math.round(data.stats.duration) : detalle.reduce((a, d) => a + d.duracion_ms, 0)

// 3. Registrar en el historial.
const token = getToken()
if (!token) { console.error('Falta PROSPIA_MIRROR_TOKEN (ni en env ni en secrets.env).'); process.exit(1) }
const r = await fetch(`${API}/ingest/test-run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Mirror-Token': token },
  body: JSON.stringify({ origen: process.env.PROSPIA_RUN_ORIGEN || 'local', total: detalle.length, pasaron, fallaron, duracion_ms, detalle }),
})
const body = await r.text()
console.log(`Corrida registrada: ${pasaron} ✓ / ${fallaron} ✗ de ${detalle.length} · ${(duracion_ms / 1000).toFixed(1)}s · POST ${r.status} ${body}`)
process.exit(fallaron > 0 ? 1 : 0)
