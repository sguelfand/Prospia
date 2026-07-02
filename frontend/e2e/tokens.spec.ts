import { test, expect } from "@playwright/test";

/**
 * Pantalla Tokens (N1) → gráfico "Costos diarios".
 * Verifica el tablero de costo diario de Camila con gastos internos apilados:
 *   - el widget existe con su título "Costos diarios",
 *   - trae las 3 tildes de series (Mensajes / Errores / Gastos internos), todas
 *     prendidas por defecto,
 *   - Sebi puede sacar y volver a poner una serie (toggle funcional).
 * Read-only: solo navega y togglea checkboxes de UI (no muta datos de prod).
 */
test.use({ storageState: "e2e/.auth/qa-admin.json" });

test.describe("Tokens · Costos diarios (N1)", () => {
  test("el gráfico de costos diarios trae las 3 series con tildes y se prenden/apagan", async ({ page }) => {
    await page.goto("/monitoreo/tokens");
    await expect(page).toHaveURL(/\/monitoreo\/tokens/);

    // El widget "costoDia" vive en la vista de un cliente → elegir Etiguel (Camila).
    // El selector es el primer <select> de la pantalla (ClienteSelector).
    await page.locator("select").first().selectOption("etiguel");

    // Título del widget (editable, pero por defecto arranca así).
    await expect(page.getByText(/Costos diarios/).first()).toBeVisible();

    // Las 3 tildes de series, todas prendidas por defecto.
    const mensajes = page.getByRole("checkbox", { name: "Mensajes" });
    const errores = page.getByRole("checkbox", { name: "Errores" });
    const internos = page.getByRole("checkbox", { name: "Gastos internos" });
    await expect(mensajes).toBeChecked();
    await expect(errores).toBeChecked();
    await expect(internos).toBeChecked();

    // Sacar "Gastos internos" → queda destildada.
    await internos.uncheck();
    await expect(internos).not.toBeChecked();
    // Las otras dos siguen prendidas.
    await expect(mensajes).toBeChecked();
    await expect(errores).toBeChecked();

    // Volver a ponerla → prendida de nuevo.
    await internos.check();
    await expect(internos).toBeChecked();
  });
});
