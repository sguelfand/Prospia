import { defineConfig, devices } from "@playwright/test";

/**
 * Tests E2E "como un usuario real" de la web Prospia.
 *
 * Por defecto corren contra PRODUCCIÓN (https://prospia.app) usando el tenant
 * de prueba AISLADO `qa-test` (usuario `qatest`). Nunca tocan el tenant real.
 *
 * Para correr contra otra URL (ej. dev local en :5173):
 *   PROSPIA_BASE_URL=http://localhost:5173 npm run test:e2e
 */
const BASE_URL = process.env.PROSPIA_BASE_URL || "https://prospia.app";

export default defineConfig({
  testDir: "./e2e",
  /* Tiempo máx por test */
  timeout: 30_000,
  expect: { timeout: 10_000 },
  /* Los tests comparten el mismo tenant de prueba (qa-test) en un backend de prod
   * real: corren EN SERIE para no pisarse (un test que muta la lista de términos o
   * las preferencias de columnas interfería con otro corriendo en paralelo) ni
   * saturar el server. 1 reintento absorbe flakes puntuales de red. */
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "es-AR",
  },
  /* Tolerancia de comparación visual: 0.2% de píxeles distintos */
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",

  projects: [
    /* Loguea una vez (qatest N2 + qa-admin N1) y guarda las sesiones */
    { name: "setup", testMatch: /\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/qatest.json",
      },
      dependencies: ["setup"],
    },
  ],
});
