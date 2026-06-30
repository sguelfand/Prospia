import { test, expect } from "@playwright/test";

/**
 * Visual regression: saca una foto de cada pantalla clave y la compara contra
 * un "baseline". La PRIMERA corrida genera los baselines (verás "X passed" tras
 * crearlos). Las siguientes fallan si algo cambió visualmente.
 *
 * Para actualizar los baselines a propósito (cambio de diseño esperado):
 *   npm run test:e2e:update
 */
// El /dashboard y /monitoreo/tokens usan el tablero movible (react-grid-layout),
// que asienta su layout con un offset de pocos píxeles entre corridas → la foto
// es inestable. Esas pantallas se cubren funcionalmente (KPIs), no por pixel.
// /terminos se omite del visual: su lista de términos cambia (el test de CRUD
// agrega/borra) → la foto sería inestable. Queda cubierto funcionalmente.
const PANTALLAS = [
  { ruta: "/prospects", nombre: "prospects.png" },
  { ruta: "/configuracion", nombre: "configuracion.png" },
];

test.describe("Visual regression", () => {
  for (const { ruta, nombre } of PANTALLAS) {
    test(`captura ${ruta}`, async ({ page }) => {
      await page.goto(ruta);
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveScreenshot(nombre, {
        fullPage: true,
        // 0.2% de píxeles de tolerancia (antialiasing, etc.)
        maxDiffPixelRatio: 0.002,
        animations: "disabled",
      });
    });
  }
});
