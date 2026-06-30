from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TestRun(Base):
    """Una corrida de los tests visuales (Playwright). La carga el reporter
    (local por ahora; el runner en servidor es 2da etapa) vía POST /ingest/test-run.
    El detalle guarda el resultado por test, con el error de los que fallaron."""
    __tablename__ = "test_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    origen: Mapped[str] = mapped_column(String(20), default="local", server_default="local")  # local | servidor
    total: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    pasaron: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    fallaron: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    duracion_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Lista de {nombre, archivo, estado: 'passed'|'failed'|'skipped', error?: str, duracion_ms: int}
    detalle: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
