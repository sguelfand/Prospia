import { test, expect } from "@playwright/test";

/**
 * Pantalla Precios (N1) → parámetros comerciales, costos, margen y faltantes.
 * Verifica:
 *   - la pantalla carga con sus widgets (Parámetros comerciales, Margen de
 *     ganancia, Datos faltantes) y el chip de ORIGEN del $/conversación,
 *   - editar el abono mensual persiste tras reload,
 *   - la leyenda ámbar de "estimación Etiguel" aparece cuando el origen del
 *     costo es estimado_etiguel (caso cliente nuevo).
 * Las escrituras van AISLADAS al pricing del source `qa-test` (deep-link
 * `?source=qa-test`): no tocan los datos comerciales reales de etiguel.
 */
test.use({ storageState: "e2e/.auth/qa-admin.json" });

test.describe("Precios (N1)", () => {
  test("carga la pantalla con sus widgets y el chip de origen del costo", async ({ page }) => {
    // ?source=etiguel fija la vista de UN cliente (independiente del default
    // guardado por el usuario, que podría ser la vista General).
    await page.goto("/precios?source=etiguel");
    await expect(page).toHaveURL(/\/precios/);

    // Widgets del tablero (títulos por defecto — editables, pero arrancan así).
    await expect(page.getByText("Parámetros comerciales").first()).toBeVisible();
    await expect(page.getByText("Margen de ganancia").first()).toBeVisible();
    await expect(page.getByText("Datos faltantes para cotizar bien").first()).toBeVisible();
    await expect(page.getByText("Costo de estructura (compartido)").first()).toBeVisible();

    // Chip del origen del $/conversación (medido/simulado/manual/estimación).
    await expect(page.getByTestId("chip-origen")).toBeVisible();
  });

  test("editar el abono mensual persiste tras reload (aislado en qa-test)", async ({ page }) => {
    await page.goto("/precios?source=qa-test");
    const abono = page.getByLabel("Abono mensual (USD)");
    await expect(abono).toBeVisible();

    // Valor nuevo distinto del actual (idempotente entre corridas).
    const original = await abono.inputValue();
    const nuevo = original === "777" ? "778" : "777";

    // El guardado dispara al salir del campo (blur) → esperar el PUT real.
    const puso = page.waitForResponse(
      (r) => r.url().includes("/admin/precios/cliente/") && r.request().method() === "PUT" && r.ok(),
    );
    await abono.fill(nuevo);
    await abono.blur();
    await puso;

    await page.reload();
    await expect(page.getByLabel("Abono mensual (USD)")).toHaveValue(nuevo, { timeout: 15000 });

    // Con abono cargado, el widget de margen muestra los números (no el aviso).
    await expect(page.getByText("Cargá el abono mensual para ver el margen")).toHaveCount(0);
  });

  test("cliente sin medición propia muestra la leyenda de estimación Etiguel", async ({ page }) => {
    // qa-test arranca con costo_conv_origen = estimado_etiguel (cliente nuevo).
    await page.goto("/precios?source=qa-test");
    await expect(page.getByTestId("chip-origen")).toBeVisible();
    await expect(page.getByTestId("chip-origen")).toHaveText(/estimación Etiguel/i);
    await expect(
      page.getByText(/Estimación con los valores de Etiguel/).first(),
    ).toBeVisible();
    // Y el botón para simular el costo real de este cliente.
    await expect(page.getByRole("button", { name: /Simular costo real/ })).toBeVisible();
  });
});
