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


# Umbral de aviso de OpenRouter (US$). Configurable por env.
# Default US$5 (subido desde 1 el 22/7): OpenRouter pasó a cargar el 100% del tráfico
# de Camila (pin CAMILA_MYCLAW_OFF, MyClaw fuera) → más margen antes de saltar a Anthropic.
import os as _os
OPENROUTER_ALERTA_USD = float(_os.environ.get("OPENROUTER_ALERTA_USD", "5"))


def chequear_saldos_y_alertar():
    """Lo llama el loop de monitoreo. Avisa por push (superadmin) UNA sola vez en la
    bajada y se rearma al recuperarse:
      - OpenRouter: saldo ≤ OPENROUTER_ALERTA_USD (US$1 por default).
      - MyClaw: la API responde 'sin_saldo' (403 balance_depleted).
    El flag por proveedor (monitor_settings) evita spamear en cada pasada."""
    from app.database import SessionLocal
    from app.models.service_health import MonitorSettings
    from app.services import push

    keys = _get_keys()
    orr = _openrouter(keys["openrouter"])
    myc = _myclaw()

    db = SessionLocal()
    avisos = []
    try:
        s = db.query(MonitorSettings).filter(MonitorSettings.id == 1).first()
        if not s:
            return

        # ── OpenRouter: saldo bajo ──
        if orr.get("ok") and orr.get("tipo") == "saldo":
            saldo = orr.get("saldo_usd")
            if saldo is not None and saldo <= OPENROUTER_ALERTA_USD:
                if not s.saldo_or_alertado:
                    s.saldo_or_alertado = True
                    avisos.append((
                        "🟡 OpenRouter casi sin saldo",
                        f"A OpenRouter le queda US$ {saldo:.2f} (umbral US$ {OPENROUTER_ALERTA_USD:.0f}). "
                        "Recargá para que no se corte.",
                    ))
            elif saldo is not None and saldo > OPENROUTER_ALERTA_USD:
                s.saldo_or_alertado = False  # se recuperó → rearmar

        # ── MyClaw: sin saldo ──
        if myc.get("ok") and myc.get("tipo") == "estado":
            if myc.get("estado") == "sin_saldo":
                if not s.saldo_myclaw_alertado:
                    s.saldo_myclaw_alertado = True
                    avisos.append((
                        "🔴 MyClaw sin saldo",
                        "MyClaw se quedó sin saldo. Camila pasa a failover (Anthropic). "
                        "Recargá MyClaw para que vuelva.",
                    ))
            elif myc.get("estado") == "activo":
                s.saldo_myclaw_alertado = False  # se recuperó → rearmar

        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[SALDOS ALERTA ERROR] {type(e).__name__}: {e}")
        avisos = []
    finally:
        db.close()

    for title, body in avisos:
        try:
            push.notificar_global_async("saldo_bajo", title, body, {"nav": "saldos"})
        except Exception as e:
            print(f"[SALDOS ALERTA] no se pudo avisar: {e}")
