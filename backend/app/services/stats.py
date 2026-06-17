"""Cálculo de estadísticas de un tenant. Reutilizado por el dashboard
por-cliente (routers/dashboard.py) y por la capa admin cross-tenant
(routers/admin.py). Toda la lógica recibe el tenant_id como parámetro
para no quedar atada al usuario logueado."""
from datetime import date

from sqlalchemy import case, extract, func
from sqlalchemy.orm import Session

from app.models.prospect import Prospect
from app.models.termino import Termino
from app.schemas.dashboard import (
    DashboardStats, EstadoCount, MesActual, MesStat, TerminoStat,
)


def compute_stats(db: Session, tid: int) -> DashboardStats:
    hoy = date.today()

    # ── Totales ──────────────────────────────────────────────────────────────
    total = db.query(func.count(Prospect.id)).filter(Prospect.tenant_id == tid).scalar() or 0

    # ── Distribución total por estado ─────────────────────────────────────────
    por_estado = [
        EstadoCount(estado=e, count=c)
        for e, c in (
            db.query(Prospect.estado, func.count(Prospect.id))
            .filter(Prospect.tenant_id == tid)
            .group_by(Prospect.estado)
            .all()
        )
    ]

    # ── Mes actual ───────────────────────────────────────────────────────────
    mes_filter = [
        Prospect.tenant_id == tid,
        extract("year",  Prospect.created_at) == hoy.year,
        extract("month", Prospect.created_at) == hoy.month,
    ]

    mes_prospects      = db.query(func.count(Prospect.id)).filter(*mes_filter).scalar() or 0
    mes_en_conversacion = (
        db.query(func.count(Prospect.id))
        .filter(*mes_filter, Prospect.estado == "en_conversacion")
        .scalar() or 0
    )
    mes_interesados = (
        db.query(func.count(Prospect.id))
        .filter(*mes_filter, Prospect.estado == "interesado")
        .scalar() or 0
    )
    mes_actual = MesActual(
        prospects=mes_prospects,
        en_conversacion=mes_en_conversacion,
        interesados=mes_interesados,
        tasa_respuesta=round(mes_en_conversacion / mes_prospects * 100, 1) if mes_prospects else 0.0,
        tasa_conversion=round(mes_interesados    / mes_prospects * 100, 1) if mes_prospects else 0.0,
    )

    # ── Distribución por estado — solo este mes ───────────────────────────────
    por_estado_mes = [
        EstadoCount(estado=e, count=c)
        for e, c in (
            db.query(Prospect.estado, func.count(Prospect.id))
            .filter(*mes_filter)
            .group_by(Prospect.estado)
            .all()
        )
    ]

    # ── Por término: encontrados, en_conversacion, interesados ────────────────
    termino_rows = (
        db.query(
            Termino.texto,
            func.count(Prospect.id).label("encontrados"),
            func.sum(case((Prospect.estado == "en_conversacion", 1), else_=0)).label("en_conversacion"),
            func.sum(case((Prospect.estado == "interesado",      1), else_=0)).label("interesados"),
        )
        .outerjoin(Prospect, (Prospect.termino_id == Termino.id) & (Prospect.tenant_id == tid))
        .filter(Termino.tenant_id == tid)
        .group_by(Termino.id, Termino.texto)
        .order_by(func.count(Prospect.id).desc())
        .limit(10)
        .all()
    )
    por_termino = [
        TerminoStat(termino=t, encontrados=e or 0, en_conversacion=c or 0, interesados=i or 0)
        for t, e, c, i in termino_rows
    ]

    # ── Evolución mensual: encontrados, interesados, no_le_interesa ───────────
    meses: dict[str, dict] = {}

    for mes, cnt in (
        db.query(
            func.to_char(Prospect.created_at, "YYYY-MM").label("mes"),
            func.count(Prospect.id),
        )
        .filter(Prospect.tenant_id == tid)
        .group_by("mes")
        .all()
    ):
        meses.setdefault(mes, {"encontrados": 0, "interesados": 0, "no_le_interesa": 0})["encontrados"] = cnt

    for mes, cnt in (
        db.query(
            func.to_char(Prospect.created_at, "YYYY-MM").label("mes"),
            func.count(Prospect.id),
        )
        .filter(Prospect.tenant_id == tid, Prospect.estado == "interesado")
        .group_by("mes")
        .all()
    ):
        meses.setdefault(mes, {"encontrados": 0, "interesados": 0, "no_le_interesa": 0})["interesados"] = cnt

    for mes, cnt in (
        db.query(
            func.to_char(Prospect.created_at, "YYYY-MM").label("mes"),
            func.count(Prospect.id),
        )
        .filter(Prospect.tenant_id == tid, Prospect.estado == "no_le_interesa")
        .group_by("mes")
        .all()
    ):
        meses.setdefault(mes, {"encontrados": 0, "interesados": 0, "no_le_interesa": 0})["no_le_interesa"] = cnt

    por_mes = [
        MesStat(mes=m, **v)
        for m, v in sorted(meses.items())
    ]

    return DashboardStats(
        total_prospects=total,
        por_estado=por_estado,
        por_estado_mes=por_estado_mes,
        por_termino=por_termino,
        por_mes=por_mes,
        mes_actual=mes_actual,
    )
