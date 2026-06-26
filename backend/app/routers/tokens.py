"""Endpoints del auditor de consumo de Camila (solo super-admin).

Alimenta Monitoreo → Tokens: costo por conversación (teléfono), barras diarias
(mensajes vs errores), serie mensual, por_modelo del mes y oportunidades FIJAS."""
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.deps import get_superadmin
# Importar los modelos al tope registra las tablas en Base.metadata (create_all).
from app.models.camila_audit import CamilaAudit, CamilaAuditMensual, CamilaOportunidad  # noqa: F401
from app.services import camila_audit

router = APIRouter(prefix="/admin/tokens", tags=["tokens"],
                   dependencies=[Depends(get_superadmin)])


@router.get("/sources")
def sources():
    """Clientes/agentes disponibles para auditar (hoy: Etiguel)."""
    return camila_audit.get_sources()


@router.get("/audit")
def audit(source: str = Query("etiguel"), days: int = Query(14, ge=1, le=90)):
    """Día más reciente (por conversación) + tendencia diaria (mensajes/errores) +
    serie mensual + por_modelo del mes + oportunidades abiertas."""
    if source not in camila_audit.SOURCES:
        raise HTTPException(status_code=404, detail="source desconocido")
    return camila_audit.get_audit(source, days)


@router.get("/dia")
def dia(source: str = Query("etiguel"), fecha: str = Query(...)):
    """Drill-down de un día: lista COMPLETA de conversaciones con todo el detalle
    (tokens, costo, split por modelo/cache, timeouts/errores, ejemplo, horario)."""
    if source not in camila_audit.SOURCES:
        raise HTTPException(status_code=404, detail="source desconocido")
    d = camila_audit.get_dia(source, fecha)
    if d is None:
        return {"source": source, "fecha": fecha, "vacio": True, "conversaciones": []}
    return d


@router.get("/conversacion")
def conversacion(source: str = Query("etiguel"), telefono: str = Query(...)):
    """Costo en vivo de una conversación (por teléfono) — para la pantalla de chat
    de la app. Proxy al webhook del cliente."""
    if source not in camila_audit.SOURCES:
        raise HTTPException(status_code=404, detail="source desconocido")
    try:
        return camila_audit.get_conversacion_costo(source, telefono)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"{type(e).__name__}: {e}")


@router.get("/clientes")
def clientes():
    """Gasto del mes actual + serie mensual por cliente (cards + gráfico del
    dashboard superadmin)."""
    return camila_audit.get_clientes_resumen()


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


@router.post("/backfill")
def backfill(source: str = Query("etiguel"), meses: int = Query(6, ge=1, le=12)):
    """Recalcula el rollup mensual barriendo las trajectories (histórico)."""
    if source not in camila_audit.SOURCES:
        raise HTTPException(status_code=404, detail="source desconocido")
    try:
        return camila_audit.backfill_mensual(source, meses=meses)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"{type(e).__name__}: {e}")


@router.post("/oportunidades/{op_id}/resolver")
def resolver(op_id: int, abrir: bool = Query(False)):
    """Marca una oportunidad como resuelta (o la re-abre con abrir=true)."""
    ok = camila_audit.resolver_oportunidad(op_id, resolver=not abrir)
    if not ok:
        raise HTTPException(status_code=404, detail="oportunidad no encontrada")
    return {"ok": True, "id": op_id, "estado": "abierta" if abrir else "resuelta"}
