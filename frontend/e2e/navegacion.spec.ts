import { test, expect } from "@playwright/test";

/**
 * Recorre las pantallas que ve un cliente (nivel 2) y verifica que cada una
 * carga sin romperse. El tenant `qa-test` es nivel 2, así que NO ve las
 * pantallas de superadmin (admin-clientes, pendientes, errores).
 */
const PANTALLAS: { ruta: string; heading: RegExp }[] = [
  { ruta: "/dashboard", heading: /^Dashboard$/ },
  { ruta: "/prospects", heading: /^Prospects$/ },
  { ruta: "/terminos", heading: /Términos de búsqueda/ },
  { ruta: "/preguntas", heading: /^Preguntas$/ },
  { ruta: "/configuracion", heading: /Configuración/ },
];

test.describe("Navegación (cliente nivel 2)", () => {
  for (const { ruta, heading } of PANTALLAS) {
    test(`${ruta} carga correctamente`, async ({ page }) => {
      await page.goto(ruta);
      await expect(page).toHaveURL(new RegExp(ruta));
      await expect(
        page.getByRole("heading", { name: heading }).first()
      ).toBeVisible();
    });
  }

  test("se puede navegar a Prospects desde el menú lateral (click real)", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Prospects" }).first().click();
    await expect(page).toHaveURL(/\/prospects/);
    await expect(
      page.getByRole("heading", { name: /^Prospects$/ }).first()
    ).toBeVisible();
  });
});
