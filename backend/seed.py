#!/usr/bin/env python3
"""Script de seed: crea/actualiza el tenant demo (Alan) + usuario admin + config.
Idempotente / upsert: se puede re-ejecutar para repoblar la config sin duplicar.
Los datos de Alan son de PRUEBA (inventados) — sirven para probar y mostrar."""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from app.database import Base, SessionLocal, engine
from app.models.tenant import Tenant, TenantConfig
from app.models.user import User
from app.models.rubro import Rubro
from app.core.auth import hash_password

Base.metadata.create_all(bind=engine)

db = SessionLocal()

# ── Tenant ────────────────────────────────────────────────────────────────────
tenant = db.query(Tenant).filter(Tenant.slug == "alan").first()
if not tenant:
    tenant = Tenant(nombre="Alan - Sanitarios B2B", slug="alan")
    db.add(tenant)
    db.flush()
    print(f"✓ Tenant '{tenant.nombre}' creado (id={tenant.id})")
else:
    print(f"✓ Tenant 'alan' ya existe (id={tenant.id})")

# ── Config (upsert: crea o actualiza la fila del tenant) ──────────────────────
CONFIG_DEMO = dict(
    # A. Negocio
    negocio_nombre="Alan - Sanitarios B2B",
    negocio_que_vende="Equipamiento sanitario y de obra para construcción (mayorista B2B)",
    negocio_propuesta_valor="Distribuidor mayorista con stock y precios para revendedores y constructoras",
    negocio_zona="Argentina",
    pais="Argentina",
    # C. Scraping
    scraping_idioma="es",
    scraping_exclusiones=["supermercado", "e-commerce de reventa", "empresa extranjera"],
    # D. Clasificación
    clasif_criterios={
        "ALTO": "Distribuidor, corralón o constructora que compra sanitarios al por mayor",
        "MEDIO": "Comercio del rubro que podría comprar en volumen",
        "BAJO": "Relación lejana con sanitarios/obra",
    },
    clasif_exclusiones=["retail puro", "fuera de Argentina"],
    # E. Contacto / mensajería
    agente_nombre="Camila",
    empresa_nombre_msg="Alan",
    # F. Cola / ritmo de envío (defaults del plan de contacto masivo)
    envio_tope_diario=20,
    envio_delay_seg=240,
    envio_hora_inicio=10,
    envio_hora_fin=18,
    timezone="America/Argentina/Buenos_Aires",
    # G. Cadencia
    cadencia_dias={"1": 7, "2": 14, "3": 90},
    cadencia_max_contactos=4,
    cadencia_dias_cancelar=30,
    # H. Bot Camila / OpenClaw (a conectar cuando exista)
    openclaw_gateway_url="http://127.0.0.1:18789/tools/invoke",
    openclaw_session_id="agent:alan:main",
    # I. Notificaciones
    notif_interesado_canal="whatsapp",
)

config = db.query(TenantConfig).filter(TenantConfig.tenant_id == tenant.id).first()
if not config:
    config = TenantConfig(tenant_id=tenant.id)
    db.add(config)
for campo, valor in CONFIG_DEMO.items():
    setattr(config, campo, valor)
print("✓ Config del tenant poblada (upsert)")

# ── Rubros (no duplicar) ──────────────────────────────────────────────────────
for rubro_nombre in ["sanitarios", "obra_construccion", "industria", "otros"]:
    existe = db.query(Rubro).filter(
        Rubro.tenant_id == tenant.id, Rubro.nombre == rubro_nombre
    ).first()
    if not existe:
        db.add(Rubro(tenant_id=tenant.id, nombre=rubro_nombre))

# ── Usuario admin (no duplicar) ───────────────────────────────────────────────
user = db.query(User).filter(User.email == "alan@demo.com").first()
if not user:
    db.add(User(
        tenant_id=tenant.id,
        email="alan@demo.com",
        password_hash=hash_password("demo1234"),
        nombre="Alan",
        role="admin",
    ))
    print("✓ Usuario: alan@demo.com / demo1234")

db.commit()
db.close()
print("✓ Seed completo")
