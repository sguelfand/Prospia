import { test, expect } from "@playwright/test";
import { QA } from "./credenciales";

/* Estos tests prueban la pantalla de login desde cero, sin sesión guardada. */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Login", () => {
  test("muestra el formulario de login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Usuario")).toBeVisible();
    await expect(page.getByText("Contraseña")).toBeVisible();
    await expect(page.getByRole("button", { name: /Entrar/ })).toBeVisible();
  });

  test("rechaza credenciales inválidas", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="text"]').fill(QA.usuario);
    await page.locator('input[type="password"]').fill("password-incorrecta");
    await page.getByRole("button", { name: /Entrar/ }).click();

    // El backend responde 401: NO debe entrar (se queda en login, sin dashboard).
    // (Nota UX: hoy la pantalla no muestra un cartel de error visible al fallar.)
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByRole("heading", { name: "Dashboard" })
    ).toHaveCount(0);
  });

  test("login válido entra al dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="text"]').fill(QA.usuario);
    await page.locator('input[type="password"]').fill(QA.password);
    await page.getByRole("button", { name: /Entrar/ }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("una ruta protegida sin sesión redirige a login", async ({ page }) => {
    await page.goto("/prospects");
    await expect(page).toHaveURL(/\/login/);
  });
});
