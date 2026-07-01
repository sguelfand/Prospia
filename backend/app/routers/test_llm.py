"""Endpoints del Test LLM (Testing → Motores LLM) — solo super-admin.

Comparar motores en el rol de Camila: registrar motores, editar escenarios, estimar
costo (barato, sin correr), correr (GATED por switch), ver resultados. Correr consume
tokens y está bloqueado hasta que Sebi prende el switch."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.deps import get_superadmin
# Importar los modelos al tope registra las tablas en Base.metadata (create_all).
from app.models.test_llm import (TestLlmCorrida, TestLlmEscenario,  # noqa: F401
                                 TestLlmMotor, TestLlmResultado)
from app.services import test_llm, test_llm_keys

router = APIRouter(prefix="/admin/test-llm", tags=["test-llm"],
                   dependencies=[Depends(get_superadmin)])


class MotorIn(BaseModel):
    nombre: str
    provider: str = "openrouter"
    model_id: str
    base_url: str = "https://openrouter.ai/api/v1"
    api_key: str | None = None
    precio_in: float = 0.0
    precio_out: float = 0.0
    precio_cache_read: float = 0.0
    precio_cache_write: float = 0.0
    activo: bool = True
    es_actual: bool = False
    notas: str = ""


class EscenarioIn(BaseModel):
    slug: str
    nombre: str
    caso_uso: str = ""
    descripcion: str = ""
    guion: list[str] = []
    esperado: dict = {}
    activo: bool = True
    orden: int = 0


class CorridaIn(BaseModel):
    source: str = "etiguel"
    motor_ids: list[int]
    escenario_ids: list[int]
    nombre: str = ""


class EstimarIn(BaseModel):
    source: str = "etiguel"
    motor_ids: list[int]
    escenario_ids: list[int]
    con_cache: bool = True


class KeyIn(BaseModel):
    provider: str
    key: str


class SwitchIn(BaseModel):
    on: bool


@router.get("/estado")
def estado(source: str = Query("etiguel")):
    """Panel: gate on/off, sobre (fidelidad), keys por proveedor, conteos."""
    return test_llm.get_estado(source)


@router.post("/habilitar")
def habilitar(body: SwitchIn):
    """Prende/apaga el gate de correr. Correr consume tokens: dejarlo OFF hasta el OK."""
    if not test_llm.set_habilitado(body.on):
        raise HTTPException(status_code=500, detail="no se pudo cambiar el switch")
    return {"ok": True, "habilitado": body.on}


# ── motores ──
@router.get("/motores")
def motores():
    return test_llm.listar_motores()


@router.post("/motores")
def crear_motor(body: MotorIn):
    return test_llm.guardar_motor(body.model_dump())


@router.put("/motores/{motor_id}")
def editar_motor(motor_id: int, body: MotorIn):
    try:
        return test_llm.guardar_motor(body.model_dump(), motor_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/motores/{motor_id}")
def eliminar_motor(motor_id: int):
    if not test_llm.borrar_motor(motor_id):
        raise HTTPException(status_code=404, detail="motor no encontrado")
    return {"ok": True}


# ── escenarios ──
@router.get("/escenarios")
def escenarios():
    return test_llm.listar_escenarios()


@router.post("/escenarios")
def crear_escenario(body: EscenarioIn):
    return test_llm.guardar_escenario(body.model_dump())


@router.put("/escenarios/{esc_id}")
def editar_escenario(esc_id: int, body: EscenarioIn):
    try:
        return test_llm.guardar_escenario(body.model_dump(), esc_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/escenarios/{esc_id}")
def eliminar_escenario(esc_id: int):
    if not test_llm.borrar_escenario(esc_id):
        raise HTTPException(status_code=404, detail="escenario no encontrado")
    return {"ok": True}


# ── keys por proveedor ──
@router.post("/keys")
def set_key(body: KeyIn):
    if not test_llm_keys.set_provider_key(body.provider, body.key):
        raise HTTPException(status_code=400, detail="proveedor sin slot de key")
    return {"ok": True, "keys": test_llm_keys.key_status()}


# ── estimar / correr / resultados ──
@router.post("/estimar")
def estimar(body: EstimarIn):
    """Costo estimado ANTES de correr. No consume tokens."""
    try:
        return test_llm.estimar(body.source, body.motor_ids, body.escenario_ids, body.con_cache)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"{type(e).__name__}: {e}")


@router.post("/corridas")
def crear_corrida(body: CorridaIn):
    """Crea la corrida con su costo estimado (estado 'estimada'). NO corre."""
    try:
        return test_llm.crear_corrida(body.source, body.motor_ids, body.escenario_ids, body.nombre)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"{type(e).__name__}: {e}")


@router.post("/corridas/{corrida_id}/correr")
def correr(corrida_id: int):
    """Ejecuta la corrida. GATED: si el switch está OFF, devuelve bloqueado sin gastar."""
    try:
        r = test_llm.correr(corrida_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"{type(e).__name__}: {e}")
    if r.get("bloqueado"):
        raise HTTPException(status_code=423, detail=r["detalle"])  # 423 Locked
    if not r.get("ok"):
        raise HTTPException(status_code=400, detail=r.get("detalle", "no se pudo correr"))
    return r


@router.get("/corridas")
def corridas(source: str = Query("etiguel")):
    return test_llm.listar_corridas(source)


@router.get("/corridas/{corrida_id}")
def corrida(corrida_id: int):
    c = test_llm.get_corrida(corrida_id)
    if c is None:
        raise HTTPException(status_code=404, detail="corrida no encontrada")
    return c
