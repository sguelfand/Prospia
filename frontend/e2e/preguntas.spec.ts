import { test, expect } from "@playwright/test";

/**
 * Preguntas / consultas escaladas (cliente N2). El tenant qa-test no tiene
 * consultas → se testea que las tabs Pendientes/Contestadas funcionan y muestran
 * el estado vacío correcto.
 */
test("tabs Pendientes / Contestadas", async ({ page }) => {
  await page.goto("/preguntas");
  await expect(page.getByRole("heading", { name: "Preguntas" })).toBeVisible();

  // Default: pendientes (vacío).
  await expect(page.getByText("No hay preguntas pendientes 🎉")).toBeVisible();

  // Cambiar a Contestadas.
  await page.getByRole("button", { name: /Contestadas/ }).click();
  await expect(page.getByText("Todavía no contestaste ninguna.")).toBeVisible();
});
