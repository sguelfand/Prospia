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
    await expect(page.getByText("Comercial Beta SA")).toHaveCount(0);
  });

  test("filtrar por estado muestra solo ese estado", async ({ page }) => {
    await page.goto("/prospects");
    const filtro = page.locator("select", {
      has: page.locator("option", { hasText: "Todos los estados" }),
    });
    await filtro.selectOption({ label: "Interesado" });

    // "Construcciones Epsilon" = interesado (sembrado); "Distribuidora Alfa" =
    // sin_contactar → no debe aparecer con el filtro Interesado.
    await expect(page.getByRole("cell", { name: "Construcciones Epsilon" })).toBeVisible();
    await expect(page.getByText("Distribuidora Alfa SRL")).toHaveCount(0);
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
});
