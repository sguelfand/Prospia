import { test, expect } from "@playwright/test";

/**
 * Pantallas de SUPERADMIN (nivel 1). Corren con la sesión del superadmin de
 * prueba `qa-admin`. Por ahora cubren que cada pantalla CARGA y renderiza (no
 * ejecutan escrituras sobre datos reales de prod). La cobertura de acciones
 * acotables a qa-test se agrega aparte.
 */
test.use({ storageState: "e2e/.auth/qa-admin.json" });

const PANTALLAS: { ruta: string; heading: RegExp }[] = [
  { ruta: "/dashboard", heading: /Dashboard/ },
  { ruta: "/admin-clientes", heading: /Admin clientes/ },
  { ruta: "/pendientes", heading: /^Pendientes$/ },
  { ruta: "/errores", heading: /Errores de Camila/ },
  { ruta: "/preguntas", heading: /^Preguntas$/ },
  { ruta: "/monitoreo/servicios", heading: /Monitoreo · Servicios/ },
  { ruta: "/monitoreo/tokens", heading: /Monitoreo · Tokens/ },
  { ruta: "/monitoreo/calidad", heading: /Calidad de Camila/ },
];

test.describe("Pantallas de superadmin (N1)", () => {
  for (const { ruta, heading } of PANTALLAS) {
    test(`${ruta} carga correctamente`, async ({ page }) => {
      await page.goto(ruta);
      await expect(page).toHaveURL(new RegExp(ruta.replace(/\//g, "\\/")));
      // No quedó en login (la sesión de admin es válida)
      await expect(page.getByRole("button", { name: /^Entrar$/ })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    });
  }

  test("Tokens: los widgets muestran el chip de fuente (abajo a la derecha)", async ({ page }) => {
    await page.goto("/monitoreo/tokens");
    await page.waitForLoadState("networkidle");
    // Los widgets de Camila (gateway) siempre renderizan en la vista General →
    // el chip "OpenClaw" está presente. Es la leyenda que movimos al pie del widget.
    await expect(page.getByText("OpenClaw", { exact: true }).first()).toBeVisible();
  });

  test("el menú de superadmin muestra los accesos clave", async ({ page }) => {
    await page.goto("/dashboard");
    // "Testing" es un grupo desplegable (botón), no un link → se busca por texto
    // para cubrir links y grupos por igual.
    for (const item of ["Pendientes", "Errores", "Admin clientes", "Testing"]) {
      await expect(page.getByText(item, { exact: true }).first()).toBeVisible();
    }
  });

  test("ver como cliente impersona al tenant de prueba", async ({ page }) => {
    await page.goto("/dashboard");
    // El selector "Ver como un cliente" incluye qa-test (marcado "· test").
    const selector = page.locator("select", {
      has: page.locator("option", { hasText: "QA Test (automated) · test" }),
    });
    await selector.selectOption({ label: "QA Test (automated) · test" });
    await expect(page).toHaveURL(/\/dashboard/);
    // Al impersonar queda seteado viewing_as con el nombre del cliente.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("viewing_as")))
      .toContain("QA Test");
  });
});
