from datetime import datetime

from pydantic import BaseModel


class TerminoCreate(BaseModel):
    texto: str


class TerminoOut(BaseModel):
    id: int
    texto: str
    encontrados: int
    interesados: int
    scraper_running: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ScraperStatus(BaseModel):
    termino_id: int
    running: bool
    message: str = ""
