"""Pantalla Precios (solo super-admin): parámetros comerciales por cliente,
catálogo de servicios con costo, margen de ganancia y datos faltantes."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.deps import get_superadmin
# Registrar tablas en Base.metadata (create_all).
from app.models.pricing import ClientePricing, ServicioCosto  # noqa: F401
from app.services import pricing

router = APIRouter(prefix="/admin/precios", tags=["precios"],
                   dependencies=[Depends(get_superadmin)])


class PricingIn(BaseModel):
    abono_mensual_usd: float | None = None
    conversaciones_dia: float | None = None
    costo_conv_usd: float | None = None
    costo_conv_origen: str | None = None
    motor_primario: str | None = None
    motor_fallback: str | None = None
    notas: str | None = None


class ServicioIn(BaseModel):
    nombre: str = ""
    tipo: str = "fijo_compartido"
    source: str | None = None
    costo_mensual_usd: float | None = None
    detalle: str = ""


@router.get("/resumen")
def resumen(source: str = Query("etiguel")):
    """Todo lo de la pantalla: pricing, costos, margen, estructura, faltantes."""
    return pricing.get_resumen(source)


@router.get("/general")
def general():
    """Comparativa de margen entre clientes + costo de estructura."""
    return pricing.get_general()


@router.put("/cliente/{source}")
def actualizar(source: str, body: PricingIn):
    campos = {k: v for k, v in body.model_dump().items() if v is not None}
    # permitir explícitamente vaciar notas
    if body.notas is not None:
        campos["notas"] = body.notas
    return pricing.actualizar_pricing(source, campos)


@router.post("/servicios")
def crear_servicio(body: ServicioIn):
    if not body.nombre.strip():
        raise HTTPException(status_code=400, detail="falta nombre")
    return pricing.guardar_servicio(body.model_dump())


@router.put("/servicios/{servicio_id}")
def editar_servicio(servicio_id: int, body: ServicioIn):
    try:
        return pricing.guardar_servicio(
            {k: v for k, v in body.model_dump().items() if k != "nombre" or v},
            servicio_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/servicios/{servicio_id}")
def borrar_servicio(servicio_id: int):
    if not pricing.borrar_servicio(servicio_id):
        raise HTTPException(status_code=404, detail="servicio inexistente")
    return {"ok": True}


class CostoClienteIn(BaseModel):
    nombre: str
    costo_mensual_usd: float | None = None
    tipo: str = "fijo_cliente"
    detalle: str = ""


@router.post("/cliente/{source}/servicio")
def costo_cliente(source: str, body: CostoClienteIn):
    """Override por cliente de un servicio de la plantilla (o alta ad-hoc)."""
    return pricing.set_costo_cliente(source, body.nombre, body.costo_mensual_usd,
                                     body.tipo, body.detalle)


@router.post("/simular")
def simular(source: str = Query("etiguel")):
    """Crea una corrida del Test LLM (estimada, NO gasta tokens). Se corre desde
    Testing → Motores LLM con el gate de siempre."""
    try:
        return pricing.crear_simulacion(source)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
