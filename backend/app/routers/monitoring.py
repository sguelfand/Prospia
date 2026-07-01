"""Endpoints de monitoreo de servicios (solo super-admin).

Alimenta la sección Monitoreo de la app/web: estado de cada servicio con
semáforo, última verificación, re-chequeo manual (todo o individual) y la
frecuencia del chequeo automático."""
from fastapi import APIRouter, Depends, HTTPException

from app.core.deps import get_superadmin
# Importar los modelos al tope registra las tablas en Base.metadata para que
# create_all() las cree al arrancar (el service solo las importa lazy).
from app.models.service_health import MonitorSettings, ServiceHealth  # noqa: F401
from app.schemas.monitoring import GuardSemanticoUpdate, IntervalUpdate, MonitoringStatusOut, ServiceHealthOut
from app.services import monitoring

router = APIRouter(prefix="/admin/monitoring", tags=["monitoring"],
                   dependencies=[Depends(get_superadmin)])


@router.get("", response_model=MonitoringStatusOut)
def estado():
    """Estado actual de todos los servicios + frecuencia + resumen."""
    return monitoring.get_status()


@router.post("/recheck-all", response_model=MonitoringStatusOut)
def rechequear_todo():
    """Fuerza un chequeo de TODOS los servicios ahora mismo."""
    return monitoring.run_all()


@router.post("/{slug}/recheck", response_model=ServiceHealthOut)
def rechequear_uno(slug: str):
    """Fuerza el chequeo de un solo servicio."""
    res = monitoring.run_one(slug)
    if res is None:
        raise HTTPException(status_code=404, detail="Servicio desconocido")
    return res


@router.put("/settings", response_model=MonitoringStatusOut)
def set_settings(body: IntervalUpdate):
    """Actualiza la frecuencia del chequeo automático (entre 60s y 3600s)."""
    return monitoring.set_interval(body.interval_seconds)


@router.put("/guard-semantico", response_model=MonitoringStatusOut)
def set_guard_semantico(body: GuardSemanticoUpdate):
    """Prende/apaga la guardia semántica de salida de Camila (chequeo Haiku de cada
    mensaje saliente). Solo superadmin."""
    return monitoring.set_guard_semantico(body.on)
