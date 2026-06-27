from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PreguntaClaude(Base):
    """Una pregunta que Claude Code (corriendo en la compu de Sebi) le hace a Sebi
    cuando el switch "Preguntas al cel" está prendido. En vez de la cajita nativa
    de la terminal, Claude llama al MCP local `preguntar_a_sebi` → este postea acá
    (POST /ingest/pregunta-claude) → push a la app → Sebi elige una opción en el
    cel (POST /admin/preguntas-claude/{id}/responder) → el MCP, que está haciendo
    long-poll a GET /ingest/pregunta-claude/{id}, recibe la elección y se la
    devuelve a Claude, que sigue como si Sebi hubiera tocado en la compu.

    `opciones` es la lista cruda del AskUserQuestion: [{"label","description"}].
    `elegida` guarda lo que tocó Sebi (label, o texto libre si usó "otra opción");
    para multiSelect se guardan labels separados por "\\n"."""
    __tablename__ = "preguntas_claude"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # chip/encabezado corto (header de AskUserQuestion), p.ej. "Deploy scraper"
    header: Mapped[str | None] = mapped_column(String(80))
    pregunta: Mapped[str] = mapped_column(Text, nullable=False)
    # JSON serializado: [{"label": "...", "description": "..."}]
    opciones: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    multiselect: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # contexto opcional (qué está haciendo Claude) para mostrar en la pantalla
    contexto: Mapped[str | None] = mapped_column(Text)
    # lo que eligió Sebi (label(s) o texto libre). None hasta que responde.
    elegida: Mapped[str | None] = mapped_column(Text)
    # pendiente (esperando) → respondida (Sebi eligió) → cancelada (timeout/abort)
    estado: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pendiente", server_default="pendiente", index=True
    )
    fecha: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    fecha_respuesta: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
