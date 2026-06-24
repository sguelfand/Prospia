"""Endpoints del auditor de consumo de Camila (solo super-admin).

Alimenta la pantalla Monitoreo → Tokens: consumo/costo del día y tendencia, top
conversaciones, errores y oportunidades de mejora, por cliente (source)."""
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.deps import get_superadmin
# Importar el modelo al tope registra la tabla en Base.metadata (create_all).
from app.models.camila_audit import CamilaAudit  # noqa: F401
from app.services import camila_audit

router = APIRouter(prefix="/admin/tokens", tags=["tokens"],
                   dependencies=[Depends(get_superadmin)])


@router.get("/sources")
def sources():
    """Clientes/agentes disponibles para auditar (hoy: Etiguel)."""
    return camila_audit.get_sources()


@router.get("/audit")
def audit(source: str = Query("etiguel"), days: int = Query(14, ge=1, le=90)):
    """Última auditoría (detalle) + tendencia de los últimos N días."""
    if source not in camila_audit.SOURCES:
        raise HTTPException(status_code=404, detail="source desconocido")
    return camila_audit.get_audits(source, days)


@router.post("/recompute")
def recompute(source: str = Query("etiguel"), fecha: str | None = Query(None)):
    """Recalcula la auditoría de un día (default: hoy). Sin push."""
    if source not in camila_audit.SOURCES:
        raise HTTPException(status_code=404, detail="source desconocido")
    f = fecha or camila_audit._hoy_ba()
    try:
        return camila_audit.run_audit(source, f, notify=False)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"{type(e).__name__}: {e}")
