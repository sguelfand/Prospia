from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class DashboardLayout(Base):
    """Layout (posición/tamaño de los widgets) de una pantalla con gráficos, por
    usuario. Lo guarda react-grid-layout en la web: cada usuario acomoda sus
    tableros y le queda igual en cualquier sesión. `pantalla` identifica el tablero
    (ej. 'tokens', 'dashboard'); `layout` es el JSON de react-grid-layout (los
    `layouts` por breakpoint)."""
    __tablename__ = "dashboard_layout"
    __table_args__ = (UniqueConstraint("user_id", "pantalla", name="uq_dashboard_layout_user_pantalla"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    pantalla: Mapped[str] = mapped_column(String(60), nullable=False)
    layout: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    # Títulos personalizados por widget: JSON {widgetId: "título custom"}.
    titulos: Mapped[str] = mapped_column(Text, nullable=False, default="{}", server_default="{}")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
