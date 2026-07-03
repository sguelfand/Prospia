"""Test LLM — banco de pruebas para comparar motores (LLMs) en el rol de Camila.

Idea: correr el system prompt real de Camila (reconstruido desde el sobre vivo de
OpenClaw) contra un banco de escenarios (los casos de uso que Camila resuelve), con
distintos motores, y comparar CALIDAD (juez = Especialista de Negocio) y COSTO
(rate-card por motor). NO levanta un OpenClaw: llama a los modelos por API
OpenAI-compatible (OpenRouter / MyClaw / etc.). El costo se calcula con la tarifa
del gateway donde Camila realmente correría, no la del ejecutor.

Tablas:
- TestLlmMotor      : un motor registrado (proveedor + model_id + endpoint + rate-card)
- TestLlmEscenario  : un escenario de prueba (caso de uso + guion de turnos del cliente)
- TestLlmCorrida    : una comparación (N motores × M escenarios) con costo estimado/real
- TestLlmResultado  : una celda de la corrida (motor × escenario) con transcript + veredicto
"""
from __future__ import annotations
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TestLlmMotor(Base):
    """Motor candidato. `provider` es solo etiqueta (openrouter|myclaw|anthropic|custom);
    lo que importa para llamar es base_url + model_id + api_key. La rate-card ($/token)
    la carga el usuario para que el costo refleje el gateway real donde correría Camila
    (ej: MyClaw = 10% off oficial). api_key opcional: si va vacía se usa la key compartida
    del provider (monitor_settings)."""
    __tablename__ = "test_llm_motor"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120), nullable=False)      # "Sonnet 4.6 (MyClaw)"
    provider: Mapped[str] = mapped_column(String(40), nullable=False, default="openrouter")
    model_id: Mapped[str] = mapped_column(String(160), nullable=False)    # "anthropic/claude-sonnet-4.6"
    base_url: Mapped[str] = mapped_column(String(255), nullable=False, default="https://openrouter.ai/api/v1")
    api_key: Mapped[str | None] = mapped_column(String(255), nullable=True)  # vacía → key compartida del provider
    # rate-card en USD por token (input / output / cache-read / cache-write)
    precio_in: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    precio_out: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    precio_cache_read: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    precio_cache_write: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    es_actual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # el motor que usa Camila hoy
    notas: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class TestLlmEscenario(Base):
    """Un caso de uso de Camila como guion de prueba. `guion` (JSON) = lista de turnos
    del cliente (strings) que se le van dando al motor uno por uno. `esperado` (JSON) =
    qué debería hacer/decidir (ej: {"tool": "interesado"} o {"conducta": "..."}), para
    orientar al juez. `contexto` (JSON) opcional: hints del sobre (memoria previa del
    cliente, tipo de contacto), para escenarios que dependen de estado."""
    __tablename__ = "test_llm_escenario"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(60), nullable=False, unique=True, index=True)
    nombre: Mapped[str] = mapped_column(String(160), nullable=False)
    caso_uso: Mapped[str] = mapped_column(String(80), nullable=False, default="")  # etiqueta del tipo de conversación
    descripcion: Mapped[str] = mapped_column(Text, nullable=False, default="")
    guion: Mapped[str] = mapped_column(Text, nullable=False, default="[]")         # JSON: ["msg cliente 1", ...]
    esperado: Mapped[str] = mapped_column(Text, nullable=False, default="{}")      # JSON
    contexto: Mapped[str] = mapped_column(Text, nullable=False, default="{}")      # JSON
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    orden: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class TestLlmCorrida(Base):
    """Una comparación. estado: estimada → corriendo → lista | error. `motores` y
    `escenarios` (JSON) = ids elegidos. `resumen` (JSON) = tabla motor→{score, costo,
    por_caso}. `fidelidad` (JSON) = resultado del golden set (coincidencia vs OpenClaw),
    None hasta calibrar."""
    __tablename__ = "test_llm_corrida"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(60), nullable=False, default="etiguel", index=True)
    nombre: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    estado: Mapped[str] = mapped_column(String(16), nullable=False, default="estimada", index=True)
    motores: Mapped[str] = mapped_column(Text, nullable=False, default="[]")       # JSON ids
    escenarios: Mapped[str] = mapped_column(Text, nullable=False, default="[]")    # JSON ids
    costo_estimado_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    costo_real_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    resumen: Mapped[str] = mapped_column(Text, nullable=False, default="{}")       # JSON
    fidelidad: Mapped[str | None] = mapped_column(Text, nullable=True)             # JSON golden set
    # Veredicto / conclusión final del juez: recomendación en prosa de qué motor usar y por qué.
    # La genero yo en sesión con el plan Pro (subagente Sonnet), no la API. El botón de la UI solo
    # marca 'procesando' y espera a que me la pidas por el chat. conclusion_motores = subconjunto
    # del ranking sobre el que se pidió (vacío = todos los motores de la corrida).
    conclusion: Mapped[str | None] = mapped_column(Text, nullable=True)
    conclusion_estado: Mapped[str] = mapped_column(String(16), nullable=False, default="")  # ''|procesando|lista
    conclusion_motores: Mapped[str] = mapped_column(Text, nullable=False, default="[]")      # JSON ids
    conclusion_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TestLlmResultado(Base):
    """Una celda: qué hizo un motor en un escenario. `transcript` (JSON) = la conversación
    completa (cliente/asistente). `tool_calls` (JSON) = qué webhooks/decisiones tomó
    (interesado, no_interesa, escalar, etc.). `veredicto`: bien|mal|dudoso (juez)."""
    __tablename__ = "test_llm_resultado"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    corrida_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    motor_id: Mapped[int] = mapped_column(Integer, nullable=False)
    motor_nombre: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    escenario_slug: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    escenario_nombre: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    caso_uso: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    transcript: Mapped[str] = mapped_column(Text, nullable=False, default="[]")    # JSON
    tool_calls: Mapped[str] = mapped_column(Text, nullable=False, default="[]")    # JSON
    tokens_in: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens_cache_read: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens_cache_write: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    costo_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    latencia_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    veredicto: Mapped[str] = mapped_column(String(10), nullable=False, default="dudoso")  # bien|mal|dudoso
    categoria: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    detalle: Mapped[str] = mapped_column(Text, nullable=False, default="")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
