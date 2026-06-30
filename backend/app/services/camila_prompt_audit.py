"""Nivel 2 — auditoría del prompt COMPLETO de Camila.

A pedido (botón), una IA lee TODO el prompt de Camila y reporta: reglas duplicadas/
redundantes, contradicciones (incluida la sección de aprendizajes vs. el prompt base),
cosas obsoletas y mejoras de estructura. Complementa la consolidación (que solo mantiene
prolijo el bloque de aprendizajes): acá se mira el prompt entero para que, al acumular
reglas, nada se pise ni quede desordenado. Conviene correrla ~1×/semana.

Corre con la key propia de monitor_settings (igual que el especialista), modelo sonnet.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.camila_quality import _post, _parse_json

_BA = timezone(timedelta(hours=-3))
DIAS_RECOMENDADO = 7   # cada cuánto se recomienda re-auditar


def _system() -> str:
    return (
        "Sos un auditor del prompt de un agente de WhatsApp (Camila). Te paso el PROMPT "
        "COMPLETO actual (incluye flujos, reglas, FAQ y una sección de 'Aprendizajes del "
        "negocio' que se va llenando con correcciones). Tu trabajo es revisar la SALUD del "
        "prompt como un todo y detectar problemas de mantenimiento:\n"
        "- DUPLICACIONES: la misma regla dicha más de una vez (o una lección que repite algo "
        "que ya estaba en el prompt base).\n"
        "- CONTRADICCIONES: reglas que se pisan o se oponen entre sí.\n"
        "- OBSOLETO: cosas que parecen viejas, sin sentido o que sobran.\n"
        "- ESTRUCTURA: oportunidades de reordenar/agrupar para que se siga mejor.\n"
        "Sé concreto: citá la parte textual o el tema. Si está todo sano, decílo claro.\n\n"
        "Respondé SOLO un JSON válido (sin ``` ni texto alrededor):\n"
        '{"resumen": "<1 frase: estado general>", '
        '"hallazgos": [{"tipo": "duplicacion|contradiccion|obsoleto|estructura", '
        '"detalle": "<qué y dónde, concreto>", "sugerencia": "<qué hacer>"}]}'
    )


def _md(resumen: str, hallazgos: list[dict]) -> str:
    if not hallazgos:
        return f"{resumen}\n\n✅ Sin problemas de mantenimiento detectados."
    emo = {"duplicacion": "🔁", "contradiccion": "⚠️", "obsoleto": "🗑️", "estructura": "🧱"}
    out = [resumen, ""]
    for h in hallazgos:
        tipo = (h.get("tipo") or "").strip()
        out.append(f"{emo.get(tipo, '•')} **{tipo or 'hallazgo'}** — {h.get('detalle', '').strip()}")
        sug = (h.get("sugerencia") or "").strip()
        if sug:
            out.append(f"   ↳ {sug}")
    return "\n".join(out)


def auditar(source: str = "etiguel") -> dict:
    """Corre la auditoría del prompt completo y guarda el resultado. Devuelve el estado."""
    from app.services.camila_aprendizaje import _leer_prompt
    from app.database import SessionLocal
    from app.models.camila_revision import CamilaPromptAudit
    try:
        _, prompt, _ = _leer_prompt(source)
    except Exception as e:
        return {"ok": False, "motivo": "no_pude_leer_prompt", "error": f"{type(e).__name__}: {e}"}
    if not (prompt or "").strip():
        return {"ok": False, "motivo": "prompt_vacio"}

    # timeout largo: el prompt completo es grande y genera bastante → la IA tarda.
    raw = _post(_system(), f"PROMPT COMPLETO DE CAMILA:\n\n{prompt}",
                max_tokens=1600, timeout=120, funcion="Auditoría prompt Camila")
    data = _parse_json(raw)
    if data is None:
        if not raw:
            return {"ok": False, "motivo": "ia_no_disponible"}
        resumen, hallazgos, reporte = "Auditoría (texto libre)", [], raw.strip()
    else:
        resumen = (data.get("resumen") or "Auditoría completada").strip()
        hallazgos = data.get("hallazgos") or []
        reporte = _md(resumen, hallazgos)

    import json
    db = SessionLocal()
    try:
        row = CamilaPromptAudit(source=source, resumen=resumen[:1000],
                                reporte=reporte[:20000],
                                hallazgos=json.dumps(hallazgos, ensure_ascii=False)[:40000],
                                n_hallazgos=len(hallazgos))
        db.add(row)
        db.commit()
        db.refresh(row)
        return {"ok": True, **_estado_from(row)}
    finally:
        db.close()


def _estado_from(row) -> dict:
    import json
    try:
        hallazgos = json.loads(getattr(row, "hallazgos", None) or "[]")
    except Exception:
        hallazgos = []
    return {
        "source": row.source, "ultima_at": row.created_at.isoformat() if row.created_at else None,
        "resumen": row.resumen, "reporte": row.reporte, "hallazgos": hallazgos,
        "n_hallazgos": row.n_hallazgos,
    }


def estado(source: str = "etiguel") -> dict:
    """Última auditoría + si conviene re-correr (pasó DIAS_RECOMENDADO o nunca se hizo)."""
    from app.database import SessionLocal
    from app.models.camila_revision import CamilaPromptAudit
    db = SessionLocal()
    try:
        row = (db.query(CamilaPromptAudit)
               .filter(CamilaPromptAudit.source == source)
               .order_by(CamilaPromptAudit.created_at.desc()).first())
        if not row:
            return {"source": source, "ultima_at": None, "dias_desde": None,
                    "recomendar": True, "dias_recomendado": DIAS_RECOMENDADO,
                    "resumen": None, "reporte": None, "n_hallazgos": 0}
        ahora = datetime.now(timezone.utc)
        dias = (ahora - row.created_at).days if row.created_at else None
        return {**_estado_from(row), "dias_desde": dias,
                "dias_recomendado": DIAS_RECOMENDADO,
                "recomendar": dias is None or dias >= DIAS_RECOMENDADO}
    finally:
        db.close()


def correr_auto(source: str = "etiguel") -> None:
    """Corre la auditoría AUTOMÁTICAMENTE si pasó >= DIAS_RECOMENDADO desde la última
    (o nunca se hizo). Se llama desde el loop diario de camila_quality. Como cuesta
    centavos, se hace sola; solo manda push si encontró hallazgos (si da limpio, corre
    callada y solo actualiza la fecha visible en la pantalla)."""
    if not estado(source).get("recomendar"):
        return  # corrió hace < 1 semana
    res = auditar(source)
    if not res.get("ok"):
        return  # IA caída / no se pudo leer → reintenta mañana
    n = res.get("n_hallazgos") or 0
    if n <= 0:
        return  # sin problemas → sin push (no molestar)
    try:
        from app.services import push
        push.notificar_global(
            "calidad_revision",
            "🧱 Auditoría del prompt de Camila",
            f"La auditoría semanal encontró {n} cosa(s) para revisar en el prompt. Entrá a Calidad.",
            {"tipo": "calidad", "source": source, "nav": "calidad"},
        )
    except Exception as e:
        print(f"[CAMILA-PROMPT-AUDIT] push auditoría: {type(e).__name__}: {e}")
