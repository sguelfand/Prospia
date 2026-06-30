"""Endpoints del especialista de calidad/negocio (#2) — solo super-admin.

Alimenta Monitoreo → Calidad: las revisiones que el agente dejó sobre las
conversaciones de Camila, y la confirmación de Sebi (que alimenta el aprendizaje)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.deps import get_superadmin
# Importar los modelos al tope registra las tablas en Base.metadata (create_all).
from app.models.camila_revision import CamilaConsolidacion, CamilaRevision  # noqa: F401
from app.services import camila_aprendizaje, camila_quality

router = APIRouter(prefix="/admin/calidad", tags=["calidad"],
                   dependencies=[Depends(get_superadmin)])


class ConfirmarIn(BaseModel):
    veredicto: str            # 'acierto' | 'falso_positivo'
    nota: str | None = None


class ReportarIn(BaseModel):
    source: str = "etiguel"
    telefono: str | None = None
    texto: str = ""
    imagen_b64: str | None = None        # base64 (sin prefijo data:) de la captura, opcional
    imagen_mime: str = "image/jpeg"


@router.get("/sources")
def sources():
    """Clientes disponibles para el selector de Calidad: Etiguel + cada tenant."""
    return camila_quality.get_sources_calidad()


@router.get("/auditoria-prompt")
def auditoria_prompt_estado(source: str = Query("etiguel")):
    """Última auditoría del prompt completo + si conviene re-correr (1×/semana)."""
    from app.services import camila_prompt_audit
    return camila_prompt_audit.estado(source)


@router.post("/auditoria-prompt")
def auditoria_prompt_correr(source: str = Query("etiguel")):
    """Corre la auditoría del prompt completo de Camila (nivel 2). Cuesta una llamada IA."""
    from app.services import camila_prompt_audit
    res = camila_prompt_audit.auditar(source)
    if not res.get("ok"):
        raise HTTPException(status_code=502, detail=res)
    return res


@router.post("/reportar")
def reportar(body: ReportarIn):
    """Crea a mano un registro de calidad ('Camila estuvo mal') desde la pantalla
    Calidad: teléfono (opcional) + descripción + (opcional) una captura de la
    conversación que se transcribe con IA y se suma a la lección. Igual que reportar
    desde un lead: entra ya confirmado como 'acierto' y suma. Solo superadmin."""
    try:
        rev = camila_quality.crear_reporte_manual(
            body.source, body.texto, (body.telefono or None),
            imagen_b64=body.imagen_b64, imagen_mime=body.imagen_mime or "image/jpeg")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"ok": True, "revision": rev}


@router.get("/revisiones")
def revisiones(source: str = Query("etiguel"), estado: str | None = Query(None)):
    """Revisiones del agente de calidad. `estado`: nuevo | revisado (default: todas)."""
    return camila_quality.get_revisiones(source, estado)


@router.post("/revisiones/{rev_id}/confirmar")
def confirmar(rev_id: int, body: ConfirmarIn):
    """Sebi confirma una revisión: 'acierto' (Camila estuvo mal, el agente acertó) o
    'falso_positivo' (Camila estuvo bien, el agente se equivocó). Alimenta el loop.
    Si fue 'acierto' y se juntó el umbral de lecciones, dispara la consolidación."""
    try:
        out = camila_quality.confirmar_revision(rev_id, body.veredicto, body.nota)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if out is None:
        raise HTTPException(status_code=404, detail="revisión no encontrada")
    if body.veredicto == "acierto":
        camila_aprendizaje.maybe_proponer(out.get("source", "etiguel"))
    return out


# ── Aprendizajes (Capa B: enseñarle a Camila) ────────────────────────────────

@router.get("/aprendizajes")
def aprendizajes(source: str = Query("etiguel")):
    """Estado de los aprendizajes: lecciones pendientes, umbral, propuesta abierta
    y última aplicada."""
    return camila_aprendizaje.estado(source)


@router.post("/aprendizajes/proponer")
def proponer(source: str = Query("etiguel")):
    """Consolida ahora las lecciones pendientes y deja una propuesta para aprobar."""
    return camila_aprendizaje.proponer(source, notify=False)


@router.post("/aprendizajes/{cons_id}/aprobar")
def aprobar(cons_id: int):
    """Aprueba la propuesta: la inyecta en el prompt de Camila (auto-backup + restart)."""
    res = camila_aprendizaje.aprobar(cons_id)
    if not res.get("ok"):
        raise HTTPException(status_code=409, detail=res)
    return res


@router.post("/aprendizajes/{cons_id}/descartar")
def descartar(cons_id: int):
    """Descarta la propuesta. Las lecciones quedan pendientes para la próxima."""
    return camila_aprendizaje.descartar(cons_id)


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
