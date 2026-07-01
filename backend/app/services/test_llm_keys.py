"""Keys compartidas por proveedor para el Test LLM.

Se guardan en monitor_settings (columnas openrouter_api_key / myclaw_api_key) con
fallback a env. Un motor puede traer su propia api_key; si va vacía, se usa la
compartida del proveedor. Las keys nunca se devuelven al frontend (solo un flag
'cargada': true/false)."""
from __future__ import annotations
import os

_COLS = {
    "openrouter": "openrouter_api_key",
    "myclaw": "myclaw_api_key",
    "anthropic": "anthropic_api_key",
}
_ENV = {
    "openrouter": "OPENROUTER_API_KEY",
    "myclaw": "MYCLAW_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
}


def provider_key(provider: str) -> str:
    provider = (provider or "").strip().lower()
    col = _COLS.get(provider)
    if col:
        try:
            from app.database import SessionLocal
            from app.models.service_health import MonitorSettings
            db = SessionLocal()
            try:
                s = db.query(MonitorSettings).filter(MonitorSettings.id == 1).first()
                v = getattr(s, col, None) if s else None
                if v:
                    return v
            finally:
                db.close()
        except Exception:
            pass
    env = _ENV.get(provider)
    return (os.environ.get(env, "") if env else "") or ""


def set_provider_key(provider: str, key: str) -> bool:
    provider = (provider or "").strip().lower()
    col = _COLS.get(provider)
    if not col:
        return False
    from app.database import SessionLocal
    from app.models.service_health import MonitorSettings
    db = SessionLocal()
    try:
        s = db.query(MonitorSettings).filter(MonitorSettings.id == 1).first()
        if not s:
            return False
        setattr(s, col, (key or "").strip() or None)
        db.commit()
        return True
    finally:
        db.close()


def key_status() -> dict:
    """Qué proveedores tienen key cargada (sin exponer las keys)."""
    return {p: bool(provider_key(p)) for p in _COLS}
