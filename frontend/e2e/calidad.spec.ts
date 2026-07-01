import { test, expect } from "@playwright/test";

/**
 * Calidad de Camila (N1) — flujo "Es error de Camila, pero ya lo resolví"
 * (resuelto directo).
 *
 * El botón de la UI solo aparece sobre una revisión en estado `nuevo`, que no se
 * puede sembrar barato (el especialista cuesta tokens de IA). Por eso el test
 * ejercita la MISMA rama que dispara el botón a nivel API, contra prod, acotado
 * al tenant aislado `qa-test`: siembra una revisión, la confirma como
 * resuelto-directo y verifica que
 *   1) queda como 'acierto' (el especialista la sigue tomando → calibración), y
 *   2) NO suma a la cola de Aprendizajes (no re-inyecta al prompt de Camila).
 * Al final borra la revisión sembrada para no ensuciar qa-test.
 */
test.use({ storageState: "e2e/.auth/qa-admin.json" });

test.describe("Calidad · resuelto directo (N1)", () => {
  test("acierto resuelto directo: queda 'acierto' y no suma a Aprendizajes", async ({ page, baseURL }) => {
    await page.goto("/monitoreo/calidad");
    const token = await page.evaluate(() => localStorage.getItem("token"));
    expect(token, "sesión de qa-admin válida").toBeTruthy();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const url = (p: string) => `${baseURL}/api${p}`;

    // Pendientes de Aprendizajes ANTES (baseline para verificar que no re-enseña).
    const antesRes = await page.request.get(url("/admin/calidad/aprendizajes?source=qa-test"), { headers });
    expect(antesRes.ok()).toBeTruthy();
    const pendAntes = (await antesRes.json()).pendientes as number;

    // Sembramos una revisión en qa-test (entra ya como 'acierto', pendiente de enseñar).
    const rep = await page.request.post(url("/admin/calidad/reportar"), {
      headers,
      data: {
        source: "qa-test",
        texto: "E2E resuelto-directo: Camila pasó un precio viejo. Ya corregido a mano.",
      },
    });
    expect(rep.ok(), "sembrar revisión de prueba").toBeTruthy();
    const revId = (await rep.json()).revision.id as number;

    try {
      // Confirmamos como 'acierto' PERO resuelto directo (el fix a Camila ya está hecho).
      const conf = await page.request.post(url(`/admin/calidad/revisiones/${revId}/confirmar`), {
        headers,
        data: { veredicto: "acierto", resuelto_directo: true },
      });
      expect(conf.ok(), "confirmar resuelto directo").toBeTruthy();
      const body = await conf.json();
      expect(body.veredicto).toBe("acierto");        // el especialista lo toma como acierto
      expect(body.resuelto_directo).toBe(true);      // marcado como ya resuelto a mano

      // No aumenta la cola de Aprendizajes: la lección quedó fuera (no re-inyecta al prompt).
      const despuesRes = await page.request.get(url("/admin/calidad/aprendizajes?source=qa-test"), { headers });
      expect(despuesRes.ok()).toBeTruthy();
      const pendDespues = (await despuesRes.json()).pendientes as number;
      expect(pendDespues).toBeLessThanOrEqual(pendAntes);
    } finally {
      // Limpieza: borrar la revisión sembrada.
      await page.request.delete(url(`/admin/calidad/revisiones/${revId}`), { headers });
    }
  });
});
