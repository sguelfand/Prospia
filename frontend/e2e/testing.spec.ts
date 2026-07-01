import { test, expect } from "@playwright/test";

/**
 * Sección "Testing" (menú desplegable N1): Visuales (E2E) + Motores LLM.
 * Corre con el superadmin de prueba `qa-admin`. Verifica que ambas pantallas
 * cargan, que el submenú despliega, y que el banco de pruebas de motores respeta
 * el gate: "Estimar" está disponible (no gasta) pero "Correr comparación" queda
 * DESHABILITADO mientras el switch está apagado (no consume tokens).
 */
test.use({ storageState: "e2e/.auth/qa-admin.json" });

test.describe("Testing (N1)", () => {
  test("/testing/visuales carga (Test visuales)", async ({ page }) => {
    await page.goto("/testing/visuales");
    await expect(page).toHaveURL(/\/testing\/visuales/);
    await expect(page.getByRole("heading", { name: /Test visuales/ }).first()).toBeVisible();
  });

  test("/testing/llm carga (Motores LLM)", async ({ page }) => {
    await page.goto("/testing/llm");
    await expect(page).toHaveURL(/\/testing\/llm/);
    await expect(page.getByRole("heading", { name: /Motores LLM/ }).first()).toBeVisible();
  });

  test("la ruta vieja /test-visuales redirige al submenú", async ({ page }) => {
    await page.goto("/test-visuales");
    await expect(page).toHaveURL(/\/testing\/visuales/);
  });

  test("el submenú Testing despliega Visuales + Motores LLM", async ({ page }) => {
    await page.goto("/testing/llm"); // al estar en /testing el grupo arranca abierto
    await expect(page.getByRole("link", { name: "Visuales" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Motores LLM" }).first()).toBeVisible();
  });

  test("Motores LLM: Estimar disponible y Correr bloqueado (no gasta tokens)", async ({ page }) => {
    await page.goto("/testing/llm");
    await page.waitForLoadState("networkidle");
    // Estimar costo no consume tokens → siempre disponible.
    await expect(page.getByRole("button", { name: /Estimar costo/ })).toBeVisible();
    // Correr consume tokens → deshabilitado mientras el gate está apagado (default).
    await expect(page.getByRole("button", { name: /Correr comparación/ })).toBeDisabled();
    // El aviso del gate está presente.
    await expect(page.getByText(/Correr.*bloqueado|bloqueado hasta/i).first()).toBeVisible();
  });
});
