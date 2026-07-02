import { test, expect } from "@playwright/test";

/**
 * Errores de Camila (N1) — carga manual + cola "Seleccionar → Procesar".
 *
 * Cubre la feature nueva: cargar un error a mano y el flujo de cola (tildar +
 * Procesar) replicado de Pendientes. Acotado al tenant aislado `qa-test`
 * (fuente="qa-test") para NO ensuciar los errores reales de etiguel; cada test
 * borra lo que sembró.
 */
test.use({ storageState: "e2e/.auth/qa-admin.json" });

test.describe("Errores · carga manual + cola (N1)", () => {
  test("flujo API: cargar → encolar → procesar → confirmar (fixed)", async ({ page, baseURL }) => {
    await page.goto("/errores");
    const token = await page.evaluate(() => localStorage.getItem("token"));
    expect(token, "sesión de qa-admin válida").toBeTruthy();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const url = (p: string) => `${baseURL}/api${p}`;

    // 1) Cargar un error a mano (fuente qa-test).
    const marca = `E2E error manual ${Date.now()}`;
    const crear = await page.request.post(url("/admin/errores"), {
      headers,
      data: { contenido: marca, fuente: "qa-test" },
    });
    expect(crear.ok(), "crear error manual").toBeTruthy();
    const err = await crear.json();
    const id = err.id as number;
    expect(err.estado).toBe("nuevo");
    expect(err.agente).toBe("sebi");
    expect(err.patron).toBe("manual");
    expect(err).toHaveProperty("detalle"); // campo nuevo (transcripción de imagen); null sin imagen
    expect(err.detalle).toBeNull();

    try {
      // 2) Encolar (Seleccionar → Procesar): pasa a cola_estado=pendiente y estado=reportado.
      const enc = await page.request.post(url("/admin/errores/cola"), { headers, data: { ids: [id] } });
      expect(enc.ok(), "encolar").toBeTruthy();
      const cola = await enc.json();
      const mio = cola.find((e: { id: number }) => e.id === id);
      expect(mio, "el error quedó en la cola").toBeTruthy();
      expect(mio.cola_estado).toBe("pendiente");
      expect(mio.estado).toBe("reportado");

      // 3) La cola FIFO lo incluye.
      const colaGet = await page.request.get(url("/admin/errores-cola"), { headers });
      expect(colaGet.ok()).toBeTruthy();
      expect((await colaGet.json()).some((e: { id: number }) => e.id === id)).toBeTruthy();

      // 4) Claude lo resuelve → cola_estado=procesado + conclusión.
      const proc = await page.request.patch(url(`/admin/errores/${id}`), {
        headers, data: { cola_estado: "procesado", cola_resultado: "E2E: arreglado." },
      });
      expect(proc.ok()).toBeTruthy();
      expect((await proc.json()).cola_estado).toBe("procesado");

      // 5) Sebi confirma (Fixed) → sale de la cola.
      const fix = await page.request.patch(url(`/admin/errores/${id}`), { headers, data: { estado: "fixed" } });
      expect(fix.ok()).toBeTruthy();
      const fixed = await fix.json();
      expect(fixed.estado).toBe("fixed");
      expect(fixed.cola_estado).toBeNull();
    } finally {
      await page.request.delete(url(`/admin/errores/${id}`), { headers });
    }
  });

  test("UI: el modal 'Cargar error' abre con textarea y adjuntar imagen", async ({ page }) => {
    await page.goto("/errores");
    await page.getByRole("button", { name: /Cargar error/ }).click();
    await expect(page.getByRole("heading", { name: /Cargar error a mano/ })).toBeVisible();
    await expect(page.getByPlaceholder(/Describí el error/)).toBeVisible();
    await expect(page.getByText(/Adjuntar imagen o pegá/)).toBeVisible();
  });

  test("UI: tildar un error y Procesar lo manda a la cola", async ({ page, baseURL }) => {
    await page.goto("/errores");
    const token = await page.evaluate(() => localStorage.getItem("token"));
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const url = (p: string) => `${baseURL}/api${p}`;

    // Sembramos un error qa-test para tildarlo desde la UI.
    const marca = `E2E procesar UI ${Date.now()}`;
    const crear = await page.request.post(url("/admin/errores"), {
      headers, data: { contenido: marca, fuente: "qa-test" },
    });
    const id = (await crear.json()).id as number;

    try {
      await page.reload();
      // La tarjeta del error sembrado (tab Nuevos por default).
      const card = page.locator("div", { hasText: marca }).filter({ has: page.locator('input[type="checkbox"]') }).last();
      await card.locator('input[type="checkbox"]').check();
      // Barra inferior de selección → Procesar.
      await page.getByRole("button", { name: /^Procesar$/ }).click();
      // Aparece el recuadro "Procesando" (o el error queda encolado).
      await expect
        .poll(async () => {
          const r = await page.request.get(url("/admin/errores-cola"), { headers });
          const cola = await r.json();
          return cola.some((e: { id: number }) => e.id === id);
        }, { timeout: 8000 })
        .toBeTruthy();
    } finally {
      await page.request.delete(url(`/admin/errores/${id}`), { headers });
    }
  });
});
