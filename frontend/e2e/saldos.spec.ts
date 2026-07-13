import { test, expect } from "@playwright/test";

/**
 * Panel Saldos (N1) — saldo/estado de los proveedores de IA (OpenRouter, MyClaw,
 * Anthropic). Es una vista de solo lectura y global (no toca ningún tenant), así
 * que el test es funcional: verifica que la página carga desde el menú y que el
 * endpoint /admin/saldos devuelve los 3 proveedores con la forma esperada. No hace
 * regresión visual porque los montos son dinámicos (cambian con el consumo real).
 */
test.use({ storageState: "e2e/.auth/qa-admin.json" });

test.describe("Saldos (N1)", () => {
  test("la página carga con los 3 proveedores", async ({ page }) => {
    await page.goto("/monitoreo/saldos");
    await expect(page.getByRole("heading", { name: "Saldos" })).toBeVisible();
    // Los 3 proveedores aparecen como cards.
    await expect(page.getByText("OpenRouter", { exact: true })).toBeVisible();
    await expect(page.getByText("MyClaw", { exact: true })).toBeVisible();
    await expect(page.getByText("Anthropic", { exact: true })).toBeVisible();
  });

  test("GET /admin/saldos devuelve los 3 proveedores con su forma", async ({ page, baseURL }) => {
    await page.goto("/monitoreo/saldos");
    const token = await page.evaluate(() => localStorage.getItem("token"));
    expect(token, "sesión de qa-admin válida").toBeTruthy();
    const res = await page.request.get(`${baseURL}/api/admin/saldos`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const provs = (data.proveedores as Array<{ proveedor: string }>).map((p) => p.proveedor);
    expect(provs).toContain("OpenRouter");
    expect(provs).toContain("MyClaw");
    expect(provs).toContain("Anthropic");
    expect(typeof data.consultado_at).toBe("string");
  });
});
