#!/usr/bin/env python3
"""Alta / actualización de un cliente (tenant) en Prospia — lo usa el agente
Implementador para la puesta en marcha.

Idempotente / upsert: se puede correr varias veces sin duplicar. Toma una "ficha de
cliente" en JSON (por path de archivo o por stdin) con esta forma:

{
  "slug": "acme",                          # único, obligatorio
  "nombre": "ACME Distribuciones",          # obligatorio
  "usuario": {"email": "...", "password": "...", "nombre": "..."},   # login del cliente
  "rubros":   ["rubro_a", "rubro_b"],       # opcional
  "terminos": ["termino 1", "termino 2"],   # opcional (búsquedas del scraper)
  "config":   { ... campos de tenant_config ... }   # opcional, los que se quieran setear
}

Reglas:
  - Solo se setean los campos de `config` que existen como columna en tenant_config
    (los desconocidos se avisan y se ignoran, para atajar typos).
  - Si el tenant no tiene webhook_token, se genera uno automáticamente.
  - El password del usuario se guarda hasheado.

Uso dentro del container:
  docker exec -i plataforma-backend-1 python provision_tenant.py < ficha.json
  docker exec plataforma-backend-1 python provision_tenant.py /ruta/ficha.json
"""
import json
import secrets
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from app.database import Base, SessionLocal, engine
from app.models.tenant import Tenant, TenantConfig
from app.models.user import User
from app.models.rubro import Rubro
from app.models.termino import Termino
from app.core.auth import hash_password

Base.metadata.create_all(bind=engine)

# Columnas que se pueden setear desde la ficha (todas las de tenant_config menos las internas)
_INTERNAS = {"id", "tenant_id", "created_at"}
CONFIG_COLS = [c.name for c in TenantConfig.__table__.columns if c.name not in _INTERNAS]


def _load_ficha() -> dict:
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as f:
            return json.load(f)
    return json.load(sys.stdin)


def main():
    ficha = _load_ficha()
    slug = ficha.get("slug")
    nombre = ficha.get("nombre")
    if not slug or not nombre:
        sys.exit("ERROR: la ficha necesita 'slug' y 'nombre'.")

    db = SessionLocal()
    try:
        # ── Tenant ────────────────────────────────────────────────────────────
        tenant = db.query(Tenant).filter(Tenant.slug == slug).first()
        if not tenant:
            tenant = Tenant(nombre=nombre, slug=slug)
            db.add(tenant)
            db.flush()
            print(f"✓ Tenant '{nombre}' creado (id={tenant.id}, slug={slug})")
        else:
            tenant.nombre = nombre
            print(f"✓ Tenant '{slug}' ya existía (id={tenant.id}) — actualizado")

        # ── Config (upsert + validación de campos) ────────────────────────────
        config = db.query(TenantConfig).filter(TenantConfig.tenant_id == tenant.id).first()
        if not config:
            config = TenantConfig(tenant_id=tenant.id)
            db.add(config)
        cfg_in = ficha.get("config", {}) or {}
        desconocidos = [k for k in cfg_in if k not in CONFIG_COLS]
        for k in desconocidos:
            print(f"  ⚠ campo de config desconocido, ignorado: {k}")
        for k, v in cfg_in.items():
            if k in CONFIG_COLS:
                setattr(config, k, v)
        # webhook_token automático si no hay
        if not config.webhook_token:
            config.webhook_token = "wh_" + secrets.token_hex(16)
            print(f"✓ webhook_token generado: {config.webhook_token}")

        # ── Rubros (no duplicar) ──────────────────────────────────────────────
        for nombre_rubro in ficha.get("rubros", []) or []:
            existe = db.query(Rubro).filter(
                Rubro.tenant_id == tenant.id, Rubro.nombre == nombre_rubro
            ).first()
            if not existe:
                db.add(Rubro(tenant_id=tenant.id, nombre=nombre_rubro))

        # ── Términos de búsqueda (no duplicar) ────────────────────────────────
        for texto in ficha.get("terminos", []) or []:
            existe = db.query(Termino).filter(
                Termino.tenant_id == tenant.id, Termino.texto == texto
            ).first()
            if not existe:
                db.add(Termino(tenant_id=tenant.id, texto=texto))

        # ── Usuario (login del cliente) ───────────────────────────────────────
        u = ficha.get("usuario") or {}
        if u.get("email"):
            user = db.query(User).filter(User.email == u["email"]).first()
            if not user:
                if not u.get("password"):
                    sys.exit(f"ERROR: el usuario {u['email']} es nuevo y necesita 'password'.")
                db.add(User(
                    tenant_id=tenant.id,
                    email=u["email"],
                    password_hash=hash_password(u["password"]),
                    nombre=u.get("nombre"),
                    role=u.get("role", "admin"),
                ))
                print(f"✓ Usuario creado: {u['email']}")
            else:
                if u.get("password"):
                    user.password_hash = hash_password(u["password"])
                    print(f"✓ Password actualizado para {u['email']}")
                print(f"✓ Usuario {u['email']} ya existía (tenant {user.tenant_id})")

        db.commit()
        print(f"✓ Provisioning completo para '{slug}'. webhook_token={config.webhook_token}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
