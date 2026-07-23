from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ServiceHealth(Base):
    """Estado vivo de cada servicio monitoreado (webhook Etiguel, gateway de
    Camila, prospia.app, varen, DB, dependencias externas). Hay una fila por
    servicio (identificado por `slug`); el motor de monitoreo la actualiza en
    cada chequeo. Las DEFINICIONES de qué se chequea viven en
    services/monitoring.py; esta tabla guarda el último resultado para mostrarlo
    en la app/web y para detectar transiciones (OK→caído → push)."""
    __tablename__ = "service_health"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(60), unique=True, nullable=False, index=True)
    nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    grupo: Mapped[str] = mapped_column(String(40), nullable=False, default="otros")
    # estado: up | down | warn | unknown
    estado: Mapped[str] = mapped_column(String(12), nullable=False, default="unknown")
    last_check: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_ok: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # desde cuándo está en el estado actual (para "caído hace X")
    since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    detalle: Mapped[str | None] = mapped_column(Text, nullable=True)
    # critico=True → dispara push cuando pasa a caído. Externos suelen ser False.
    critico: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    orden: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class MonitorSettings(Base):
    """Config del monitoreo (fila única id=1): intervalo del chequeo automático y
    el deploy token de Etiguel (para el check del gateway de Camila vía
    /camila-config/diag). El token se guarda acá —no en el env de Coolify— para
    poder setearlo por SQL sin depender del panel; tiene fallback al env
    settings.ETIGUEL_DEPLOY_TOKEN si esta columna está vacía."""
    __tablename__ = "monitor_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=300)
    etiguel_deploy_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # API key de Anthropic para los asistentes IA de la plataforma (clasificar el
    # texto libre del relevamiento + chat de ayuda del formulario). Se guarda acá
    # —no en Coolify— para setearla por SQL; fallback a settings.ANTHROPIC_API_KEY.
    anthropic_api_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Switch "Preguntas al cel": cuando está ON, las preguntas de Claude Code se
    # rutean al celular (push + pantalla de opciones) en vez de la cajita nativa
    # de la terminal. Lo prende/apaga Sebi desde la app; lo lee el MCP local antes
    # de cada pregunta. Default OFF = comportamiento normal en la compu.
    preguntas_al_cel: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Guardia semántica de salida de Camila: Haiku decide si un mensaje saliente es
    # interno (razonamiento/estado) y lo bloquea. ON por default; se apaga desde la
    # app/web si molesta la latencia/costo. La lee el endpoint /ingest/guard-check.
    guard_semantico: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    # Última vez que se mandó el recordatorio semanal de auditoría del prompt de Camila
    # (para no repetir el push más de 1×/semana). Lo setea el loop de camila_quality.
    audit_recordatorio_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Test LLM (Testing → Motores LLM): gate de "correr" — OFF hasta el OK de Sebi,
    # porque correr consume tokens. Keys compartidas por proveedor para el banco de pruebas.
    test_llm_habilitado: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    openrouter_api_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    myclaw_api_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Alertas de saldo bajo (panel Saldos): flag por proveedor para avisar UNA sola
    # vez en la bajada (se resetea al recuperarse). OpenRouter avisa con saldo ≤ US$1;
    # MyClaw avisa cuando su API responde 'balance_depleted'.
    saldo_or_alertado: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    saldo_myclaw_alertado: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Número del último APK (build nativo) publicado de la app admin. La app lo lee
    # y lo compara con su propio APK_VERSION baked: si el instalado es menor, muestra
    # "hay un APK nuevo, instalalo". Se bumpea +1 en cada build EAS nuevo (junto con
    # app.json version, para el runtime gating). Ver [[project_prospia_admin_app]].
    apk_version: Mapped[int] = mapped_column(Integer, nullable=False, default=2, server_default="2")
    # ── Monitor de calidad en TIEMPO REAL + auditoría Opus en sesión ──
    # qa_realtime_on: prende el motor en vivo (triage MiniMax → juez Sonnet → push).
    #   Arranca APAGADO hasta validar el triage con el banco Test LLM.
    # qa_daily_batch_on: el viejo batch diario Sonnet. Arranca APAGADO: lo reemplaza la
    #   auditoría Opus que corre en sesión (a $0, mejor motor, e independiente).
    # qa_triage_model: modelo del filtro rápido (id de OpenRouter).
    # qa_audit_last_at: hasta cuándo ya auditó Opus (la próxima sesión revisa lo nuevo).
    qa_realtime_on: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    qa_daily_batch_on: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    qa_triage_model: Mapped[str] = mapped_column(String(80), nullable=False, default="minimax/minimax-m3", server_default="minimax/minimax-m3")
    qa_audit_last_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
