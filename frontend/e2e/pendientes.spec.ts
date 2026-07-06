import { test, expect } from "@playwright/test";

/**
 * Pendientes (N1) — carga con imagen adjunta/pegada (transcripción con IA),
 * réplica de lo que ya existe en Errores.
 *
 * NO transcribe una imagen real en los tests (gasta tokens de IA): valida que el
 * campo `detalle` exista en la respuesta (null sin imagen) y que la UI del modal
 * ofrezca adjuntar/pegar. Los pendientes son globales (no tienen tenant): cada
 * test siembra con marca "E2E" y borra lo que creó en el finally.
 */
test.use({ storageState: "e2e/.auth/qa-admin.json" });

test.describe("Pendientes · imagen adjunta/pegada (N1)", () => {
  test("API: crear pendiente devuelve `detalle` (null sin imagen)", async ({ page, baseURL }) => {
    await page.goto("/pendientes");
    const token = await page.evaluate(() => localStorage.getItem("token"));
    expect(token, "sesión de qa-admin válida").toBeTruthy();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const url = (p: string) => `${baseURL}/api${p}`;

    const marca = `E2E pendiente imagen ${Date.now()}`;
    const crear = await page.request.post(url("/admin/pendientes"), {
      headers,
      data: { texto: marca, prioridad: "baja", area: "app" },
    });
    expect(crear.ok(), "crear pendiente").toBeTruthy();
    const p = await crear.json();
    const id = p.id as number;
    expect(p).toHaveProperty("detalle"); // campo nuevo: transcripción de imagen
    expect(p.detalle).toBeNull();

    try {
      // Borrar la transcripción con imagen_b64:"" no debe romper (queda null).
      const edit = await page.request.patch(url(`/admin/pendientes/${id}`), {
        headers, data: { imagen_b64: "" },
      });
      expect(edit.ok(), "editar con imagen_b64 vacío").toBeTruthy();
      expect((await edit.json()).detalle).toBeNull();
    } finally {
      await page.request.delete(url(`/admin/pendientes/${id}`), { headers });
    }
  });

  test("UI: el modal 'Nuevo' ofrece adjuntar imagen y pegar (Ctrl+V)", async ({ page }) => {
    await page.goto("/pendientes");
    await page.getByRole("button", { name: /^Nuevo$/ }).click();
    await expect(page.getByRole("heading", { name: /Nuevo pendiente/ })).toBeVisible();
    await expect(page.getByText(/Adjuntar imagen o pegá/)).toBeVisible();
    await expect(page.getByText(/pegar una captura/)).toBeVisible();
  });
});
