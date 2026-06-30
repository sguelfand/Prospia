/**
 * Credenciales del tenant de prueba AISLADO `qa-test`.
 * Es un tenant vacío dedicado a tests automáticos — no es un cliente real.
 * Se pueden sobreescribir por variables de entorno.
 */
export const QA = {
  usuario: process.env.PROSPIA_QA_USER || "qatest",
  password: process.env.PROSPIA_QA_PASS || "qatest12345",
};
