"""Adapter de Etiguel sobre Monday.com.

Etiguel es la implementación productiva del producto sobre Monday (no vive en
esta base de datos). Este adapter consulta sus boards y devuelve los KPIs en el
MISMO shape que un cliente de la Plataforma, para que la app de administración lo
muestre como un cliente más (fuente="etiguel").

Se cachea en memoria con TTL corto para no pegarle a Monday en cada refresh de la
app. Si no hay MONDAY_API_KEY en el entorno, enabled() devuelve False y los
endpoints simplemente no incluyen Etiguel (degradación elegante)."""
from __future__ import annotations

import os
import time
from datetime import date, datetime

import requests

from app.schemas.admin import ClienteResumen, EtiguelLead
from app.schemas.dashboard import (
    DashboardStats, EstadoCount, MesActual, MesStat, TerminoStat,
)

# ── Identidad de Etiguel dentro del admin ────────────────────────────────────
# tenant_id sentinela (negativo, no choca con los tenants reales de Postgres).
ETIGUEL_TENANT_ID = -1
ETIGUEL_NOMBRE = "Etiguel"
ETIGUEL_SLUG = "etiguel"

# ── Boards y columnas (ver reference_monday_api) ─────────────────────────────
BOARD_PROSPECTS = 18411812068
BOARD_TERMINOS = 18411809211
BOARD_LEADS = 5139531112

COL_PROS_ESTADO = "color_mm32y24e"
COL_TERM_ENCONTRADOS = "numeric_mm32vqyb"
COL_TERM_INTERESADOS = "numeric_mm382tp4"
# Leads
COL_LEAD_ESTADO = "status"
COL_LEAD_ORIGEN = "men__desplegable__1"
COL_LEAD_FECHA = "date"
COL_LEAD_TEL = "tel_fono"
COL_LEAD_NOMBRE = "texto"
COL_LEAD_EMAIL = "correo_electr_nico"

# Índices de label del status de Leads que se EXCLUYEN del feed
LEAD_STATUS_EXCLUIR = [12, 14]  # 12=Cancelado, 14=Rechazado
LEAD_FECHA_DESDE = "2026-05-01"

# Mapeo de los labels de estado de Etiguel (Prospects) → vocabulario de la app
ESTADO_MAP = {
    "Sin contactar": "sin_contactar",
    "En cola contacto": "en_cola",
    "Contactado": "contactado",
    "En contacto": "en_conversacion",
    "Interesado": "interesado",
    "No le interesa": "no_le_interesa",
    "RECHAZADO": "rechazado",
    "Cancelado": "cancelado",
}

MONDAY_URL = "https://api.monday.com/v2"
_CACHE_TTL_S = 60.0
_cache: dict[str, tuple[float, object]] = {}


def enabled() -> bool:
    return bool(os.environ.get("MONDAY_API_KEY"))


def _monday(query: str) -> dict:
    token = os.environ.get("MONDAY_API_KEY", "")
    resp = requests.post(
        MONDAY_URL,
        headers={
            "Authorization": token,
            "Content-Type": "application/json",
            "API-Version": "2024-01",
        },
        json={"query": query},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data:
        raise RuntimeError(f"Monday API error: {data['errors']}")
    return data["data"]


def _cached(key: str, producer):
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < _CACHE_TTL_S:
        return hit[1]
    value = producer()
    _cache[key] = (now, value)
    return value


# ── Fetch crudo de Monday ────────────────────────────────────────────────────

def _fetch_prospects() -> list[dict]:
    """Devuelve [{estado, created_at}] de los Prospects (board chico, 1 página)."""
    q = f"""{{ boards(ids:{BOARD_PROSPECTS}){{ items_page(limit:500){{
        items {{ created_at column_values(ids:["{COL_PROS_ESTADO}"]){{ text }} }}
    }} }} }}"""
    items = _monday(q)["boards"][0]["items_page"]["items"]
    out = []
    for it in items:
        label = (it["column_values"][0]["text"] or "").strip()
        out.append({
            "estado": ESTADO_MAP.get(label, label or "sin_contactar"),
            "created_at": it.get("created_at"),
        })
    return out


def _fetch_terminos() -> list[dict]:
    q = f"""{{ boards(ids:{BOARD_TERMINOS}){{ items_page(limit:200){{
        items {{ id name column_values(ids:["{COL_TERM_ENCONTRADOS}","{COL_TERM_INTERESADOS}"]){{ id text }} }}
    }} }} }}"""
    items = _monday(q)["boards"][0]["items_page"]["items"]
    out = []
    for it in items:
        cv = {c["id"]: c["text"] for c in it["column_values"]}
        out.append({
            "termino_id": int(it["id"]),
            "termino": it["name"],
            "encontrados": int(cv.get(COL_TERM_ENCONTRADOS) or 0),
            "interesados": int(cv.get(COL_TERM_INTERESADOS) or 0),
        })
    return out


def _fetch_leads() -> list[EtiguelLead]:
    excluir = ",".join(str(i) for i in LEAD_STATUS_EXCLUIR)
    cols = f'"{COL_LEAD_ESTADO}","{COL_LEAD_ORIGEN}","{COL_LEAD_FECHA}","{COL_LEAD_TEL}","{COL_LEAD_NOMBRE}","{COL_LEAD_EMAIL}"'
    rules = (
        f'{{column_id:"{COL_LEAD_ESTADO}", compare_value:[{excluir}], operator:not_any_of}},'
        f'{{column_id:"{COL_LEAD_FECHA}", compare_value:["EXACT","{LEAD_FECHA_DESDE}"], operator:greater_than}}'
    )
    leads: list[EtiguelLead] = []
    cursor = None
    for _ in range(20):  # tope de seguridad (20 páginas)
        if cursor:
            page_q = f'next_items_page(limit:500, cursor:"{cursor}")'
            q = f"{{ {page_q} {{ cursor items {{ name column_values(ids:[{cols}]){{ id text }} }} }} }}"
            page = _monday(q)["next_items_page"]
        else:
            page_q = (
                f'items_page(limit:500, query_params:{{rules:[{rules}]}})'
            )
            q = f"{{ boards(ids:{BOARD_LEADS}){{ {page_q} {{ cursor items {{ name column_values(ids:[{cols}]){{ id text }} }} }} }} }}"
            page = _monday(q)["boards"][0]["items_page"]

        for it in page["items"]:
            cv = {c["id"]: c["text"] for c in it["column_values"]}
            leads.append(EtiguelLead(
                descripcion=it["name"],
                nombre=cv.get(COL_LEAD_NOMBRE) or None,
                estado=cv.get(COL_LEAD_ESTADO) or "",
                origen=cv.get(COL_LEAD_ORIGEN) or None,
                fecha_creacion=cv.get(COL_LEAD_FECHA) or None,
                telefono=cv.get(COL_LEAD_TEL) or None,
                email=cv.get(COL_LEAD_EMAIL) or None,
            ))
        cursor = page.get("cursor")
        if not cursor:
            break
    return leads


# ── KPIs derivados (cacheados) ───────────────────────────────────────────────

def _mes_key(created_at: str | None) -> str | None:
    if not created_at:
        return None
    try:
        return datetime.fromisoformat(created_at.replace("Z", "+00:00")).strftime("%Y-%m")
    except ValueError:
        return None


def get_resumen() -> ClienteResumen:
    def producer() -> ClienteResumen:
        prospects = _fetch_prospects()
        mes_actual = date.today().strftime("%Y-%m")
        total = len(prospects)
        en_conv = sum(1 for p in prospects if p["estado"] == "en_conversacion")
        interesados = sum(1 for p in prospects if p["estado"] == "interesado")
        interesados_mes = sum(
            1 for p in prospects
            if p["estado"] == "interesado" and _mes_key(p["created_at"]) == mes_actual
        )
        ultimo = max((p["created_at"] for p in prospects if p["created_at"]), default=None)
        ultimo_dt = None
        if ultimo:
            try:
                ultimo_dt = datetime.fromisoformat(ultimo.replace("Z", "+00:00"))
            except ValueError:
                ultimo_dt = None
        return ClienteResumen(
            tenant_id=ETIGUEL_TENANT_ID,
            nombre=ETIGUEL_NOMBRE,
            slug=ETIGUEL_SLUG,
            total_prospects=total,
            en_conversacion=en_conv,
            interesados=interesados,
            interesados_mes=interesados_mes,
            ultimo_prospect=ultimo_dt,
            fuente="etiguel",
        )
    return _cached("resumen", producer)


def get_stats() -> DashboardStats:
    def producer() -> DashboardStats:
        prospects = _fetch_prospects()
        terminos = _fetch_terminos()
        hoy_mes = date.today().strftime("%Y-%m")

        total = len(prospects)

        por_estado_d: dict[str, int] = {}
        por_estado_mes_d: dict[str, int] = {}
        meses: dict[str, dict] = {}
        for p in prospects:
            est = p["estado"]
            por_estado_d[est] = por_estado_d.get(est, 0) + 1
            mk = _mes_key(p["created_at"])
            if mk == hoy_mes:
                por_estado_mes_d[est] = por_estado_mes_d.get(est, 0) + 1
            if mk:
                m = meses.setdefault(mk, {"encontrados": 0, "interesados": 0, "no_le_interesa": 0})
                m["encontrados"] += 1
                if est == "interesado":
                    m["interesados"] += 1
                if est == "no_le_interesa":
                    m["no_le_interesa"] += 1

        mes_prospects = sum(1 for p in prospects if _mes_key(p["created_at"]) == hoy_mes)
        mes_en_conv = por_estado_mes_d.get("en_conversacion", 0)
        mes_interes = por_estado_mes_d.get("interesado", 0)

        return DashboardStats(
            total_prospects=total,
            por_estado=[EstadoCount(estado=e, count=c) for e, c in por_estado_d.items()],
            por_estado_mes=[EstadoCount(estado=e, count=c) for e, c in por_estado_mes_d.items()],
            por_termino=[
                TerminoStat(termino=t["termino"], termino_id=t["termino_id"],
                            encontrados=t["encontrados"], en_conversacion=0,
                            interesados=t["interesados"])
                for t in sorted(terminos, key=lambda x: x["encontrados"], reverse=True)[:10]
            ],
            por_mes=[MesStat(mes=m, **v) for m, v in sorted(meses.items())],
            mes_actual=MesActual(
                prospects=mes_prospects,
                en_conversacion=mes_en_conv,
                interesados=mes_interes,
                tasa_respuesta=round(mes_en_conv / mes_prospects * 100, 1) if mes_prospects else 0.0,
                tasa_conversion=round(mes_interes / mes_prospects * 100, 1) if mes_prospects else 0.0,
            ),
        )
    return _cached("stats", producer)


def get_leads() -> list[EtiguelLead]:
    return _cached("leads", _fetch_leads)
