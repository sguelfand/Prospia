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

  test("Motores LLM: Estimar disponible y el gate refleja el estado real del switch", async ({ page }) => {
    await page.goto("/testing/llm");
    await page.waitForLoadState("networkidle");
    // Estimar costo no consume tokens → siempre disponible, prenda o apague el gate.
    await expect(page.getByRole("button", { name: /Estimar costo/ })).toBeVisible();

    // El gate es un switch GLOBAL (monitor_settings.test_llm_habilitado). El test no
    // lo toca (afectaría el uso real); en cambio verifica que el botón "Correr" y el
    // aviso coincidan con el estado que muestra la tarjeta de estado.
    const correr = page.getByRole("button", { name: /Correr comparación/ });
    const habilitado = await page.getByText(/Correr HABILITADO/).isVisible().catch(() => false);
    if (habilitado) {
      // Gate prendido → el aviso de bloqueo del gate NO aparece.
      await expect(page.getByText(/bloqueado hasta que habilites/i)).toHaveCount(0);
    } else {
      // Gate apagado → Correr deshabilitado y el aviso del gate presente.
      await expect(page.getByText(/Correr bloqueado/).first()).toBeVisible();
      await expect(correr).toBeDisabled();
      await expect(page.getByText(/bloqueado hasta/i).first()).toBeVisible();
    }
  });
});
