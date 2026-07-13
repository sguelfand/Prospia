"""Background job: re-encola prospects que llevan sin respuesta más del tiempo de
cadencia. Los parámetros (días de re-contacto, máximo de contactos, días para
cancelar) salen de la config de CADA tenant (tenant_config), con fallback a los
defaults históricos si el tenant no tiene config.

Prioridad: un callback agendado (prox_contacto) pausa la cadencia normal y, cuando
vence, re-encola al prospect (ver Grupo B)."""
import threading
import time
from datetime import datetime, timedelta, timezone

# Defaults (fallback si el tenant no tiene config cargada)
CADENCIA_DEFAULT = {"1": 7, "2": 14, "3": 90}
MAX_CONTACTOS_DEFAULT = 4
DIAS_CANCELAR_DEFAULT = 30


def _check_once():
    from app.database import SessionLocal
    from app.models.historial import ProspectHistorial
    from app.models.prospect import Prospect
    from app.models.tenant import TenantConfig

    db = SessionLocal()
    try:
        ahora = datetime.now(timezone.utc)

        # ── 0) Limpieza: avisos (push guardados) de más de 3 días (#42) ──────────
        try:
            from app.models.aviso import Aviso
            db.query(Aviso).filter(Aviso.fecha < ahora - timedelta(days=3)).delete(synchronize_session=False)
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"[CADENCE] no se pudo limpiar avisos viejos: {type(e).__name__}: {e}")

        # Config por tenant precargada (1 query) para no pegarle a la DB por prospect
        configs = {c.tenant_id: c for c in db.query(TenantConfig).all()}

        recolados = 0
        cancelados = 0
        callbacks = 0

        # ── 1) Callbacks agendados vencidos (prioridad sobre la cadencia) ─────────
        con_callback = (
            db.query(Prospect)
            .filter(
                Prospect.prox_contacto.isnot(None),
                Prospect.prox_contacto <= ahora,
                Prospect.estado.notin_(["interesado", "no_le_interesa", "cancelado"]),
                Prospect.bloqueado.is_(False),  # bloqueado → no se re-contacta
            )
            .all()
        )
        for p in con_callback:
            p.estado = "en_cola"
            p.prox_contacto = None  # limpiar para no repetir
            db.add(ProspectHistorial(
                prospect_id=p.id, tenant_id=p.tenant_id, tipo="en_cola_auto",
                detalle="Re-encolado por callback agendado vencido",
            ))
            callbacks += 1

        # ── 2) Cadencia normal por inactividad ────────────────────────────────────
        prospects = (
            db.query(Prospect)
            .filter(
                Prospect.estado == "contactado",
                Prospect.ult_contacto.isnot(None),
                Prospect.cant_contactos >= 1,
                Prospect.prox_contacto.is_(None),  # con callback pendiente → cadencia en pausa
                Prospect.bloqueado.is_(False),  # bloqueado → no se re-contacta
            )
            .all()
        )
        for p in prospects:
            cfg = configs.get(p.tenant_id)
            cadencia      = (cfg.cadencia_dias if cfg and cfg.cadencia_dias else CADENCIA_DEFAULT)
            max_contactos = (cfg.cadencia_max_contactos if cfg else MAX_CONTACTOS_DEFAULT)
            dias_cancelar = (cfg.cadencia_dias_cancelar if cfg else DIAS_CANCELAR_DEFAULT)

            if p.cant_contactos >= max_contactos:
                if ahora - p.ult_contacto >= timedelta(days=dias_cancelar):
                    p.estado = "cancelado"
                    db.add(ProspectHistorial(
                        prospect_id=p.id, tenant_id=p.tenant_id, tipo="cancelado_auto",
                        detalle=(
                            f"Cancelado automático tras {dias_cancelar} días "
                            f"sin respuesta del contacto #{max_contactos}. Contactar por teléfono."
                        ),
                    ))
                    cancelados += 1
                continue

            dias = (cadencia or {}).get(str(p.cant_contactos))
            if dias is None:
                continue
            if ahora - p.ult_contacto >= timedelta(days=int(dias)):
                p.estado = "en_cola"
                db.add(ProspectHistorial(
                    prospect_id=p.id, tenant_id=p.tenant_id, tipo="en_cola_auto",
                    detalle=f"Re-encolado automático tras {dias} días sin respuesta (contacto #{p.cant_contactos})",
                ))
                recolados += 1

        if recolados or cancelados or callbacks:
            db.commit()
            print(f"[CADENCE] {recolados} re-encolados, {cancelados} cancelados, {callbacks} callbacks")
    except Exception as e:
        print(f"[CADENCE ERROR] {e}")
    finally:
        db.close()

    # ── 3) Reactivación de conversaciones abandonadas (#100) ──────────────────
    # Conversaciones que se colgaron (cliente respondió y dejó de contestar). Corre
    # con su propia sesión de DB (best-effort, nunca frena la cadencia de arriba).
    try:
        from app.services import contact as contact_service
        contact_service.reactivar_abandonadas()
    except Exception as e:
        print(f"[REACTIVACION ERROR] {type(e).__name__}: {e}")


def start():
    def loop():
        time.sleep(60)  # espera inicial al arrancar
        while True:
            _check_once()
            time.sleep(3600)  # cada hora

    threading.Thread(target=loop, daemon=True, name="cadence-job").start()
