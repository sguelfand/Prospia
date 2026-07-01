import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("carga y muestra los KPIs principales", async ({ page }) => {
    await page.goto("/dashboard");

    // "Prospects generados" / "Tasa de ..." son exclusivos de las KPI cards.
    // ("En conversación" e "Interesados" se omiten acá porque ese texto también
    // aparece en la leyenda del gráfico y en botones → ambiguo.)
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Prospects generados")).toBeVisible();
    await expect(page.getByText("Tasa de respuesta")).toBeVisible();
    await expect(page.getByText("Tasa de conversión")).toBeVisible();
  });

  test("click en el KPI Interesados navega a Prospects filtrado", async ({ page }) => {
    await page.goto("/dashboard");
    // El label del KPI es un <p> (las leyendas del gráfico son <span>).
    await page.locator("p").filter({ hasText: /^Interesados$/ }).click();
    // El KPI navega a Prospects con el filtro por estado (y el mes actual). No se
    // asertan prospects puntuales: el filtro incluye mes actual y los datos
    // sembrados pueden ser de otro mes. El contenido filtrado ya lo cubre el test
    // "filtrar por estado" de prospects.spec.ts.
    await expect(page).toHaveURL(/\/prospects\?.*estado=interesado/);
  });
});
