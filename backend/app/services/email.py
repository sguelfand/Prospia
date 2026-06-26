"""Envío de mails transaccionales vía Resend.

Sender único para todos los tenants (`notificaciones@prospia.app`, configurable en
RESEND_FROM). Hoy se usa para avisarle al cliente que tiene una consulta sin
responder. Best-effort y en thread daemon: nunca rompe el flujo que lo dispara.
Si RESEND_API_KEY está vacío, no hace nada (no-op) y loguea."""
import threading

import requests

from app.core.config import settings

RESEND_URL = "https://api.resend.com/emails"


def _post(to: str, subject: str, html: str, text: str) -> None:
    try:
        r = requests.post(
            RESEND_URL,
            headers={
                "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": settings.RESEND_FROM,
                "to": [to],
                "subject": subject,
                "html": html,
                "text": text,
            },
            timeout=15,
        )
        if r.status_code >= 300:
            print(f"[EMAIL] Resend rechazó (HTTP {r.status_code}): {r.text[:300]}")
        else:
            print(f"[EMAIL] enviado a {to} → {subject!r}")
    except Exception as e:
        print(f"[EMAIL] error enviando a {to}: {type(e).__name__}: {e}")


def enviar_async(to: str, subject: str, html: str, text: str | None = None) -> bool:
    """Manda un mail en background. Devuelve True si se disparó el envío (no
    garantiza entrega). False si falta config o destinatario."""
    if not settings.RESEND_API_KEY:
        print("[EMAIL] sin RESEND_API_KEY, no se manda mail")
        return False
    if not (to or "").strip():
        print("[EMAIL] sin destinatario, no se manda mail")
        return False
    threading.Thread(target=_post, args=(to.strip(), subject, html, text or ""), daemon=True).start()
    return True


def aviso_consulta(to: str, cliente: str, telefono: str | None, pregunta: str) -> bool:
    """Mail al cliente avisándole que tiene una consulta sin responder, con link a
    la sección Preguntas de su panel."""
    url = settings.PROSPIA_WEB_URL.rstrip("/") + "/preguntas"
    quien = (telefono or "").strip() or "un cliente"
    preg = (pregunta or "").strip()
    subject = f"Tenés una consulta para responder — {cliente}"
    text = (
        f"Hola,\n\n{quien} hizo una consulta que tu asistente no supo responder y "
        f"necesita tu respuesta:\n\n\"{preg}\"\n\n"
        f"Entrá a {url} para contestarla. En cuanto respondas, se la enviamos al cliente.\n\n"
        f"— Prospia"
    )
    html = f"""<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0C1730">
  <h2 style="color:#0C1730">Tenés una consulta para responder</h2>
  <p><strong>{quien}</strong> hizo una consulta que tu asistente no supo responder y necesita tu respuesta:</p>
  <blockquote style="border-left:4px solid #F5B23D;margin:16px 0;padding:8px 16px;background:#F6F8FC;color:#0C1730">{preg}</blockquote>
  <p style="margin:24px 0">
    <a href="{url}" style="background:#F5B23D;color:#0C1730;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px;display:inline-block">Responder consulta</a>
  </p>
  <p style="color:#64748b;font-size:13px">En cuanto respondas, se la enviamos al cliente automáticamente.</p>
  <p style="color:#64748b;font-size:13px">— Prospia · {cliente}</p>
</div>"""
    return enviar_async(to, subject, html, text)
