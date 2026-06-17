from pydantic import BaseModel


class EstadoCount(BaseModel):
    estado: str
    count: int


class TerminoStat(BaseModel):
    termino: str
    termino_id: int
    encontrados: int
    en_conversacion: int
    interesados: int


class MesStat(BaseModel):
    mes: str           # "2026-05"
    encontrados: int   # total creados ese mes
    interesados: int
    no_le_interesa: int


class MesActual(BaseModel):
    prospects: int
    en_conversacion: int
    interesados: int
    tasa_respuesta: float   # en_conversacion / prospects * 100
    tasa_conversion: float  # interesados / prospects * 100


class DashboardStats(BaseModel):
    total_prospects: int
    por_estado: list[EstadoCount]
    por_estado_mes: list[EstadoCount]
    por_termino: list[TerminoStat]
    por_mes: list[MesStat]
    mes_actual: MesActual
