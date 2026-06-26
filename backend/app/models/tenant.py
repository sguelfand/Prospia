from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    config: Mapped["TenantConfig"] = relationship(back_populates="tenant", uselist=False)
    users: Mapped[list["User"]] = relationship(back_populates="tenant")  # noqa: F821
    terminos: Mapped[list["Termino"]] = relationship(back_populates="tenant")  # noqa: F821
    prospects: Mapped[list["Prospect"]] = relationship(back_populates="tenant")  # noqa: F821
    rubros: Mapped[list["Rubro"]] = relationship(back_populates="tenant")  # noqa: F821


class TenantConfig(Base):
    """Configuración por cliente. Una fila por tenant. Lo escalar va en columnas;
    lo variable (listas, criterios, datos del bot) en JSONB para no migrar la DB
    cada vez que cambia algo de un cliente. Ver run_migrations() en main.py."""
    __tablename__ = "tenant_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(Integer, ForeignKey("tenants.id"), nullable=False)

    # ── A. Negocio ────────────────────────────────────────────────────────────
    negocio_nombre: Mapped[str | None] = mapped_column(String(160))
    negocio_que_vende: Mapped[str | None] = mapped_column(Text)
    negocio_propuesta_valor: Mapped[str | None] = mapped_column(Text)
    negocio_zona: Mapped[str | None] = mapped_column(String(160))
    pais: Mapped[str] = mapped_column(String(60), default="Argentina", server_default="Argentina")
    sitio_web: Mapped[str | None] = mapped_column(String(255))

    # ── C. Scraping (términos y rubros son tablas propias) ────────────────────
    apify_token: Mapped[str | None] = mapped_column(String(255))
    scraping_idioma: Mapped[str] = mapped_column(String(8), default="es", server_default="es")
    scraping_exclusiones: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))

    # ── D. Clasificación ──────────────────────────────────────────────────────
    anthropic_api_key: Mapped[str | None] = mapped_column(String(255))
    clasif_criterios: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    clasif_exclusiones: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))

    # ── E. Contacto / mensajería ──────────────────────────────────────────────
    agente_nombre: Mapped[str] = mapped_column(String(80), default="Camila", server_default="Camila")
    empresa_nombre_msg: Mapped[str | None] = mapped_column(String(160))
    wa_templates: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    email_template: Mapped[str | None] = mapped_column(Text)
    canales: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("""'{"whatsapp": true, "email": true}'::jsonb"""))

    # ── F. Cola / ritmo de envío ──────────────────────────────────────────────
    envio_auto_habilitado: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    envio_tope_diario: Mapped[int] = mapped_column(Integer, default=20, server_default="20")
    envio_delay_seg: Mapped[int] = mapped_column(Integer, default=240, server_default="240")
    envio_hora_inicio: Mapped[int] = mapped_column(Integer, default=10, server_default="10")
    envio_hora_fin: Mapped[int] = mapped_column(Integer, default=18, server_default="18")
    timezone: Mapped[str] = mapped_column(String(60), default="America/Argentina/Buenos_Aires", server_default="America/Argentina/Buenos_Aires")

    # ── G. Cadencia de re-contacto ────────────────────────────────────────────
    cadencia_dias: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("""'{"1": 7, "2": 14, "3": 90}'::jsonb"""))
    cadencia_max_contactos: Mapped[int] = mapped_column(Integer, default=4, server_default="4")
    cadencia_dias_cancelar: Mapped[int] = mapped_column(Integer, default=30, server_default="30")

    # ── H. Bot Camila / OpenClaw (se releva ahora, se conecta después) ────────
    openclaw_gateway_url: Mapped[str | None] = mapped_column(String(255))
    openclaw_session_id: Mapped[str | None] = mapped_column(String(120))
    openclaw_gateway_token: Mapped[str | None] = mapped_column(String(255))  # por tenant (cierra G1)
    webhook_token: Mapped[str | None] = mapped_column(String(255))           # por tenant (cierra G1)
    bot_tono: Mapped[str | None] = mapped_column(Text)
    bot_datos_negocio: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    deriva_nombre: Mapped[str | None] = mapped_column(String(120))           # la "Delfina" del cliente
    deriva_whatsapp: Mapped[str | None] = mapped_column(String(40))
    bot_numero_whatsapp: Mapped[str | None] = mapped_column(String(40))

    # ── I. Notificaciones ─────────────────────────────────────────────────────
    notif_interesado_canal: Mapped[str] = mapped_column(String(20), default="whatsapp", server_default="whatsapp")
    notif_interesado_destino: Mapped[str | None] = mapped_column(String(255))
    # Email donde el cliente recibe el aviso de "tenés una consulta sin responder"
    # (la Camila del cliente escaló algo que no supo contestar). Se carga en el
    # relevamiento y es editable desde la config del cliente.
    notif_consultas_email: Mapped[str | None] = mapped_column(String(255))

    # ── J. Información del negocio (relevamiento) ──────────────────────────────
    # Documento estructurado del intake, editable por el cliente desde su
    # Configuración. Forma: {"values": {<field_id>: valor}, "extra": [{label, valor}],
    # "intake_at": ISO, "updated_at": ISO}. El esquema de campos vive en
    # services/intake_schema.py. Ver IntakeSubmission para el envío crudo + archivos.
    info_negocio: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    tenant: Mapped[Tenant] = relationship(back_populates="config")
