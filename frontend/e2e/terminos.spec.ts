import { test, expect } from "@playwright/test";

/**
 * CRUD de Términos de búsqueda (cliente N2) sobre el tenant aislado `qa-test`.
 * Crea un término con nombre único y lo borra al final (no deja basura).
 * NO dispara el scraper (eso correría Apify y cuesta).
 */
test("agregar y borrar un término", async ({ page }) => {
  const nombre = `zzz-e2e-${Date.now()}`;
  await page.goto("/terminos");

  // Alta
  await page.getByPlaceholder(/distribuidores de materiales/).fill(nombre);
  await page.getByRole("button", { name: "Agregar" }).click();
  await expect(page.getByText(nombre)).toBeVisible();

  // Baja (confirm() del navegador → aceptar). El tacho lleva aria-label con el texto.
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: `Eliminar término ${nombre}` }).click();
  await expect(page.getByText(nombre)).toHaveCount(0);
});
