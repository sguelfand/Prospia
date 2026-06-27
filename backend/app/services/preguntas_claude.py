"""Helpers de las preguntas de Claude Code (switch "Preguntas al cel").

El estado del switch vive en monitor_settings.preguntas_al_cel (fila única id=1),
junto al resto de la config de plataforma. Lo lee el MCP local antes de cada
pregunta y lo prende/apaga Sebi desde la app."""
import json

from app.models.pregunta_claude import PreguntaClaude
from app.models.service_health import MonitorSettings


def _settings_row(db) -> MonitorSettings:
    s = db.query(MonitorSettings).filter(MonitorSettings.id == 1).first()
    if not s:
        s = MonitorSettings(id=1, interval_seconds=300)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def preguntas_al_cel_activo(db) -> bool:
    return bool(_settings_row(db).preguntas_al_cel)


def set_preguntas_al_cel(db, activo: bool) -> bool:
    s = _settings_row(db)
    s.preguntas_al_cel = bool(activo)
    db.commit()
    return s.preguntas_al_cel


def _parse_json_list(raw: str | None) -> list:
    try:
        data = json.loads(raw or "[]")
        return data if isinstance(data, list) else []
    except (ValueError, TypeError):
        return []


def _preguntas_de(p: PreguntaClaude) -> list[dict]:
    """Lista de preguntas de la tanda. Si el registro es viejo (sin `preguntas`),
    la reconstruye desde los campos singular (compat)."""
    lst = _parse_json_list(p.preguntas)
    if lst:
        return lst
    return [{
        "header": p.header,
        "pregunta": p.pregunta,
        "opciones": _parse_json_list(p.opciones),
        "multiselect": bool(p.multiselect),
    }]


def pregunta_to_dict(p: PreguntaClaude) -> dict:
    """Serializa una PreguntaClaude al shape de PreguntaClaudeOut."""
    respuestas = _parse_json_list(p.respuestas) if p.respuestas else None
    return {
        "id": p.id,
        "preguntas": _preguntas_de(p),
        "respuestas": respuestas,
        "contexto": p.contexto,
        "estado": p.estado,
        "fecha": p.fecha,
        "fecha_respuesta": p.fecha_respuesta,
        # resumen / compat
        "header": p.header,
        "pregunta": p.pregunta,
        "elegida": p.elegida,
    }


def resumen_respuestas(preguntas: list, respuestas: list[str]) -> str:
    """Arma un resumen legible 'header/pregunta → respuesta' para la lista, el
    push y el campo `elegida` (compat)."""
    partes = []
    for i, r in enumerate(respuestas):
        q = preguntas[i] if i < len(preguntas) else {}
        etiqueta = (q.get("header") or q.get("pregunta") or f"P{i+1}") if isinstance(q, dict) else f"P{i+1}"
        partes.append(f"{etiqueta}: {r}" if len(respuestas) > 1 else str(r))
    return " · ".join(partes)
