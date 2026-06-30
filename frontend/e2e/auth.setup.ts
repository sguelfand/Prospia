import { test as setup, expect } from "@playwright/test";
import { QA } from "./credenciales";

const authFile = "e2e/.auth/qatest.json";

/**
 * Loguea por la UI (como un usuario real: escribe usuario+contraseña y aprieta
 * "Entrar") una sola vez y guarda la sesión. El resto de los tests arrancan ya
 * adentro reutilizando este estado.
 */
setup("login y guardar sesión", async ({ page }) => {
  await page.goto("/login");

  await page.locator('input[type="text"]').fill(QA.usuario);
  await page.locator('input[type="password"]').fill(QA.password);
  await page.getByRole("button", { name: /Entrar/ }).click();

  // Tras login válido cae en el dashboard
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
