from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserPreference(Base):
    """Preferencias chicas de UI por usuario y por pantalla (clave→valor en JSON).

    Hoy guarda el "default del selector" de las pantallas con selector por cliente
    (Calidad, Tokens): cuando el usuario tilda "definir por defecto", la opción
    elegida queda como su default y la pantalla la usa al abrir. `pantalla` es el id
    de la pantalla (ej. 'calidad', 'tokens'); `prefs` es el JSON con las prefs
    (ej. {"default_source": "etiguel"})."""
    __tablename__ = "user_preference"
    __table_args__ = (UniqueConstraint("user_id", "pantalla", name="uq_user_preference_user_pantalla"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    pantalla: Mapped[str] = mapped_column(String(60), nullable=False)
    prefs: Mapped[str] = mapped_column(Text, nullable=False, default="{}", server_default="{}")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
