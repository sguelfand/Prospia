"""Test LLM — servicio del banco de pruebas de motores para el rol de Camila.

Piezas:
- _build_envelope(source): reconstruye el "sobre" de OpenClaw desde el filesystem vivo
  (systemPromptOverride del agente + archivos del workspace: SOUL/IDENTITY/USER/AGENTS/
  TOOLS + sublimacion/etiquetas/blacklist) → el system prompt que ve el modelo. El mismo
  sobre para todos los motores ⇒ comparación justa. La fidelidad vs OpenClaw real se mide
  aparte con el golden set (la base harness interna de OpenClaw no es 100% reconstruible).
- estimar(...): calcula el costo ANTES de correr (heurística de tokens × rate-card por motor).
- correr(...): GATED. Solo corre si monitor_settings.test_llm_habilitado = true (Sebi lo
  prende cuando da el OK). Llama a los motores por API OpenAI-compatible (OpenRouter/MyClaw),
  registra transcript + tool_calls + tokens, y juzga con el Especialista de Negocio.

NO consume tokens al importar ni al estimar. Solo `correr` gasta, y está bloqueado por default.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import requests

from app.services.camila_audit import SOURCES, _fs_read

_UA = "Mozilla/5.0 (compatible; Prospia-TestLLM/1.0)"
_WORKSPACE = {  # archivos del sobre por source
    "etiguel": {
        "ws": ".openclaw/workspace-etiguel",
        "agente": "etiguel",
        "files": ["SOUL.md", "IDENTITY.md", "USER.md", "AGENTS.md", "TOOLS.md",
                  "sublimacion.md", "etiquetas.md", "blacklist.md"],
    },
}

# Herramientas de Camila expuestas como tools OpenAI-compatible: así el motor "decide"
# llamándolas y registramos la decisión sin ejecutar nada real.
CAMILA_TOOLS = [
    {"type": "function", "function": {
        "name": "interesado",
        "description": "El cliente mostró interés real (producto+cantidad, pide cotización formal o visita). Deriva a Delfina.",
        "parameters": {"type": "object", "properties": {"motivo": {"type": "string"}}, "required": []}}},
    {"type": "function", "function": {
        "name": "no_interesa",
        "description": "El cliente rechazó claramente (ya tiene proveedor, no fabrica, tiene capacidad propia, pide no insistir).",
        "parameters": {"type": "object", "properties": {"motivo": {"type": "string"}}, "required": []}}},
    {"type": "function", "function": {
        "name": "redireccionar",
        "description": "El contacto dice que hable con otra persona/número. Pasa el contacto correcto.",
        "parameters": {"type": "object", "properties": {"numero": {"type": "string"}, "nombre": {"type": "string"}}, "required": []}}},
    {"type": "function", "function": {
        "name": "agendar_contacto",
        "description": "El cliente pide ser contactado en una fecha futura ('hablame en 2 semanas').",
        "parameters": {"type": "object", "properties": {"fecha": {"type": "string", "description": "YYYY-MM-DD"}}, "required": ["fecha"]}}},
    {"type": "function", "function": {
        "name": "escalar_consulta",
        "description": "Camila NO sabe la respuesta con certeza (precio/material/condición que no conoce). Escala a Sebi en vez de inventar.",
        "parameters": {"type": "object", "properties": {"pregunta": {"type": "string"}}, "required": ["pregunta"]}}},
]

_envelope_cache: dict[str, tuple[float, dict]] = {}
_ENVELOPE_TTL = 600  # 10 min


# ── sobre (envelope) ──────────────────────────────────────────────────────────

def _build_envelope(source: str = "etiguel", force: bool = False) -> dict:
    """Lee el sobre vivo por /fs y arma el system prompt. Cacheado 10 min."""
    now = time.time()
    if not force and source in _envelope_cache:
        ts, env = _envelope_cache[source]
        if now - ts < _ENVELOPE_TTL:
            return env
    if source not in SOURCES or source not in _WORKSPACE:
        raise ValueError(f"source sin sobre configurado: {source}")
    base = SOURCES[source]["base"]
    token = SOURCES[source]["token_fn"]()
    if not token:
        raise RuntimeError("sin deploy token para leer el sobre")
    conf = _WORKSPACE[source]

    # 1) systemPromptOverride del agente desde openclaw.json
    raw = _fs_read(base, token, ".openclaw/openclaw.json")
    cfg = json.loads(raw["content"]) if isinstance(raw, dict) and "content" in raw else raw
    override = ""
    modelo_actual = None
    ag = cfg.get("agents", {})
    modelo_actual = (ag.get("defaults", {}).get("model", {}) or {}).get("primary")
    for a in ag.get("list", []):
        if a.get("id") == conf["agente"]:
            override = a.get("systemPromptOverride", "") or ""
            if a.get("model", {}).get("primary"):
                modelo_actual = a["model"]["primary"]
            break

    # 2) archivos del workspace (SOUL, IDENTITY, sublimacion, etc.)
    files: dict[str, str] = {}
    for fn in conf["files"]:
        try:
            r = _fs_read(base, token, f"{conf['ws']}/{fn}", max_bytes=200_000)
            files[fn] = r.get("content", "") if isinstance(r, dict) else str(r)
        except Exception as e:
            files[fn] = f"[no se pudo leer {fn}: {type(e).__name__}]"

    # 3) armado del system prompt (mismo orden conceptual que el agente al arrancar)
    partes = [
        "# Contexto de identidad y alma del agente\n" + files.get("SOUL.md", ""),
        "\n\n# Identidad\n" + files.get("IDENTITY.md", ""),
        "\n\n# Usuario / empresa\n" + files.get("USER.md", ""),
        "\n\n# Instrucciones de comportamiento (systemPromptOverride)\n" + override,
        "\n\n# Herramientas disponibles\n" + files.get("TOOLS.md", ""),
        "\n\n# Precios de sublimación (workspace)\n" + files.get("sublimacion.md", ""),
        "\n\n# Precios de etiquetas (workspace)\n" + files.get("etiquetas.md", ""),
        "\n\n# Lista negra\n" + files.get("blacklist.md", ""),
        ("\n\n# Nota para esta prueba\nEstás siendo evaluada en un banco de pruebas. "
         "Respondé como lo harías en WhatsApp con un cliente real. Cuando corresponda tomar "
         "una decisión de negocio (derivar, marcar no interesa, escalar, agendar, redireccionar), "
         "usá la herramienta correspondiente EN VEZ de describirla."),
    ]
    system = "".join(partes)
    env = {"source": source, "system": system, "modelo_actual": modelo_actual,
           "archivos": list(files.keys()), "chars": len(system),
           "generado_at": datetime.now(timezone.utc).isoformat()}
    _envelope_cache[source] = (now, env)
    return env


def envelope_info(source: str = "etiguel") -> dict:
    """Metadatos del sobre (sin el prompt entero) para mostrar en la UI."""
    env = _build_envelope(source)
    return {k: v for k, v in env.items() if k != "system"} | {"system_chars": env["chars"]}


# ── estimación de costo (antes de correr) ─────────────────────────────────────

def _tok(txt: str) -> int:
    """Estimación de tokens (heurística ~4 chars/token). Suficiente para el pre-cálculo."""
    return max(1, len(txt or "") // 4)


OUT_POR_TURNO = 200  # tokens de salida estimados por respuesta de Camila


def _costo_para_prices(sys_tok: int, guion_tok: int, total_turnos: int, n_esc: int,
                       pin: float, pout: float, pcr: float, pcw: float,
                       con_cache: bool = True) -> float:
    """Costo estimado (USD) de correr n_esc escenarios (total_turnos turnos) con un
    system prompt de sys_tok tokens, dada la rate-card por token de UN motor."""
    if con_cache and pcr > 0:
        input_full = sys_tok * n_esc                            # 1er turno de c/escenario: cache-write
        input_cached = sys_tok * max(0, total_turnos - n_esc)   # resto: cache-read
        costo_in = input_full * pcw + input_cached * pcr
    else:
        costo_in = sys_tok * total_turnos * pin
    costo_in += guion_tok * pin
    costo_out = total_turnos * OUT_POR_TURNO * pout
    return costo_in + costo_out


def _turnos_de(escs) -> tuple[int, int]:
    """(total_turnos, guion_tok) de una lista de escenarios."""
    total_turnos = 0
    guion_tok = 0
    for e in escs:
        try:
            total_turnos += max(1, len(json.loads(e.guion or "[]")))
        except Exception:
            total_turnos += 1
        guion_tok += _tok(e.guion)
    return total_turnos, guion_tok


def estimar(source: str, motor_ids: list[int], escenario_ids: list[int],
            con_cache: bool = True) -> dict:
    """Costo estimado ANTES de correr. Conservador. Devuelve total + desglose por motor.
    con_cache=True modela el descuento de prompt-cache (system prompt cacheado entre
    escenarios del mismo motor); False = sin descuento (tope)."""
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmEscenario, TestLlmMotor
    env = _build_envelope(source)
    sys_tok = _tok(env["system"])
    db = SessionLocal()
    try:
        motores = db.query(TestLlmMotor).filter(TestLlmMotor.id.in_(motor_ids)).all()
        escs = db.query(TestLlmEscenario).filter(TestLlmEscenario.id.in_(escenario_ids)).all()
    finally:
        db.close()
    por_motor = []
    total_turnos, guion_tok = _turnos_de(escs)
    n_esc = len(escs)
    # costo por bolsillo: quién factura cada cosa (openrouter / myclaw / anthropic-juez)
    por_proveedor: dict[str, float] = {}
    for m in motores:
        c = _costo_para_prices(sys_tok, guion_tok, total_turnos, n_esc,
                               m.precio_in, m.precio_out, m.precio_cache_read,
                               m.precio_cache_write, con_cache)
        prov = (m.provider or "otro").lower()
        por_motor.append({"motor_id": m.id, "nombre": m.nombre,
                          "provider": prov, "costo_usd": round(c, 4)})
        por_proveedor[prov] = por_proveedor.get(prov, 0.0) + c
    # juez (Especialista de Negocio): 1 llamada por (motor × escenario), Anthropic DIRECTO
    # (no OpenRouter ni MyClaw). Input ≈ contexto de negocio + calibración + transcript.
    juez_calls = len(motores) * len(escs)
    juez_in = juez_calls * 2000
    juez_out = juez_calls * 300
    juez_costo = juez_in * 3.0e-6 + juez_out * 15.0e-6   # Sonnet 4.6 tarifa oficial Anthropic
    por_proveedor["anthropic (juez)"] = juez_costo
    total = sum(por_proveedor.values())
    return {
        "source": source, "motores": len(motores), "escenarios": len(escs),
        "turnos_totales": total_turnos, "system_tokens": sys_tok,
        "con_cache": con_cache,
        "por_motor": por_motor,
        "por_proveedor": {k: round(v, 4) for k, v in por_proveedor.items()},
        "costo_openrouter_usd": round(por_proveedor.get("openrouter", 0.0), 4),
        "juez_costo_usd": round(juez_costo, 4),
        "total_usd": round(total, 4),                              # con juez automático (API)
        "total_sin_juez_usd": round(total - juez_costo, 4),        # juez lo aplicás en sesión (plan Pro)
        "nota": "Estimación conservadora. OpenRouter, MyClaw y el juez (Anthropic) se facturan por separado.",
    }


# ── correr (GATED) ────────────────────────────────────────────────────────────

def _habilitado() -> bool:
    """Gate: correr solo si Sebi prendió el switch (después de revisar la estructura)."""
    try:
        from app.database import SessionLocal
        from app.models.service_health import MonitorSettings
        db = SessionLocal()
        try:
            s = db.query(MonitorSettings).filter(MonitorSettings.id == 1).first()
            return bool(getattr(s, "test_llm_habilitado", False))
        finally:
            db.close()
    except Exception:
        return False


def _call_model(motor, system: str, messages: list[dict], timeout: int = 90) -> dict:
    """Una llamada OpenAI-compatible (chat/completions). Devuelve texto + tool_calls + usage."""
    from app.services.test_llm_keys import provider_key
    key = (motor.api_key or "").strip() or provider_key(motor.provider)
    url = motor.base_url.rstrip("/") + "/chat/completions"
    body = {
        "model": motor.model_id,
        "messages": [{"role": "system", "content": system}] + messages,
        "tools": CAMILA_TOOLS,
        "max_tokens": 700,
    }
    t0 = time.time()
    resp = requests.post(url, headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "User-Agent": _UA,
        "HTTP-Referer": "https://prospia.app",
        "X-Title": "Prospia Test LLM",
    }, json=body, timeout=timeout)
    ms = int((time.time() - t0) * 1000)
    resp.raise_for_status()
    data = resp.json()
    choice = (data.get("choices") or [{}])[0].get("message", {})
    usage = data.get("usage", {}) or {}
    return {
        "text": choice.get("content") or "",
        "tool_calls": choice.get("tool_calls") or [],
        "in": usage.get("prompt_tokens", 0),
        "out": usage.get("completion_tokens", 0),
        "cache_read": (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0),
        "ms": ms,
    }


def _run_escenario(motor, system: str, escenario) -> dict:
    """Corre un escenario: cada turno del guion → respuesta del motor. Junta transcript,
    tool_calls, tokens, latencia."""
    guion = json.loads(escenario.guion or "[]")
    transcript, tool_calls = [], []
    tin = tout = tcache = 0
    ms = 0
    messages: list[dict] = []
    for turno in guion:
        messages.append({"role": "user", "content": turno})
        transcript.append({"quien": "Cliente", "texto": turno})
        r = _call_model(motor, system, messages)
        tin += r["in"]; tout += r["out"]; tcache += r["cache_read"]; ms += r["ms"]
        asst = {"role": "assistant", "content": r["text"]}
        if r["tool_calls"]:
            asst["tool_calls"] = r["tool_calls"]
            for tc in r["tool_calls"]:
                fn = (tc.get("function") or {})
                tool_calls.append({"nombre": fn.get("name"), "args": fn.get("arguments")})
            # cerrar el ciclo de tool para poder seguir la conversación
            messages.append(asst)
            for tc in r["tool_calls"]:
                messages.append({"role": "tool", "tool_call_id": tc.get("id", ""),
                                 "content": "ok (simulado)"})
        else:
            messages.append(asst)
        transcript.append({"quien": "Camila", "texto": r["text"],
                           "tools": [t.get("nombre") for t in tool_calls] if r["tool_calls"] else []})
    return {"transcript": transcript, "tool_calls": tool_calls,
            "in": tin, "out": tout, "cache": tcache, "ms": ms}


def _costo_celda(motor, tin: int, tout: int, tcache: int) -> float:
    treal_in = max(0, tin - tcache)
    return (treal_in * motor.precio_in + tcache * motor.precio_cache_read
            + tout * motor.precio_out)


def _calibracion(source: str) -> str:
    """Bloque de calibración del Especialista (confirmaciones acierto/falso_positivo de
    Sebi). Es el MISMO que usa el especialista vivo → el juez del test juzga con tu criterio
    acumulado, no 'de fábrica'. Se calcula 1 vez por corrida."""
    from app.database import SessionLocal
    from app.services.camila_quality import _ejemplos_calibracion
    db = SessionLocal()
    try:
        return _ejemplos_calibracion(db, source)
    except Exception:
        return ""
    finally:
        db.close()


def _juzgar(escenario, transcript: list[dict], tool_calls: list[dict],
            calibracion: str = "") -> dict:
    """Especialista de Negocio juzga la respuesta del motor. Devuelve
    {veredicto: bien|mal|dudoso, categoria, detalle}. `calibracion` = el feedback real de
    Sebi (mismo bloque que el especialista vivo) para juzgar con su criterio."""
    from app.services.camila_quality import _NEGOCIO, _parse_json, _post, CATEGORIAS
    negocio = _NEGOCIO["etiguel"]
    cats = "\n".join(f"- {k}: {v}" for k, v in CATEGORIAS.items())
    esperado = escenario.esperado or "{}"
    convo = "\n".join(f"[{t['quien']}] {t['texto']}" for t in transcript)
    tools_txt = ", ".join(f"{t['nombre']}({t.get('args')})" for t in tool_calls) or "(ninguna)"
    system = (
        f"Sos un especialista de negocio que evalúa a la agente de WhatsApp de un negocio.\n{negocio}\n\n"
        f"Estás evaluando cómo respondió un MOTOR candidato en un escenario de prueba controlado. "
        f"Juzgá SOLO la calidad de negocio de la respuesta (no la infra).\n\n"
        f"Categorías de problema posibles:\n{cats}\n"
        f"{calibracion}\n\n"
        "Respondé SOLO un JSON: {\"veredicto\": \"bien\"|\"mal\"|\"dudoso\", "
        "\"categoria\": \"<una de las categorías o vacío si está bien>\", "
        "\"detalle\": \"1-2 oraciones de por qué\"}."
    )
    user = (
        f"ESCENARIO: {escenario.nombre}\nCASO DE USO: {escenario.caso_uso}\n"
        f"COMPORTAMIENTO ESPERADO: {esperado}\n\n"
        f"HERRAMIENTAS QUE USÓ EL MOTOR: {tools_txt}\n\n"
        f"CONVERSACIÓN:\n{convo}\n\n"
        "¿Estuvo bien o mal para el negocio? Considerá si tomó la decisión correcta "
        "(derivar/no interesa/escalar/etc.), si cotizó bien, el tono y si no perdió el lead."
    )
    raw = _post(system, user, max_tokens=500, funcion="Test LLM (juez)")
    j = _parse_json(raw) or {}
    ver = (j.get("veredicto") or "dudoso").strip().lower()
    if ver not in ("bien", "mal", "dudoso"):
        ver = "dudoso"
    return {"veredicto": ver, "categoria": (j.get("categoria") or "")[:40],
            "detalle": (j.get("detalle") or "")[:2000]}


def lanzar(corrida_id: int, juzgar: bool = False) -> dict:
    """Lanza la corrida en un thread y devuelve al toque (estado 'corriendo'), así la
    UI puede hacer polling y mostrar el progreso en vivo. GATED igual que correr.
    juzgar=False (default) → corre solo motores; el juez lo aplica después una sesión de
    Claude con el plan Pro. juzgar=True → juez automático por la API (Sonnet)."""
    if not _habilitado():
        return {"ok": False, "bloqueado": True,
                "detalle": "Test LLM está deshabilitado. Prendé el switch cuando quieras correr (consume tokens)."}
    import threading

    def _run():
        try:
            correr(corrida_id, juzgar=juzgar)
        except Exception as e:
            from app.database import SessionLocal
            from app.models.test_llm import TestLlmCorrida
            db = SessionLocal()
            try:
                c = db.get(TestLlmCorrida, corrida_id)
                if c:
                    c.estado = "error"
                    c.error = f"{type(e).__name__}: {e}"
                    db.commit()
            finally:
                db.close()

    threading.Thread(target=_run, daemon=True).start()
    return {"ok": True, "estado": "corriendo", "corrida_id": corrida_id}


def correr(corrida_id: int, juzgar: bool = True) -> dict:
    """Ejecuta una corrida ya creada (estado 'estimada'). GATED por _habilitado().
    Corre sincrónico; para la UI se llama vía lanzar() (en thread).
    juzgar=False → corre solo los motores y deja los veredictos 'pendiente' (estado
    'sin_juzgar'), para juzgar después en una sesión de Claude con el plan Pro (gratis)."""
    if not _habilitado():
        return {"ok": False, "bloqueado": True,
                "detalle": "Test LLM está deshabilitado. Prendé el switch cuando quieras correr (consume tokens)."}
    from types import SimpleNamespace

    from app.database import SessionLocal
    from app.models.test_llm import (TestLlmCorrida, TestLlmEscenario,
                                      TestLlmMotor, TestLlmResultado)
    db = SessionLocal()
    try:
        cor = db.get(TestLlmCorrida, corrida_id)
        if not cor:
            return {"ok": False, "detalle": "corrida no encontrada"}
        motor_ids = json.loads(cor.motores or "[]")
        esc_ids = json.loads(cor.escenarios or "[]")
        # Copiar a objetos livianos ANTES del commit/close: el commit expira las
        # instancias ORM y usarlas fuera de la sesión da DetachedInstanceError.
        motores = [SimpleNamespace(
            id=m.id, nombre=m.nombre, provider=m.provider, model_id=m.model_id,
            base_url=m.base_url, api_key=m.api_key, precio_in=m.precio_in,
            precio_out=m.precio_out, precio_cache_read=m.precio_cache_read,
            precio_cache_write=m.precio_cache_write)
            for m in db.query(TestLlmMotor).filter(TestLlmMotor.id.in_(motor_ids)).all()]
        escs = [SimpleNamespace(
            id=e.id, slug=e.slug, nombre=e.nombre, caso_uso=e.caso_uso,
            guion=e.guion, esperado=e.esperado, orden=e.orden)
            for e in db.query(TestLlmEscenario).filter(TestLlmEscenario.id.in_(esc_ids))
                       .order_by(TestLlmEscenario.orden).all()]
        src = cor.source
        env = _build_envelope(src)
        system = env["system"]
        cor.estado = "corriendo"
        db.commit()
    finally:
        db.close()

    # calibración del Especialista (feedback real de Sebi) — 1 vez por corrida
    calib = _calibracion(src) if juzgar else ""

    for motor in motores:
        for esc in escs:
            # Reanudación: si la celda ya existe (corrida cortada y relanzada), saltear.
            db = SessionLocal()
            try:
                ya = db.query(TestLlmResultado).filter(
                    TestLlmResultado.corrida_id == corrida_id,
                    TestLlmResultado.motor_id == motor.id,
                    TestLlmResultado.escenario_slug == esc.slug).first() is not None
            finally:
                db.close()
            if ya:
                continue
            db = SessionLocal()
            try:
                try:
                    r = _run_escenario(motor, system, esc)
                    costo = _costo_celda(motor, r["in"], r["out"], r["cache"])
                    veredicto = (_juzgar(esc, r["transcript"], r["tool_calls"], calib)
                                 if juzgar else {"veredicto": "pendiente", "categoria": "", "detalle": ""})
                    err = None
                except Exception as e:
                    r = {"transcript": [], "tool_calls": [], "in": 0, "out": 0, "cache": 0, "ms": 0}
                    costo = 0.0
                    veredicto = {"veredicto": "dudoso", "categoria": "", "detalle": ""}
                    err = f"{type(e).__name__}: {e}"
                db.add(TestLlmResultado(
                    corrida_id=corrida_id, motor_id=motor.id, motor_nombre=motor.nombre,
                    escenario_slug=esc.slug, escenario_nombre=esc.nombre, caso_uso=esc.caso_uso,
                    transcript=json.dumps(r["transcript"], ensure_ascii=False),
                    tool_calls=json.dumps(r["tool_calls"], ensure_ascii=False),
                    tokens_in=r["in"], tokens_out=r["out"], tokens_cache_read=r["cache"],
                    costo_usd=round(costo, 5), latencia_ms=r["ms"],
                    veredicto=veredicto["veredicto"], categoria=veredicto["categoria"],
                    detalle=veredicto["detalle"], error=err,
                ))
                db.commit()
            finally:
                db.close()

    # Resumen desde la DB (cuenta también las celdas que ya estaban al reanudar).
    resumen, costo_total, juzgada_full = _recompute_resumen(corrida_id)
    db = SessionLocal()
    try:
        cor = db.get(TestLlmCorrida, corrida_id)
        cor.estado = "lista" if juzgada_full else "sin_juzgar"
        cor.resumen = json.dumps(resumen, ensure_ascii=False)
        cor.costo_real_usd = costo_total
        cor.finished_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()
    return {"ok": True, "corrida_id": corrida_id, "juzgado": juzgar,
            "resumen": resumen, "costo_real_usd": costo_total}


def _recompute_resumen(corrida_id: int) -> tuple[dict, float, bool]:
    """Arma el resumen (por motor: bien/mal/dudoso/pendiente + score + costo + por_caso)
    desde los resultados guardados. Devuelve (resumen, costo_total, juzgada_full)."""
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmResultado
    db = SessionLocal()
    try:
        rows = db.query(TestLlmResultado).filter(TestLlmResultado.corrida_id == corrida_id).all()
    finally:
        db.close()
    agg: dict = {}
    for r in rows:
        a = agg.setdefault(r.motor_id, {"nombre": r.motor_nombre, "bien": 0, "mal": 0,
                                        "dudoso": 0, "pendiente": 0, "costo_usd": 0.0, "por_caso": {}})
        ver = r.veredicto if r.veredicto in ("bien", "mal", "dudoso", "pendiente") else "dudoso"
        a[ver] = a.get(ver, 0) + 1
        a["costo_usd"] += r.costo_usd
        a["por_caso"][r.escenario_slug] = {"veredicto": r.veredicto, "costo_usd": r.costo_usd}
    resumen: dict = {}
    costo_total = 0.0
    juzgada_full = len(rows) > 0
    for mid, a in agg.items():
        n = max(1, len(a["por_caso"]))
        judged = a["pendiente"] == 0
        a["score"] = round(100 * a["bien"] / n, 1) if judged else None
        a["costo_usd"] = round(a["costo_usd"], 4)
        resumen[str(mid)] = a
        costo_total += a["costo_usd"]
        if not judged:
            juzgada_full = False
    return resumen, round(costo_total, 4), juzgada_full


def _infer_juzgar(corrida_id: int) -> bool:
    """¿La corrida venía corriendo CON juez? (algún resultado con veredicto ≠ pendiente)."""
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmResultado
    db = SessionLocal()
    try:
        return db.query(TestLlmResultado).filter(
            TestLlmResultado.corrida_id == corrida_id,
            TestLlmResultado.veredicto != "pendiente").first() is not None
    finally:
        db.close()


def reanudar_pendientes() -> dict:
    """Al arrancar el backend: detecta corridas que quedaron 'corriendo' (cortadas por un
    reinicio) y las relanza en thread. `correr` saltea las celdas ya hechas → continúan
    desde donde quedaron. Automático, sin botón."""
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmCorrida
    db = SessionLocal()
    try:
        ids = [c.id for c in db.query(TestLlmCorrida).filter(TestLlmCorrida.estado == "corriendo").all()]
    finally:
        db.close()
    import threading

    def _run(cid: int):
        try:
            correr(cid, juzgar=_infer_juzgar(cid))
        except Exception as e:
            dbx = SessionLocal()
            try:
                cc = dbx.get(TestLlmCorrida, cid)
                if cc:
                    cc.estado = "error"
                    cc.error = f"reanudar: {type(e).__name__}: {e}"
                    dbx.commit()
            finally:
                dbx.close()

    for cid in ids:
        threading.Thread(target=_run, args=(cid,), daemon=True).start()
    if ids:
        print(f"[TEST-LLM] reanudando corridas cortadas: {ids}")
    return {"reanudadas": ids}


def aplicar_veredictos(corrida_id: int, veredictos: list[dict]) -> dict:
    """Escribe los veredictos (juzgados en sesión de Claude con el plan Pro — subagente
    Sonnet aplicando el prompt del Especialista) y finaliza la corrida: recalcula el
    resumen y pasa a estado 'lista'. veredictos: [{motor_id, escenario_slug,
    veredicto: 'bien'|'mal'|'dudoso', categoria?, detalle?}]."""
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmCorrida, TestLlmResultado
    idx = {(v["motor_id"], v["escenario_slug"]): v for v in veredictos}
    db = SessionLocal()
    try:
        aplicados = 0
        for r in db.query(TestLlmResultado).filter(TestLlmResultado.corrida_id == corrida_id).all():
            v = idx.get((r.motor_id, r.escenario_slug))
            if not v:
                continue
            ver = (v.get("veredicto") or "dudoso").strip().lower()
            r.veredicto = ver if ver in ("bien", "mal", "dudoso") else "dudoso"
            r.categoria = (v.get("categoria") or "")[:40]
            r.detalle = (v.get("detalle") or "")[:2000]
            aplicados += 1
        db.commit()
        # recomputar resumen desde los resultados
        agg: dict = {}
        for r in db.query(TestLlmResultado).filter(TestLlmResultado.corrida_id == corrida_id).all():
            a = agg.setdefault(r.motor_id, {"nombre": r.motor_nombre, "bien": 0, "mal": 0,
                                            "dudoso": 0, "pendiente": 0, "costo_usd": 0.0, "por_caso": {}})
            ver = r.veredicto if r.veredicto in ("bien", "mal", "dudoso", "pendiente") else "dudoso"
            a[ver] = a.get(ver, 0) + 1
            a["costo_usd"] += r.costo_usd
            a["por_caso"][r.escenario_slug] = {"veredicto": r.veredicto, "costo_usd": r.costo_usd}
        resumen = {}
        costo_total = 0.0
        for mid, a in agg.items():
            n = max(1, len(a["por_caso"]))
            a["score"] = round(100 * a["bien"] / n, 1)
            a["costo_usd"] = round(a["costo_usd"], 4)
            resumen[str(mid)] = a
            costo_total += a["costo_usd"]
        cor = db.get(TestLlmCorrida, corrida_id)
        cor.estado = "lista"
        cor.resumen = json.dumps(resumen, ensure_ascii=False)
        cor.costo_real_usd = round(costo_total, 4)
        db.commit()
        return {"ok": True, "aplicados": aplicados, "resumen": resumen}
    finally:
        db.close()


# ── conclusión / veredicto final del juez (recomendación en prosa) ─────────────
def pedir_conclusion(corrida_id: int, motor_ids: list[int] | None = None) -> dict:
    """Marca que se pidió el veredicto final (conclusión) de la corrida — opcionalmente
    acotado a un subconjunto de motores del ranking. NO llama a ninguna API ni gasta: solo
    deja la corrida en estado 'procesando' esperando a que la conclusión la genere yo en
    sesión con el plan Pro (subagente Sonnet) y la aplique con `aplicar_conclusion`."""
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmCorrida
    db = SessionLocal()
    try:
        cor = db.get(TestLlmCorrida, corrida_id)
        if not cor:
            return {"ok": False, "detalle": "corrida no encontrada"}
        if cor.estado != "lista":
            return {"ok": False, "detalle": "la corrida tiene que estar juzgada (estado 'lista') para pedir el veredicto"}
        cor.conclusion = None
        cor.conclusion_estado = "procesando"
        cor.conclusion_motores = json.dumps([int(m) for m in (motor_ids or [])])
        cor.conclusion_at = None
        db.commit()
        return {"ok": True, "conclusion_estado": "procesando",
                "conclusion_motores": [int(m) for m in (motor_ids or [])]}
    finally:
        db.close()


def aplicar_conclusion(corrida_id: int, texto: str, motor_ids: list[int] | None = None) -> dict:
    """Escribe la conclusión final (la genero yo en sesión con el plan Pro — subagente Sonnet
    sintetizando el ranking/costos/fallos con el criterio del Especialista) y pasa la
    conclusión a estado 'lista'. Si motor_ids no viene, conserva el subconjunto que se pidió."""
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmCorrida
    db = SessionLocal()
    try:
        cor = db.get(TestLlmCorrida, corrida_id)
        if not cor:
            return {"ok": False, "detalle": "corrida no encontrada"}
        cor.conclusion = (texto or "").strip()[:8000]
        cor.conclusion_estado = "lista"
        if motor_ids is not None:
            cor.conclusion_motores = json.dumps([int(m) for m in motor_ids])
        cor.conclusion_at = datetime.now(timezone.utc)
        db.commit()
        return {"ok": True, "conclusion_estado": "lista",
                "conclusion_motores": json.loads(cor.conclusion_motores or "[]")}
    finally:
        db.close()


# ── seed / estado ─────────────────────────────────────────────────────────────

def ensure_seed() -> dict:
    """Crea motores + escenarios default si no hay. Idempotente."""
    from app.database import SessionLocal
    from app.services import test_llm_data
    db = SessionLocal()
    try:
        return {"motores": test_llm_data.seed_motores(db),
                "escenarios": test_llm_data.seed_escenarios(db)}
    finally:
        db.close()


def set_habilitado(on: bool) -> bool:
    from app.database import SessionLocal
    from app.models.service_health import MonitorSettings
    db = SessionLocal()
    try:
        s = db.query(MonitorSettings).filter(MonitorSettings.id == 1).first()
        if not s:
            return False
        s.test_llm_habilitado = bool(on)
        db.commit()
        return True
    finally:
        db.close()


def saldo_openrouter() -> dict | None:
    """Saldo de OpenRouter (metadata, NO consume tokens). {total, usado, disponible}.
    None si no hay key o falla."""
    from app.services.test_llm_keys import provider_key
    key = provider_key("openrouter")
    if not key:
        return None
    try:
        r = requests.get("https://openrouter.ai/api/v1/credits",
                         headers={"Authorization": f"Bearer {key}", "User-Agent": _UA}, timeout=15)
        r.raise_for_status()
        d = r.json().get("data", {})
        total = float(d.get("total_credits") or 0)
        usado = float(d.get("total_usage") or 0)
        return {"total": round(total, 4), "usado": round(usado, 4),
                "disponible": round(total - usado, 4)}
    except Exception as e:
        print(f"[TEST-LLM] saldo openrouter: {type(e).__name__}: {e}")
        return None


def get_estado(source: str = "etiguel") -> dict:
    """Panel de arranque: gate, sobre, keys, conteos, saldo OpenRouter."""
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmEscenario, TestLlmMotor
    from app.services.test_llm_keys import key_status
    ensure_seed()
    db = SessionLocal()
    try:
        n_mot = db.query(TestLlmMotor).count()
        n_esc = db.query(TestLlmEscenario).count()
    finally:
        db.close()
    out = {"source": source, "habilitado": _habilitado(),
           "keys": key_status(), "motores": n_mot, "escenarios": n_esc,
           "saldo_openrouter": saldo_openrouter()}
    try:
        out["sobre"] = envelope_info(source)
    except Exception as e:
        out["sobre"] = {"error": f"{type(e).__name__}: {e}"}
    return out


# ── CRUD motores ──────────────────────────────────────────────────────────────

def _motor_dict(m) -> dict:
    return {"id": m.id, "nombre": m.nombre, "provider": m.provider, "model_id": m.model_id,
            "base_url": m.base_url, "tiene_key": bool((m.api_key or "").strip()),
            "precio_in": m.precio_in, "precio_out": m.precio_out,
            "precio_cache_read": m.precio_cache_read, "precio_cache_write": m.precio_cache_write,
            "activo": m.activo, "es_actual": m.es_actual, "notas": m.notas}


def listar_motores() -> list[dict]:
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmMotor
    db = SessionLocal()
    try:
        return [_motor_dict(m) for m in db.query(TestLlmMotor).order_by(
            TestLlmMotor.es_actual.desc(), TestLlmMotor.id).all()]
    finally:
        db.close()


def guardar_motor(data: dict, motor_id: int | None = None) -> dict:
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmMotor
    db = SessionLocal()
    try:
        m = db.get(TestLlmMotor, motor_id) if motor_id else TestLlmMotor()
        if motor_id and not m:
            raise ValueError("motor no encontrado")
        for f in ("nombre", "provider", "model_id", "base_url", "notas"):
            if f in data:
                setattr(m, f, data[f])
        for f in ("precio_in", "precio_out", "precio_cache_read", "precio_cache_write"):
            if f in data and data[f] is not None:
                setattr(m, f, float(data[f]))
        for f in ("activo", "es_actual"):
            if f in data:
                setattr(m, f, bool(data[f]))
        if data.get("api_key") is not None:  # "" borra la key propia, None no toca
            m.api_key = (data["api_key"] or "").strip() or None
        if not motor_id:
            db.add(m)
        db.commit(); db.refresh(m)
        return _motor_dict(m)
    finally:
        db.close()


def borrar_motor(motor_id: int) -> bool:
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmMotor
    db = SessionLocal()
    try:
        m = db.get(TestLlmMotor, motor_id)
        if not m:
            return False
        db.delete(m); db.commit()
        return True
    finally:
        db.close()


# ── CRUD escenarios ───────────────────────────────────────────────────────────

def _esc_dict(e) -> dict:
    return {"id": e.id, "slug": e.slug, "nombre": e.nombre, "caso_uso": e.caso_uso,
            "descripcion": e.descripcion, "guion": json.loads(e.guion or "[]"),
            "esperado": json.loads(e.esperado or "{}"), "activo": e.activo, "orden": e.orden}


def listar_escenarios() -> list[dict]:
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmEscenario
    db = SessionLocal()
    try:
        return [_esc_dict(e) for e in db.query(TestLlmEscenario).order_by(
            TestLlmEscenario.orden, TestLlmEscenario.id).all()]
    finally:
        db.close()


def guardar_escenario(data: dict, esc_id: int | None = None) -> dict:
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmEscenario
    db = SessionLocal()
    try:
        e = db.get(TestLlmEscenario, esc_id) if esc_id else TestLlmEscenario()
        if esc_id and not e:
            raise ValueError("escenario no encontrado")
        for f in ("slug", "nombre", "caso_uso", "descripcion"):
            if f in data:
                setattr(e, f, data[f])
        if "guion" in data:
            e.guion = json.dumps(data["guion"], ensure_ascii=False)
        if "esperado" in data:
            e.esperado = json.dumps(data["esperado"], ensure_ascii=False)
        if "activo" in data:
            e.activo = bool(data["activo"])
        if "orden" in data:
            e.orden = int(data["orden"])
        if not esc_id:
            db.add(e)
        db.commit(); db.refresh(e)
        return _esc_dict(e)
    finally:
        db.close()


def borrar_escenario(esc_id: int) -> bool:
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmEscenario
    db = SessionLocal()
    try:
        e = db.get(TestLlmEscenario, esc_id)
        if not e:
            return False
        db.delete(e); db.commit()
        return True
    finally:
        db.close()


# ── corridas ──────────────────────────────────────────────────────────────────

def crear_corrida(source: str, motor_ids: list[int], escenario_ids: list[int],
                  nombre: str = "") -> dict:
    """Crea la corrida (estado 'estimada') con el costo estimado. NO corre."""
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmCorrida
    if not motor_ids or not escenario_ids:
        raise ValueError("elegí al menos un motor y un escenario")
    est = estimar(source, motor_ids, escenario_ids)
    db = SessionLocal()
    try:
        cor = TestLlmCorrida(
            source=source, nombre=nombre or f"Comparación {datetime.now(timezone.utc):%Y-%m-%d %H:%M}",
            estado="estimada", motores=json.dumps(motor_ids), escenarios=json.dumps(escenario_ids),
            costo_estimado_usd=est["total_usd"])
        db.add(cor); db.commit(); db.refresh(cor)
        return {"id": cor.id, "estado": cor.estado, "estimacion": est}
    finally:
        db.close()


def _cor_dict(c) -> dict:
    return {"id": c.id, "source": c.source, "nombre": c.nombre, "estado": c.estado,
            "motores": json.loads(c.motores or "[]"), "escenarios": json.loads(c.escenarios or "[]"),
            "costo_estimado_usd": c.costo_estimado_usd, "costo_real_usd": c.costo_real_usd,
            "resumen": json.loads(c.resumen or "{}"),
            "fidelidad": json.loads(c.fidelidad) if c.fidelidad else None,
            "conclusion": c.conclusion or "",
            "conclusion_estado": getattr(c, "conclusion_estado", "") or "",
            "conclusion_motores": json.loads(getattr(c, "conclusion_motores", None) or "[]"),
            "conclusion_at": c.conclusion_at.isoformat() if getattr(c, "conclusion_at", None) else None,
            "error": c.error,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "finished_at": c.finished_at.isoformat() if c.finished_at else None}


def listar_corridas(source: str = "etiguel", limit: int = 30) -> list[dict]:
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmCorrida
    db = SessionLocal()
    try:
        rows = (db.query(TestLlmCorrida).filter(TestLlmCorrida.source == source)
                .order_by(TestLlmCorrida.created_at.desc()).limit(limit).all())
        return [_cor_dict(c) for c in rows]
    finally:
        db.close()


def get_corrida(corrida_id: int) -> dict | None:
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmCorrida, TestLlmResultado
    db = SessionLocal()
    try:
        c = db.get(TestLlmCorrida, corrida_id)
        if not c:
            return None
        res = (db.query(TestLlmResultado).filter(TestLlmResultado.corrida_id == corrida_id)
               .order_by(TestLlmResultado.motor_id, TestLlmResultado.id).all())
        out = _cor_dict(c)
        out["resultados"] = [{
            "motor_id": r.motor_id, "motor_nombre": r.motor_nombre,
            "escenario_slug": r.escenario_slug, "escenario_nombre": r.escenario_nombre,
            "caso_uso": r.caso_uso, "veredicto": r.veredicto, "categoria": r.categoria,
            "detalle": r.detalle, "costo_usd": r.costo_usd, "latencia_ms": r.latencia_ms,
            "tokens_in": r.tokens_in, "tokens_out": r.tokens_out,
            "tool_calls": json.loads(r.tool_calls or "[]"),
            "transcript": json.loads(r.transcript or "[]"), "error": r.error,
        } for r in res]
        return out
    finally:
        db.close()


# ── catálogo OpenRouter (ranking por uso + precios + costo de testear) ─────────

_OR_MODELS = "https://openrouter.ai/api/v1/models"
_OR_RANKINGS = "https://openrouter.ai/api/v1/datasets/rankings-daily"
_catalog_cache: dict = {"ts": 0.0, "data": None}
_CATALOG_TTL = 3600  # 1h


def _norm_slug(slug: str) -> str:
    """Clave normalizada para matchear el permaslug del ranking (con fecha y orden de
    palabras distinto) contra el id del catálogo. Ej: 'anthropic/claude-4.6-sonnet-20260217'
    y 'anthropic/claude-sonnet-4.6' → misma clave."""
    import re
    s = slug.split(":")[0]
    prov, _, name = s.partition("/") if "/" in s else ("", "", s)
    name = re.sub(r"-?\d{6,8}$", "", name)          # saca sufijo de fecha
    toks = [t for t in re.split(r"[-_.\s]", name) if t]
    return f"{prov.lower()}/" + " ".join(sorted(t.lower() for t in toks))


def _openrouter_catalog(force: bool = False) -> list[dict]:
    """Catálogo de OpenRouter (modelos con precios) enriquecido con ranking por uso y
    un elo promedio de benchmarks. Cacheado 1h. Metadata pura: NO consume tokens."""
    import time as _t
    now = _t.time()
    if not force and _catalog_cache["data"] and now - _catalog_cache["ts"] < _CATALOG_TTL:
        return _catalog_cache["data"]
    from app.services.test_llm_keys import provider_key
    key = provider_key("openrouter")
    if not key:
        raise RuntimeError("falta la API key de OpenRouter")
    hdr = {"Authorization": f"Bearer {key}", "User-Agent": _UA}
    models = requests.get(_OR_MODELS, headers=hdr, timeout=30).json().get("data", [])

    # ranking por uso (top 50/día) → posición por clave normalizada
    pop: dict[str, dict] = {}
    try:
        rows = requests.get(_OR_RANKINGS, headers=hdr, timeout=30).json().get("data", [])
        agg: dict[str, float] = {}
        for r in rows:
            slug = r.get("model_permaslug")
            if not slug or slug == "other":
                continue
            k = _norm_slug(slug)
            agg[k] = agg.get(k, 0.0) + float(r.get("total_tokens") or 0)
        for i, (k, t) in enumerate(sorted(agg.items(), key=lambda x: -x[1]), 1):
            pop[k] = {"rank": i, "tokens": t}
    except Exception as e:
        print(f"[TEST-LLM] rankings: {type(e).__name__}: {e}")

    def _f(x) -> float:
        try:
            return float(x)
        except Exception:
            return 0.0

    out = []
    for m in models:
        p = m.get("pricing") or {}
        k = _norm_slug(m["id"])
        popd = pop.get(k)
        elo = None
        bm = (m.get("benchmarks") or {}).get("design_arena")
        if isinstance(bm, list) and bm:
            elos = [b.get("elo") for b in bm if isinstance(b, dict) and b.get("elo")]
            if elos:
                elo = round(sum(elos) / len(elos))
        out.append({
            "id": m["id"], "name": m.get("name") or m["id"],
            "precio_in": _f(p.get("prompt")), "precio_out": _f(p.get("completion")),
            "precio_cache_read": _f(p.get("input_cache_read")),
            "precio_cache_write": _f(p.get("input_cache_write")),
            "context": m.get("context_length"),
            "rank_uso": popd["rank"] if popd else None,
            "tokens_uso": popd["tokens"] if popd else None,
            "elo": elo,
        })
    _catalog_cache["data"] = out
    _catalog_cache["ts"] = now
    return out


def catalogo(source: str, escenario_ids: list[int] | None = None, filtro: str = "",
             orden: str = "rank", limit: int = 80, con_cache: bool = True) -> dict:
    """Catálogo OpenRouter con el COSTO DE TESTEAR cada modelo para los escenarios
    elegidos (o todos los activos si no se pasan). Ordena por 'rank' (uso), 'costo',
    'precio_in' o 'nombre'. Solo modelos con precio > 0 (descarta gratis/imagen)."""
    from app.database import SessionLocal
    from app.models.test_llm import TestLlmEscenario
    cat = _openrouter_catalog()
    env = _build_envelope(source)
    sys_tok = _tok(env["system"])
    db = SessionLocal()
    try:
        q = db.query(TestLlmEscenario)
        if escenario_ids:
            q = q.filter(TestLlmEscenario.id.in_(escenario_ids))
        else:
            q = q.filter(TestLlmEscenario.activo == True)  # noqa: E712
        escs = q.all()
    finally:
        db.close()
    total_turnos, guion_tok = _turnos_de(escs)
    n_esc = len(escs)

    items = []
    fl = (filtro or "").strip().lower()
    for c in cat:
        if fl and fl not in c["id"].lower() and fl not in c["name"].lower():
            continue
        if c["precio_in"] <= 0 and c["precio_out"] <= 0:  # gratis o sin precio → fuera
            continue
        costo = _costo_para_prices(sys_tok, guion_tok, total_turnos, n_esc,
                                   c["precio_in"], c["precio_out"],
                                   c["precio_cache_read"], c["precio_cache_write"], con_cache)
        items.append({**c, "costo_test_usd": round(costo, 5)})

    if orden == "costo":
        items.sort(key=lambda x: x["costo_test_usd"])
    elif orden == "precio_in":
        items.sort(key=lambda x: x["precio_in"])
    elif orden == "nombre":
        items.sort(key=lambda x: x["name"].lower())
    else:  # rank (uso) — los sin rank al final
        items.sort(key=lambda x: (x["rank_uso"] is None, x["rank_uso"] or 9999))

    return {"source": source, "escenarios": n_esc, "turnos_totales": total_turnos,
            "system_tokens": sys_tok, "total": len(items), "items": items[:limit]}


def agregar_desde_catalogo(model_id: str) -> dict:
    """Crea un motor de OpenRouter a partir de un modelo del catálogo (precios per-token
    ya vienen listos). Usa la key compartida de OpenRouter (api_key vacía)."""
    cat = _openrouter_catalog()
    m = next((x for x in cat if x["id"] == model_id), None)
    if not m:
        raise ValueError("modelo no encontrado en el catálogo")
    return guardar_motor({
        "nombre": f"{m['name']} (OpenRouter)", "provider": "openrouter",
        "model_id": m["id"], "base_url": "https://openrouter.ai/api/v1", "api_key": None,
        "precio_in": m["precio_in"], "precio_out": m["precio_out"],
        "precio_cache_read": m["precio_cache_read"], "precio_cache_write": m["precio_cache_write"],
        "notas": f"Alta desde catálogo OpenRouter. Uso rank {m.get('rank_uso') or '—'}.",
    })

