"""Monitor de calidad de Camila en TIEMPO REAL (no esperar al batch diario).

Idea (analogía guardia de hospital): no ponemos al médico caro (Sonnet) a mirar
CADA conversación. Un filtro barato y rápido — el TRIAGE (default MiniMax por
OpenRouter) — le da un vistazo a cada charla que se aquietó y decide un semáforo:

    verde   → atención normal, no molesta a nadie
    amarillo→ algo para chequear   ┐ escala al JUEZ completo (Sonnet), que si
    rojo    → problema claro        ┘ corresponde crea una CamilaRevision + push

Así te enterás EN MINUTOS si Camila mandó algo mal, gastando centavos (el caro
solo trabaja en el ~25% sospechoso). El batch diario Sonnet queda apagado; la
red de seguridad pasa a ser la auditoría Opus que corre en sesión (a $0).

Debounce: una conversación se revisa cuando Camila habló ÚLTIMA y pasaron
DEBOUNCE_MIN de silencio (no revisar a mitad de un ida y vuelta, ni 5 veces la
misma charla). Estado por (source, mirror_id) en CamilaTriage: `last_msg_id`
marca hasta dónde ya miramos.

Modelos configurables (monitor_settings): `qa_triage_model` (filtro). El juez es
Sonnet por la API de Anthropic (reusa camila_quality). Gate: `qa_realtime_on`
(arranca APAGADO hasta validar el triage con el banco Test LLM)."""
from __future__ import annotations

import json
import re
import threading
import time

import requests
from sqlalchemy import text

TICK_SECONDS = 90          # cada cuánto barre conversaciones aquietadas
DEBOUNCE_MIN = 5           # silencio mínimo tras el último mensaje de Camila
LOOKBACK_HOURS = 12        # no mirar charlas más viejas que esto
MAX_POR_TICK = 25          # tope de triages por barrido (anti-sorpresa)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
_UA = "Prospia-QA-Realtime/1.0"


# ── config ────────────────────────────────────────────────────────────────────

def _settings():
    from app.database import SessionLocal
    from app.models.service_health import MonitorSettings
    db = SessionLocal()
    try:
        return db.query(MonitorSettings).filter(MonitorSettings.id == 1).first()
    finally:
        db.close()


def _realtime_on() -> bool:
    try:
        s = _settings()
        return bool(s and getattr(s, "qa_realtime_on", False))
    except Exception:
        return False


def _triage_model() -> str:
    try:
        s = _settings()
        m = (getattr(s, "qa_triage_model", "") or "").strip() if s else ""
        return m or "minimax/minimax-m3"
    except Exception:
        return "minimax/minimax-m3"


# ── triage (filtro barato por OpenRouter) ──────────────────────────────────────

def _negocio(source: str) -> str:
    from app.services.camila_quality import _NEGOCIO
    return _NEGOCIO.get(source, _NEGOCIO["etiguel"])


def _triage_system(source: str) -> str:
    return (
        "Sos el FILTRO RÁPIDO de calidad de Camila (una agente de IA que atiende "
        "WhatsApp por el negocio). Te paso una conversación y decidís, de un vistazo, "
        "si la ATENCIÓN de Camila amerita que un revisor humano la mire.\n\n"
        f"EL NEGOCIO:\n{_negocio(source)}\n\n"
        "Semáforo:\n"
        "- \"rojo\": hay un problema claro (info equivocada o inventada, un lead con "
        "intención que se está perdiendo/enfriando, tenía que derivar a una persona y "
        "no lo hizo, tono que aleja al cliente, Camila mandó el MISMO mensaje repetido "
        "2 o más veces, o expuso su razonamiento interno al cliente).\n"
        "- \"amarillo\": duda razonable, algo para chequear.\n"
        "- \"verde\": atención normal y correcta.\n"
        "Ante la duda entre verde y amarillo, elegí amarillo (mejor que lo confirme un "
        "humano). Una charla trivial y bien atendida es verde.\n\n"
        "Respondé SOLO un JSON (sin texto alrededor, sin ```):\n"
        '{"nivel":"verde|amarillo|rojo","motivo":"<1 frase corta>"}'
    )


def _parse_json(raw: str | None) -> dict | None:
    if not raw:
        return None
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def _triage(source: str, transcript: str) -> dict | None:
    """Llama al modelo barato (OpenRouter) → {nivel, motivo}. None si falla."""
    from app.services.test_llm_keys import provider_key
    key = provider_key("openrouter")
    if not key:
        print("[QA-REALTIME] sin key OpenRouter; triage saltado")
        return None
    model = _triage_model()
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": _triage_system(source)},
            {"role": "user", "content": transcript},
        ],
        # El triage es un semáforo simple: NO necesita razonamiento. Además, con
        # reasoning ON los modelos gastan el cupo "pensando" y devuelven content
        # vacío (bug conocido del Test LLM) → apagarlo lo hace más rápido, barato y
        # confiable. Cupo holgado por si el proveedor igual mete algo de reasoning.
        "max_tokens": 800,
        "reasoning": {"exclude": True},
    }
    # Pin del proveedor real: OpenRouter a veces rutea minimax-m3 a un proveedor que
    # IGNORA reasoning:exclude → devuelve vacío (~50-67% en pruebas). Pinneando a
    # 'minimax' los vacíos bajan a 0 y el recall queda ~10/10. (Verificado 23/7.)
    if model.startswith("minimax"):
        body["provider"] = {"order": ["minimax"], "allow_fallbacks": False}
    try:
        resp = requests.post(OPENROUTER_URL, headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": _UA,
            "HTTP-Referer": "https://prospia.app",
            "X-Title": "Prospia QA Realtime",
        }, json=body, timeout=60)
    except Exception as e:
        print(f"[QA-REALTIME] triage HTTP: {type(e).__name__}: {e}")
        return None
    if resp.status_code != 200:
        print(f"[QA-REALTIME] triage HTTP {resp.status_code}: {resp.text[:200]}")
        return None
    try:
        txt = ((resp.json().get("choices") or [{}])[0].get("message", {}) or {}).get("content") or ""
    except Exception as e:
        print(f"[QA-REALTIME] triage parse resp: {type(e).__name__}: {e}")
        return None
    data = _parse_json(txt)
    # FAIL-SAFE: el modelo respondió 200 pero sin un JSON usable (a veces devuelve
    # content vacío o cortado). En vez de dropear la conversación, escalamos al juez
    # por las dudas — mejor que Sonnet la mire a que se pierda un problema. (None se
    # reserva para fallas de red/HTTP, que sí conviene reintentar el próximo tick.)
    if not data:
        return {"nivel": "amarillo",
                "motivo": "filtro sin veredicto claro — escalado por las dudas",
                "modelo": model}
    nivel = (data.get("nivel") or "").strip().lower()
    if nivel not in ("verde", "amarillo", "rojo"):
        nivel = "amarillo"  # ante ambigüedad del filtro, mejor escalar
    return {"nivel": nivel, "motivo": (data.get("motivo") or "")[:400], "modelo": model}


# ── barrido: conversaciones aquietadas con mensajes nuevos ─────────────────────

def _candidatas(db, source: str) -> list[dict]:
    """Mirrors cuyo ÚLTIMO mensaje es de Camila ('out'), con >= DEBOUNCE_MIN de
    silencio y dentro de la ventana LOOKBACK, que tengan mensajes nuevos desde el
    último triage. Devuelve [{mirror_id, last_id}]."""
    rows = db.execute(text(
        """
        WITH ult AS (
          SELECT DISTINCT ON (mirror_id) mirror_id, id AS last_id, direccion, fecha
          FROM etiguel_mirror_mensajes
          WHERE fecha > now() - make_interval(hours => :lookback)
          ORDER BY mirror_id, id DESC
        )
        SELECT mirror_id, last_id
        FROM ult
        WHERE direccion = 'out'
          AND fecha < now() - make_interval(mins => :debounce)
        ORDER BY last_id DESC
        """
    ), {"lookback": LOOKBACK_HOURS, "debounce": DEBOUNCE_MIN}).fetchall()
    if not rows:
        return []
    from app.models.camila_triage import CamilaTriage
    ya = {t.mirror_id: t.last_msg_id for t in
          db.query(CamilaTriage).filter(CamilaTriage.source == source).all()}
    out = []
    for mirror_id, last_id in rows:
        if last_id > ya.get(mirror_id, 0):
            out.append({"mirror_id": mirror_id, "last_id": last_id})
    return out[:MAX_POR_TICK]


def _upsert_triage(db, source: str, mirror_id: int, last_id: int, tri: dict,
                   escalado: bool, genero: bool, telefono=None, nombre=None):
    from app.models.camila_triage import CamilaTriage
    row = (db.query(CamilaTriage)
           .filter(CamilaTriage.source == source, CamilaTriage.mirror_id == mirror_id)
           .first())
    if not row:
        row = CamilaTriage(source=source, mirror_id=mirror_id)
        db.add(row)
    row.last_msg_id = last_id
    row.veredicto = tri.get("nivel", "verde")
    row.motivo = tri.get("motivo", "")
    row.modelo = tri.get("modelo")
    row.escalado = escalado
    row.genero_revision = genero
    if telefono is not None:
        row.telefono = telefono
    if nombre is not None:
        row.nombre = nombre
    db.commit()


def _procesar(source: str = "etiguel") -> dict:
    """Un barrido: triage de cada conversación aquietada; escala al juez las
    amarillo/rojo. Devuelve un resumen."""
    from app.database import SessionLocal
    from app.services import camila_quality
    db = SessionLocal()
    triadas = escaladas = creadas = 0
    try:
        cands = _candidatas(db, source)
        if not cands:
            return {"source": source, "triadas": 0}
        for c in cands:
            mirror_id, last_id = c["mirror_id"], c["last_id"]
            conv = camila_quality._transcript_de_mirror(db, mirror_id)
            if not conv:
                # Marcar como visto para no reintentarlo en loop.
                _upsert_triage(db, source, mirror_id, last_id,
                               {"nivel": "verde", "motivo": "sin_transcript"}, False, False)
                continue
            tri = _triage(source, conv["transcript"])
            triadas += 1
            if not tri:
                # No pudimos triagear (falla del filtro): NO avanzamos last_msg_id
                # para reintentar el próximo tick.
                continue
            nivel = tri["nivel"]
            escala = nivel in ("amarillo", "rojo")
            genero = False
            if escala:
                escaladas += 1
                try:
                    res = camila_quality.revisar_mirror_ahora(source, mirror_id, notify=True)
                    genero = bool(res.get("creada"))
                    if genero:
                        creadas += 1
                except Exception as e:
                    print(f"[QA-REALTIME] juez mirror {mirror_id}: {type(e).__name__}: {e}")
            _upsert_triage(db, source, mirror_id, last_id, tri, escala, genero,
                           telefono=conv.get("telefono"), nombre=conv.get("nombre"))
    finally:
        db.close()
    if triadas:
        print(f"[QA-REALTIME] {source}: triadas={triadas} escaladas={escaladas} creadas={creadas}")
    return {"source": source, "triadas": triadas, "escaladas": escaladas, "creadas": creadas}


def start():
    def loop():
        time.sleep(200)  # esperar a que el backend levante (después de camila_quality)
        while True:
            try:
                if _realtime_on():
                    _procesar("etiguel")
            except Exception as e:
                print(f"[QA-REALTIME] loop: {type(e).__name__}: {e}")
            time.sleep(TICK_SECONDS)

    threading.Thread(target=loop, daemon=True, name="camila-realtime").start()
