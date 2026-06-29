from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CamilaRevision(Base):
    """Revisión de CALIDAD de una conversación de Camila hecha por el agente
    especialista en el negocio (#2). El agente lee la charla y, si algo le llama
    la atención (lead perdido, info incorrecta, tono, oportunidad de venta sin
    aprovechar…), deja una revisión acá para que Sebi la confirme.

    El loop de aprendizaje: la confirmación de Sebi (`veredicto`) se acumula y se
    re-inyecta al agente como ejemplos calibradores en cada corrida (in-context,
    sin fine-tuning). Los `falso_positivo` (Camila estuvo bien, el agente se
    equivocó) son los más valiosos: le enseñan a no marcar ese tipo de caso.

    Dedup: una revisión por (source, telefono, fecha, categoria) — re-correr el
    día no duplica."""
    __tablename__ = "camila_revision"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(60), nullable=False, index=True, default="etiguel")
    # Link al espejo para abrir la conversación entera desde la app/web.
    mirror_id: Mapped[int | None] = mapped_column(Integer, index=True)
    telefono: Mapped[str | None] = mapped_column(String(50), index=True)
    nombre: Mapped[str | None] = mapped_column(String(255))
    # Día de la conversación revisada (YYYY-MM-DD, hora BA).
    fecha: Mapped[str] = mapped_column(String(10), nullable=False, index=True)

    # Qué tipo de problema/oportunidad detectó el agente.
    categoria: Mapped[str] = mapped_column(String(40), nullable=False, default="otro")
    severidad: Mapped[str] = mapped_column(String(10), nullable=False, default="media")
    titulo: Mapped[str] = mapped_column(String(200), nullable=False)
    detalle: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Fragmento textual de la charla que justifica la observación.
    fragmento: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Sugerencia concreta de mejora (de prompt/config de Camila).
    sugerencia: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # Cola: 'nuevo' (recién detectado) → 'revisado' (Sebi confirmó con veredicto).
    estado: Mapped[str] = mapped_column(String(12), nullable=False, default="nuevo", server_default="nuevo", index=True)
    # Confirmación de Sebi (el feedback que alimenta el aprendizaje):
    #   None          = todavía no lo revisó
    #   'acierto'     = Camila estuvo mal, el agente acertó
    #   'falso_positivo' = Camila estuvo bien, el agente se equivocó
    veredicto: Mapped[str | None] = mapped_column(String(16))
    nota_sebi: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    revisado_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
