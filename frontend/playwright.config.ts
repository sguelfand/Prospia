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
  /* No correr en paralelo flujos que comparten la sesión guardada al inicio */
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
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
    /* Loguea una vez y guarda la sesión para el resto */
    { name: "setup", testMatch: /auth\.setup\.ts/ },
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
