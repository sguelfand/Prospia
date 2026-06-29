"""Endpoints del especialista de calidad/negocio (#2) — solo super-admin.

Alimenta Monitoreo → Calidad: las revisiones que el agente dejó sobre las
conversaciones de Camila, y la confirmación de Sebi (que alimenta el aprendizaje)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.deps import get_superadmin
# Importar el modelo al tope registra la tabla en Base.metadata (create_all).
from app.models.camila_revision import CamilaRevision  # noqa: F401
from app.services import camila_quality

router = APIRouter(prefix="/admin/calidad", tags=["calidad"],
                   dependencies=[Depends(get_superadmin)])


class ConfirmarIn(BaseModel):
    veredicto: str            # 'acierto' | 'falso_positivo'
    nota: str | None = None


@router.get("/revisiones")
def revisiones(source: str = Query("etiguel"), estado: str | None = Query(None)):
    """Revisiones del agente de calidad. `estado`: nuevo | revisado (default: todas)."""
    return camila_quality.get_revisiones(source, estado)


@router.post("/revisiones/{rev_id}/confirmar")
def confirmar(rev_id: int, body: ConfirmarIn):
    """Sebi confirma una revisión: 'acierto' (Camila estuvo mal, el agente acertó) o
    'falso_positivo' (Camila estuvo bien, el agente se equivocó). Alimenta el loop."""
    try:
        out = camila_quality.confirmar_revision(rev_id, body.veredicto, body.nota)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if out is None:
        raise HTTPException(status_code=404, detail="revisión no encontrada")
    return out


@router.delete("/revisiones/{rev_id}", status_code=204)
def borrar(rev_id: int):
    camila_quality.borrar_revision(rev_id)


@router.post("/revisar")
def revisar(source: str = Query("etiguel"), fecha: str | None = Query(None)):
    """Dispara la revisión de calidad de un día (default: ayer). Sin push si manual."""
    try:
        return camila_quality.revisar_dia(source, fecha, notify=False)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"{type(e).__name__}: {e}")
