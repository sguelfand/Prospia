"""Saldos de los proveedores de IA (panel 'Saldos').

Consolida lo que cada proveedor expone:
  - OpenRouter: saldo REAL en USD  (GET /api/v1/credits → total_credits - total_usage)
  - MyClaw: solo ESTADO (activo / sin saldo). Su API /v1/usage no expone el monto;
    cuando el saldo se agota devuelve 403 'balance_depleted'. Se consulta a través
    del proxy del webhook de Etiguel (la IP del container está whitelisteada).
  - Anthropic: NO expone saldo por API. Se muestra el CONSUMO del mes (dato que ya
    trackeamos) + nota de que el saldo solo se ve en la consola.
"""
import requests

from app.core.config import settings


def _get_keys():
    """Lee las keys de MonitorSettings (id=1), con fallback a env."""
    import os
    from app.database import SessionLocal
    from app.models.service_health import MonitorSettings
    db = SessionLocal()
    try:
        s = db.query(MonitorSettings).filter(MonitorSettings.id == 1).first()
        openrouter = (s.openrouter_api_key if s else None) or os.environ.get("OPENROUTER_API_KEY", "")
        return {"openrouter": openrouter}
    finally:
        db.close()


def _openrouter(key: str) -> dict:
    """Saldo real de OpenRouter en USD."""
    if not key:
        return {"proveedor": "OpenRouter", "ok": False, "error": "sin API key configurada"}
    try:
        r = requests.get(
            "https://openrouter.ai/api/v1/credits",
            headers={"Authorization": f"Bearer {key}"},
            timeout=15,
        )
        if r.status_code != 200:
            return {"proveedor": "OpenRouter", "ok": False, "error": f"HTTP {r.status_code}"}
        d = (r.json() or {}).get("data", {})
        total = float(d.get("total_credits", 0) or 0)
        usado = float(d.get("total_usage", 0) or 0)
        saldo = round(total - usado, 2)
        return {
            "proveedor": "OpenRouter",
            "ok": True,
            "tipo": "saldo",
            "saldo_usd": saldo,
            "total_usd": round(total, 2),
            "usado_usd": round(usado, 2),
            "estado": "sin_saldo" if saldo <= 0 else "activo",
        }
    except Exception as e:
        return {"proveedor": "OpenRouter", "ok": False, "error": f"{type(e).__name__}: {e}"}


def _myclaw() -> dict:
    """Estado de MyClaw vía el proxy /myclaw-usage del webhook de Etiguel. La API
    de MyClaw no expone el monto del saldo: solo sabemos si está activo (200) o sin
    saldo (403 balance_depleted)."""
    base = (settings.ETIGUEL_WEBHOOK_URL or "").rstrip("/")
    token = settings.ETIGUEL_DEPLOY_TOKEN or ""
    if not base or not token:
        return {"proveedor": "MyClaw", "ok": False, "error": "webhook de Etiguel no configurado"}
    try:
        r = requests.get(
            f"{base}/myclaw-usage",
            headers={"X-Deploy-Token": token,
                     "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
            timeout=20,
        )
        data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        up_status = data.get("upstream_status")
        body = data.get("body", {})
        if up_status == 200:
            return {"proveedor": "MyClaw", "ok": True, "tipo": "estado",
                    "estado": "activo", "detalle": "Con saldo (API respondiendo)."}
        # 403 con balance_depleted = sin saldo.
        motivo = ""
        if isinstance(body, dict):
            err = body.get("error", {})
            motivo = (err.get("message") or "") if isinstance(err, dict) else ""
            depleted = isinstance(err, dict) and err.get("details", {}).get("pause_reason") == "balance_depleted"
        else:
            depleted = "balance" in str(body).lower()
        if up_status == 403 and depleted:
            return {"proveedor": "MyClaw", "ok": True, "tipo": "estado",
                    "estado": "sin_saldo", "detalle": motivo or "Sin saldo — recargá la cuenta."}
        return {"proveedor": "MyClaw", "ok": True, "tipo": "estado", "estado": "desconocido",
                "detalle": f"upstream {up_status}: {motivo or body}"[:200]}
    except Exception as e:
        return {"proveedor": "MyClaw", "ok": False, "error": f"{type(e).__name__}: {e}"}


def _anthropic() -> dict:
    """Anthropic NO expone saldo por API. Mostramos el consumo del mes (lo que ya
    trackeamos) + nota de que el saldo solo se ve en la consola."""
    try:
        from app.services import anthropic_usage
        r = anthropic_usage.resumen(meses=1)
        return {
            "proveedor": "Anthropic",
            "ok": True,
            "tipo": "consumo",
            "estado": "sin_api_saldo",
            "consumo_mes_usd": r.get("total_mes", 0),
            "mes_nombre": r.get("mes_nombre", ""),
            "detalle": "Anthropic no expone el saldo por API — solo se ve en la consola. Muestro el consumo del mes.",
        }
    except Exception as e:
        return {"proveedor": "Anthropic", "ok": True, "tipo": "consumo", "estado": "sin_api_saldo",
                "consumo_mes_usd": None, "detalle": "Anthropic no expone el saldo por API (consultá la consola)."}


def obtener_saldos() -> dict:
    """Devuelve los saldos/estados de los 3 proveedores para el panel."""
    from datetime import datetime, timezone
    keys = _get_keys()
    return {
        "proveedores": [_openrouter(keys["openrouter"]), _myclaw(), _anthropic()],
        "consultado_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
