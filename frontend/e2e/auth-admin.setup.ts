import { test as setup, expect } from "@playwright/test";
import { ADMIN } from "./credenciales";

const authFile = "e2e/.auth/qa-admin.json";

/**
 * Loguea como el superadmin de prueba (qa-admin, N1) una vez y guarda la sesión.
 * Los specs de pantallas de admin la reusan con
 * test.use({ storageState: 'e2e/.auth/qa-admin.json' }).
 */
setup("login admin y guardar sesión", async ({ page }) => {
  if (!ADMIN.password) {
    throw new Error(
      "Falta PROSPIA_QA_ADMIN_PASS (env o ~/.config/claude/secrets.env). " +
      "Es la contraseña del superadmin de prueba qa-admin.",
    );
  }
  await page.goto("/login");
  await page.locator('input[type="text"]').fill(ADMIN.usuario);
  await page.locator('input[type="password"]').fill(ADMIN.password);
  await page.getByRole("button", { name: /Entrar/ }).click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  await page.context().storageState({ path: authFile });
});
