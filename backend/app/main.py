from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
import app.models  # noqa: F401  (registra todas las tablas para create_all)
from app.routers import admin, auth, calidad, dashboard, etiguel_mirror, me, monitoring, prospects, public, terminos, test_llm, tokens


def run_migrations():
    """Aplica columnas nuevas a tablas existentes (idempotente)."""
    from sqlalchemy import text
    with engine.begin() as conn:
        conn.execute(text(
            "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS cant_contactos INTEGER NOT NULL DEFAULT 0"
        ))
        conn.execute(text(
            "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS ult_contacto TIMESTAMPTZ"
        ))
        # Migra estado obsoleto sin_respuesta → contactado
        conn.execute(text(
            "UPDATE prospects SET estado = 'contactado' WHERE estado = 'sin_respuesta'"
        ))
        # Migra para_contactar → en_cola
        conn.execute(text(
            "UPDATE prospects SET estado = 'en_cola' WHERE estado = 'para_contactar'"
        ))
        conn.execute(text(
            "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS clasificacion VARCHAR(10)"
        ))
        conn.execute(text(
            "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS clasificacion_detalle TEXT"
        ))
        conn.execute(text(
            "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS clasificacion_verificada BOOLEAN NOT NULL DEFAULT false"
        ))
        conn.execute(text(
            "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS prox_contacto TIMESTAMPTZ"
        ))

        # ── tenant_config: config por cliente (escalar en columnas, variable en JSONB) ──
        tenant_config_cols = [
            # A. Negocio
            "negocio_nombre VARCHAR(160)",
            "negocio_que_vende TEXT",
            "negocio_propuesta_valor TEXT",
            "negocio_zona VARCHAR(160)",
            "pais VARCHAR(60) NOT NULL DEFAULT 'Argentina'",
            "sitio_web VARCHAR(255)",
            # C. Scraping
            "apify_token VARCHAR(255)",
            "scraping_idioma VARCHAR(8) NOT NULL DEFAULT 'es'",
            "scraping_exclusiones JSONB NOT NULL DEFAULT '[]'::jsonb",
            # D. Clasificación
            "anthropic_api_key VARCHAR(255)",
            "clasif_criterios JSONB NOT NULL DEFAULT '{}'::jsonb",
            "clasif_exclusiones JSONB NOT NULL DEFAULT '[]'::jsonb",
            # E. Contacto / mensajería
            "agente_nombre VARCHAR(80) NOT NULL DEFAULT 'Camila'",
            "empresa_nombre_msg VARCHAR(160)",
            "wa_templates JSONB NOT NULL DEFAULT '[]'::jsonb",
            "email_template TEXT",
            "canales JSONB NOT NULL DEFAULT '{\"whatsapp\": true, \"email\": true}'::jsonb",
            # F. Cola / ritmo de envío
            "envio_auto_habilitado BOOLEAN NOT NULL DEFAULT false",
            "envio_tope_diario INTEGER NOT NULL DEFAULT 20",
            "envio_delay_seg INTEGER NOT NULL DEFAULT 240",
            "envio_hora_inicio INTEGER NOT NULL DEFAULT 10",
            "envio_hora_fin INTEGER NOT NULL DEFAULT 18",
            "timezone VARCHAR(60) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires'",
            # G. Cadencia
            "cadencia_dias JSONB NOT NULL DEFAULT '{\"1\": 7, \"2\": 14, \"3\": 90}'::jsonb",
            "cadencia_max_contactos INTEGER NOT NULL DEFAULT 4",
            "cadencia_dias_cancelar INTEGER NOT NULL DEFAULT 30",
            # H. Bot Camila / OpenClaw
            "openclaw_gateway_url VARCHAR(255)",
            "openclaw_session_id VARCHAR(120)",
            "openclaw_gateway_token VARCHAR(255)",
            "webhook_token VARCHAR(255)",
            "webhook_url VARCHAR(255)",
            "webhook_deploy_token VARCHAR(255)",
            "bot_tono TEXT",
            "bot_datos_negocio JSONB NOT NULL DEFAULT '{}'::jsonb",
            "deriva_nombre VARCHAR(120)",
            "deriva_whatsapp VARCHAR(40)",
            "bot_numero_whatsapp VARCHAR(40)",
            # I. Notificaciones
            "notif_interesado_canal VARCHAR(20) NOT NULL DEFAULT 'whatsapp'",
            "notif_interesado_destino VARCHAR(255)",
            "notif_consultas_email VARCHAR(255)",
            # J. Información del negocio (relevamiento, editable por el cliente)
            "info_negocio JSONB NOT NULL DEFAULT '{}'::jsonb",
        ]
        for col in tenant_config_cols:
            conn.execute(text(f"ALTER TABLE tenant_config ADD COLUMN IF NOT EXISTS {col}"))

        # ── users.nivel: 1 = superadmin, 2 = cliente normal ──
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS nivel INTEGER NOT NULL DEFAULT 2"
        ))
        # superadmin ⇔ nivel 1 (idempotente)
        conn.execute(text("UPDATE users SET nivel = 1 WHERE role = 'superadmin'"))

        # ── tenants.is_test: tenant de prueba (qa-test), oculto de agregados ──
        conn.execute(text(
            "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false"
        ))

        # ── pendientes: cola de procesamiento (tildar + Procesar) ──
        conn.execute(text(
            "ALTER TABLE pendientes ADD COLUMN IF NOT EXISTS cola_estado VARCHAR(20)"
        ))
        conn.execute(text(
            "ALTER TABLE pendientes ADD COLUMN IF NOT EXISTS cola_orden TIMESTAMPTZ"
        ))
        conn.execute(text(
            "ALTER TABLE pendientes ADD COLUMN IF NOT EXISTS cola_resultado TEXT"
        ))

        # ── etiguel_mirror: próximo contacto (cadencia/callback espejado) ──
        conn.execute(text(
            "ALTER TABLE etiguel_mirror ADD COLUMN IF NOT EXISTS prox_contacto VARCHAR(20)"
        ))

        # ── agent_errors: ciclo nuevo→reportado→fixed (cola de errores) ──
        conn.execute(text(
            "ALTER TABLE agent_errors ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'nuevo'"
        ))
        # ── agent_errors: cola de procesamiento (tildar + Procesar, igual que pendientes) ──
        conn.execute(text(
            "ALTER TABLE agent_errors ADD COLUMN IF NOT EXISTS cola_estado VARCHAR(20)"
        ))
        conn.execute(text(
            "ALTER TABLE agent_errors ADD COLUMN IF NOT EXISTS cola_orden TIMESTAMPTZ"
        ))
        conn.execute(text(
            "ALTER TABLE agent_errors ADD COLUMN IF NOT EXISTS cola_resultado TEXT"
        ))
        # ── agent_errors: detalle (transcripción de la imagen adjunta en carga manual) ──
        conn.execute(text(
            "ALTER TABLE agent_errors ADD COLUMN IF NOT EXISTS detalle TEXT"
        ))

        # ── monitor_settings: key de Anthropic para los asistentes IA del relevamiento ──
        conn.execute(text(
            "ALTER TABLE monitor_settings ADD COLUMN IF NOT EXISTS anthropic_api_key VARCHAR(255)"
        ))
        # ── monitor_settings: switch "Preguntas al cel" (Claude Code → push) ──
        conn.execute(text(
            "ALTER TABLE monitor_settings ADD COLUMN IF NOT EXISTS preguntas_al_cel BOOLEAN NOT NULL DEFAULT false"
        ))
        # ── preguntas_claude: soporte multi-pregunta (tanda como el AskUserQuestion nativo) ──
        conn.execute(text(
            "ALTER TABLE preguntas_claude ADD COLUMN IF NOT EXISTS preguntas TEXT NOT NULL DEFAULT '[]'"
        ))
        conn.execute(text(
            "ALTER TABLE preguntas_claude ADD COLUMN IF NOT EXISTS respuestas TEXT"
        ))

        # ── prospects: verificación de envío real ("¿salió el WhatsApp?") ──
        conn.execute(text(
            "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS envio_pendiente_desde TIMESTAMPTZ"
        ))
        conn.execute(text(
            "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS envio_no_confirmado BOOLEAN NOT NULL DEFAULT false"
        ))
        conn.execute(text(
            "ALTER TABLE prospects ADD COLUMN IF NOT EXISTS envio_reintentos INTEGER NOT NULL DEFAULT 0"
        ))
        # backfill: los ya resueltos pasan a 'fixed' (idempotente)
        conn.execute(text(
            "UPDATE agent_errors SET estado = 'fixed' WHERE resuelto = true AND estado = 'nuevo'"
        ))

        # ── camila_revision: marca de lección incorporada al prompt de Camila (Capa B) ──
        conn.execute(text(
            "ALTER TABLE camila_revision ADD COLUMN IF NOT EXISTS incorporada_at TIMESTAMPTZ"
        ))
        # ── camila_revision: origen de la revisión ('especialista' | 'sebi' a mano) ──
        conn.execute(text(
            "ALTER TABLE camila_revision ADD COLUMN IF NOT EXISTS origen VARCHAR(16) NOT NULL DEFAULT 'especialista'"
        ))
        # ── camila_revision: Sebi ya arregló Camila a mano (fix directo) → el especialista
        #    aprende (queda 'acierto' en la calibración) pero la lección no va a la cola de
        #    Aprendizajes (no re-inyecta al prompt de Camila). ──
        conn.execute(text(
            "ALTER TABLE camila_revision ADD COLUMN IF NOT EXISTS resuelto_directo BOOLEAN NOT NULL DEFAULT false"
        ))
        # ── monitor_settings: timestamp del último recordatorio de auditoría de prompt ──
        conn.execute(text(
            "ALTER TABLE monitor_settings ADD COLUMN IF NOT EXISTS audit_recordatorio_at TIMESTAMPTZ"
        ))
        # ── camila_prompt_audit: hallazgos estructurados (JSON) para render formateado ──
        conn.execute(text(
            "ALTER TABLE camila_prompt_audit ADD COLUMN IF NOT EXISTS hallazgos TEXT NOT NULL DEFAULT '[]'"
        ))
        # ── monitor_settings: switch de la guardia semántica de Camila (ON default) ──
        conn.execute(text(
            "ALTER TABLE monitor_settings ADD COLUMN IF NOT EXISTS guard_semantico BOOLEAN NOT NULL DEFAULT true"
        ))
        # ── anthropic_usage: atribuir el gasto interno por cliente (source) ──
        conn.execute(text(
            "ALTER TABLE anthropic_usage ADD COLUMN IF NOT EXISTS source VARCHAR(60)"
        ))
        # ── dashboard_layout: títulos personalizados de los widgets ──
        conn.execute(text(
            "ALTER TABLE dashboard_layout ADD COLUMN IF NOT EXISTS titulos TEXT NOT NULL DEFAULT '{}'"
        ))
        # ── monitor_settings: Test LLM — gate de correr (OFF hasta el OK de Sebi) + keys por proveedor ──
        conn.execute(text(
            "ALTER TABLE monitor_settings ADD COLUMN IF NOT EXISTS test_llm_habilitado BOOLEAN NOT NULL DEFAULT false"
        ))
        conn.execute(text(
            "ALTER TABLE monitor_settings ADD COLUMN IF NOT EXISTS openrouter_api_key VARCHAR(255)"
        ))
        conn.execute(text(
            "ALTER TABLE monitor_settings ADD COLUMN IF NOT EXISTS myclaw_api_key VARCHAR(255)"
        ))
        conn.execute(text(
            "ALTER TABLE monitor_settings ADD COLUMN IF NOT EXISTS apk_version INTEGER NOT NULL DEFAULT 2"
        ))


Base.metadata.create_all(bind=engine)
run_migrations()

app = FastAPI(title="Prospia", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(prospects.router)
app.include_router(terminos.router)
app.include_router(dashboard.router)
app.include_router(admin.router)
app.include_router(etiguel_mirror.router)
app.include_router(monitoring.router)
app.include_router(tokens.router)
app.include_router(public.router)
app.include_router(me.router)
app.include_router(calidad.router)
app.include_router(test_llm.router)


from app.services import cadence
cadence.start()

from app.services import queue
queue.start()

from app.services import monitoring as monitoring_service
monitoring_service.start()

from app.services import camila_audit
camila_audit.start()

from app.services import camila_quality
camila_quality.start()

from app.services import camila_cost_ai
camila_cost_ai.start()

from app.services import camila_aprendizaje
camila_aprendizaje.start()


@app.get("/")
def health():
    return {"status": "ok"}
