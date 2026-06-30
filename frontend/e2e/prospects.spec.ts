import { test, expect } from "@playwright/test";

/**
 * Acciones de la pantalla Prospects (cliente N2) contra el tenant aislado
 * `qa-test`, que tiene prospects sembrados con estados variados.
 * Estos tests son de lectura/UI (no disparan contacto ni mutan datos).
 *
 * Nota: el nombre del prospect aparece 2 veces en el DOM (card mobile oculta +
 * celda de la tabla desktop). En desktop la tabla es la visible → se apunta a la
 * celda con getByRole("cell").
 */
test.describe("Prospects · acciones", () => {
  test("buscar filtra por nombre", async ({ page }) => {
    await page.goto("/prospects");
    const buscar = page.getByPlaceholder("Buscar nombre, email, web...");
    await expect(buscar).toBeVisible();

    await expect(page.getByRole("cell", { name: "Distribuidora Alfa SRL" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Comercial Beta SA" })).toBeVisible();

    await buscar.fill("Alfa");
    await expect(page.getByRole("cell", { name: "Distribuidora Alfa SRL" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Comercial Beta SA" })).toHaveCount(0, { timeout: 15_000 });
  });

  test("filtrar por estado muestra solo ese estado", async ({ page }) => {
    await page.goto("/prospects");
    const filtro = page.locator("select", {
      has: page.locator("option", { hasText: "Todos los estados" }),
    });
    await filtro.selectOption({ label: "Interesado" });

    // "Construcciones Epsilon" = interesado (sembrado); "Distribuidora Alfa" =
    // sin_contactar → no debe aparecer con el filtro Interesado.
    // Se usa getByRole("cell") (tabla desktop) en vez de getByText: este último
    // también contaría la card mobile oculta, que se filtra con otro timing.
    await expect(page.getByRole("cell", { name: "Distribuidora Alfa SRL" })).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("cell", { name: "Construcciones Epsilon" })).toBeVisible();
  });

  test("abrir el panel de Historial de un prospect", async ({ page }) => {
    await page.goto("/prospects");
    await page.getByRole("button", { name: "Historial" }).first().click();
    // El panel lateral (overlay) se abre con la opción de agregar un registro.
    await expect(page.locator(".fixed.inset-0.z-50")).toBeVisible();
    await expect(page.getByText(/Agregar registro/)).toBeVisible();
  });

  test("abrir el panel de Chat de un prospect", async ({ page }) => {
    await page.goto("/prospects");
    await page.getByRole("button", { name: "Chat" }).first().click();
    await expect(page.locator(".fixed.inset-0.z-50")).toBeVisible();
  });

  test("abrir el popover de clasificación", async ({ page }) => {
    await page.goto("/prospects");
    // Badge de clasificación visible (la celda de la tabla desktop; la card mobile
    // está oculta). Abrir el popover sin guardar (no muta el prospect).
    await page.locator("span:visible", { hasText: /^MEDIO$/ }).first().click();
    await expect(
      page.locator("select", { has: page.locator('option', { hasText: "ALTO" }) }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^OK$/ })).toBeVisible();
  });

  test("selector de columnas oculta una columna", async ({ page }) => {
    await page.goto("/prospects");
    // La visibilidad de columnas se guarda en las preferencias del usuario, así que
    // el test deja todo como estaba: garantiza Web visible → la oculta → la restaura.
    // El menú queda abierto mientras se togglean los checkboxes (sin cerrarlo).
    await page.getByRole("button", { name: "Columnas" }).click();
    const web = page.getByRole("checkbox", { name: "Web" });
    await web.check();
    await expect(page.getByRole("columnheader", { name: "Web" })).toBeVisible();
    await web.uncheck();
    await expect(page.getByRole("columnheader", { name: "Web" })).toHaveCount(0);
    await web.check(); // restaurar
    await expect(page.getByRole("columnheader", { name: "Web" })).toBeVisible();
  });
});
