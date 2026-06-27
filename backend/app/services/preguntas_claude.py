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


def _parse_opciones(raw: str | None) -> list[dict]:
    try:
        data = json.loads(raw or "[]")
        return data if isinstance(data, list) else []
    except (ValueError, TypeError):
        return []


def pregunta_to_dict(p: PreguntaClaude) -> dict:
    """Serializa una PreguntaClaude al shape de PreguntaClaudeOut (opciones como
    lista de dicts, no el TEXT crudo de la DB)."""
    return {
        "id": p.id,
        "header": p.header,
        "pregunta": p.pregunta,
        "opciones": _parse_opciones(p.opciones),
        "multiselect": p.multiselect,
        "contexto": p.contexto,
        "elegida": p.elegida,
        "estado": p.estado,
        "fecha": p.fecha,
        "fecha_respuesta": p.fecha_respuesta,
    }
