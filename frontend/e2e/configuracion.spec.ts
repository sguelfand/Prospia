import { test, expect } from "@playwright/test";

/**
 * Configuración (cliente N2). Se testea la VALIDACIÓN del cambio de contraseña
 * (contraseñas que no coinciden) — corta antes de llamar a la API, así NO cambia
 * la contraseña del usuario de prueba.
 */
test("cambiar contraseña: avisa si no coinciden", async ({ page }) => {
  await page.goto("/configuracion");
  // Las secciones arrancan colapsadas: expandir "Perfil" (contiene el cambio de contraseña).
  await page.getByText("Perfil", { exact: true }).click();
  // Los 3 inputs password de la sección "Cambiar contraseña": actual, nueva, repetir.
  const pwd = page.locator('input[type="password"]');
  await expect(pwd.first()).toBeVisible();
  await pwd.nth(0).fill("loquesea");
  await pwd.nth(1).fill("nueva-aaa-111");
  await pwd.nth(2).fill("nueva-bbb-222");
  await page.getByRole("button", { name: /Cambiar contraseña/ }).click();
  await expect(page.getByText("Las contraseñas no coinciden")).toBeVisible();
});
