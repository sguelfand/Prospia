from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.routers import admin, auth, dashboard, etiguel_mirror, prospects, terminos


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
            "bot_tono TEXT",
            "bot_datos_negocio JSONB NOT NULL DEFAULT '{}'::jsonb",
            "deriva_nombre VARCHAR(120)",
            "deriva_whatsapp VARCHAR(40)",
            "bot_numero_whatsapp VARCHAR(40)",
            # I. Notificaciones
            "notif_interesado_canal VARCHAR(20) NOT NULL DEFAULT 'whatsapp'",
            "notif_interesado_destino VARCHAR(255)",
        ]
        for col in tenant_config_cols:
            conn.execute(text(f"ALTER TABLE tenant_config ADD COLUMN IF NOT EXISTS {col}"))

        # ── users.nivel: 1 = superadmin, 2 = cliente normal ──
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS nivel INTEGER NOT NULL DEFAULT 2"
        ))
        # superadmin ⇔ nivel 1 (idempotente)
        conn.execute(text("UPDATE users SET nivel = 1 WHERE role = 'superadmin'"))


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


from app.services import cadence
cadence.start()

from app.services import queue
queue.start()


@app.get("/")
def health():
    return {"status": "ok"}
