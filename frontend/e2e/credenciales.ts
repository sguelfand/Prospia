import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Credenciales de los tenants/usuarios de prueba.
 * - QA  = cliente N2 sobre el tenant AISLADO `qa-test` (escribir es seguro).
 * - ADMIN = superadmin de prueba `qa-admin` (N1) para las pantallas de admin.
 *   Su contraseña NO vive en el repo (es full-power): se lee de env o de
 *   ~/.config/claude/secrets.env (PROSPIA_QA_ADMIN_USER / PROSPIA_QA_ADMIN_PASS).
 */
function fromSecrets(key: string): string | undefined {
  try {
    const txt = fs.readFileSync(path.join(os.homedir(), ".config/claude/secrets.env"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* noop */ }
  return undefined;
}

export const QA = {
  usuario: process.env.PROSPIA_QA_USER || "qatest",
  password: process.env.PROSPIA_QA_PASS || "qatest12345",
};

export const ADMIN = {
  usuario: process.env.PROSPIA_QA_ADMIN_USER || fromSecrets("PROSPIA_QA_ADMIN_USER") || "qa-admin",
  password: process.env.PROSPIA_QA_ADMIN_PASS || fromSecrets("PROSPIA_QA_ADMIN_PASS") || "",
};
