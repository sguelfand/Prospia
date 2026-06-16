"""Cola de envío con throttle, por tenant.

Drena prospects en estado `en_cola` respetando, para CADA tenant:
  - ventana horaria (envio_hora_inicio..envio_hora_fin) en su timezone
  - tope diario (envio_tope_diario)
  - delay mínimo entre envíos (envio_delay_seg)

Solo actúa sobre tenants con `envio_auto_habilitado = true` (opt-in explícito; los
demás no se tocan). El envío real lo hace contact.contactar_prospect (que mueve el
prospect a `contactado` y registra historial). Equivale al wa-queue-worker de Etiguel.
"""
import threading
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

TICK_S = 15  # cada cuánto revisa la cola

# Último envío por tenant (en memoria; se resetea al reiniciar — aceptable)
_last_send: dict[int, float] = {}


def _ahora_en_tz(tz_name: str) -> datetime:
    try:
        return datetime.now(ZoneInfo(tz_name or "America/Argentina/Buenos_Aires"))
    except Exception:
        return datetime.now(ZoneInfo("America/Argentina/Buenos_Aires"))


def _dentro_horario(cfg) -> bool:
    ahora = _ahora_en_tz(cfg.timezone)
    return cfg.envio_hora_inicio <= ahora.hour < cfg.envio_hora_fin


def _enviados_hoy(db, tenant_id: int, cfg) -> int:
    """Cuenta prospects contactados HOY (en el día del tenant). Un intento de
    contacto setea ult_contacto, así que esto = cantidad de envíos de hoy."""
    from app.models.prospect import Prospect
    ahora_tz = _ahora_en_tz(cfg.timezone)
    inicio_dia_tz = ahora_tz.replace(hour=0, minute=0, second=0, microsecond=0)
    inicio_utc = inicio_dia_tz.astimezone(timezone.utc)
    return (
        db.query(Prospect)
        .filter(
            Prospect.tenant_id == tenant_id,
            Prospect.ult_contacto.isnot(None),
            Prospect.ult_contacto >= inicio_utc,
        )
        .count()
    )


def _tick():
    from app.database import SessionLocal
    from app.models.prospect import Prospect
    from app.models.tenant import TenantConfig
    from app.services import contact as contact_service

    db = SessionLocal()
    try:
        configs = (
            db.query(TenantConfig)
            .filter(TenantConfig.envio_auto_habilitado.is_(True))
            .all()
        )
        for cfg in configs:
            tid = cfg.tenant_id

            if not _dentro_horario(cfg):
                continue

            # delay mínimo entre envíos
            ultimo = _last_send.get(tid, 0.0)
            if time.time() - ultimo < cfg.envio_delay_seg:
                continue

            # tope diario
            if _enviados_hoy(db, tid, cfg) >= cfg.envio_tope_diario:
                continue

            # próximo de la cola (el más viejo)
            prospect = (
                db.query(Prospect)
                .filter(Prospect.tenant_id == tid, Prospect.estado == "en_cola")
                .order_by(Prospect.created_at.asc())
                .first()
            )
            if not prospect:
                continue

            pid = prospect.id
            # contactar_prospect abre su propia sesión y mueve a 'contactado'
            contact_service.contactar_prospect(pid)
            _last_send[tid] = time.time()
            print(f"[QUEUE] tenant={tid} prospect={pid} contactado desde la cola")
    except Exception as e:
        print(f"[QUEUE ERROR] {e}")
    finally:
        db.close()


def start():
    def loop():
        time.sleep(30)  # espera inicial al arrancar
        while True:
            _tick()
            time.sleep(TICK_S)

    threading.Thread(target=loop, daemon=True, name="queue-worker").start()
