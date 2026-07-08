"""Especialista de calidad / negocio (#2).

Un agente que lee las conversaciones de Camila y juzga, con criterio de negocio,
si lo que respondió estuvo bien o mal: lead perdido, info incorrecta, tono flojo,
oportunidad de venta sin aprovechar, derivación tardía, etc. Lo que le llama la
atención lo deja como `CamilaRevision` (estado 'nuevo') para que Sebi lo confirme
desde la app/web.

Loop de aprendizaje (in-context, sin fine-tuning): las confirmaciones de Sebi
(`veredicto` = 'acierto' | 'falso_positivo') se acumulan y se re-inyectan al
agente como ejemplos calibradores en cada corrida. Los falso_positivo le enseñan
a NO volver a marcar ese tipo de caso → cada vez juzga más parecido a Sebi.

Corre con la key propia de monitor_settings (igual que intake_ai), batcheado 1×/día
→ NO toca ni infla el cache de Camila. Modelo sonnet (esto necesita criterio).
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime, timedelta, timezone

import requests

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-sonnet-4-6"
_BA = timezone(timedelta(hours=-3))

# Topes para acotar costo (al volumen de hoy ~12-15 conv/día = centavos).
MAX_CONV_POR_DIA = 40
MAX_MSGS_POR_CONV = 50
MAX_CHARS_TRANSCRIPT = 8000
MAX_EJEMPLOS_CALIBRACION = 12

CATEGORIAS = {
    "lead_perdido": "Lead con intención que no se aprovechó / se enfrió por la respuesta",
    "info_incorrecta": "Camila dio información equivocada o inventada",
    "oportunidad_venta": "Había una oportunidad de vender/ampliar y no se tomó",
    "tono": "Tono inadecuado (frío, robótico, cortante, demasiado largo)",
    "derivacion": "Tendría que haber derivado a una persona y no lo hizo (o tarde)",
    "confuso": "La respuesta fue confusa o no respondió lo que preguntaron",
    "otro": "Otra cosa que vale la pena que Sebi revise",
}


# Contexto del negocio. Hoy hardcodeado para Etiguel; cuando entren más clientes
# se arma desde tenant_config.info_negocio del source correspondiente.
_NEGOCIO = {
    "etiguel": (
        "Etiguel es una empresa argentina (CABA) de sublimación digital sobre telas, "
        "cintas y elásticos. Vende a otras empresas (B2B): hace impresión sublimada a "
        "demanda, con mínimos de producción. Camila es la agente de WhatsApp que atiende "
        "a los prospectos/clientes: responde consultas, pasa precios/condiciones cuando "
        "corresponde, y cuando el cliente muestra interés real deriva a Delfina (del "
        "equipo) para cotizar y cerrar. El objetivo del negocio es no perder ningún lead "
        "con intención de compra y dar una atención clara, cordial y argentina (tuteo)."
    ),
}


def _anthropic_key() -> str:
    try:
        from app.database import SessionLocal
        from app.models.service_health import MonitorSettings
        db = SessionLocal()
        try:
            s = db.query(MonitorSettings).filter(MonitorSettings.id == 1).first()
            if s and s.anthropic_api_key:
                return s.anthropic_api_key
        finally:
            db.close()
    except Exception:
        pass
    from app.core.config import settings
    return settings.ANTHROPIC_API_KEY or ""


def _post(system: str, user: str, max_tokens: int = 1200, timeout: int = 40,
          funcion: str = "Especialista Negocio (calidad)", source: str | None = None) -> str | None:
    key = _anthropic_key()
    if not key:
        return None
    try:
        resp = requests.post(
            ANTHROPIC_API_URL,
            headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
            json={"model": MODEL, "max_tokens": max_tokens, "system": system,
                  "messages": [{"role": "user", "content": user}]},
            timeout=timeout,
        )
    except Exception as e:
        print(f"[CAMILA-QUALITY] HTTP error: {type(e).__name__}: {e}")
        return None
    if resp.status_code != 200:
        print(f"[CAMILA-QUALITY] HTTP {resp.status_code}: {resp.text[:200]}")
        return None
    try:
        data = resp.json()
        from app.services import anthropic_usage
        anthropic_usage.registrar(funcion, MODEL, data.get("usage"), source)
        return (data.get("content") or [{}])[0].get("text", "")
    except Exception as e:
        print(f"[CAMILA-QUALITY] parse: {e}")
        return None


def transcribir_imagen(image_b64: str, mime: str = "image/jpeg", source: str | None = None) -> str | None:
    """Lee UNA imagen (captura de conversación) con Haiku-visión y devuelve la
    transcripción del intercambio. Barato (Haiku) y se usa 1 sola vez al cargar el
    registro → la lección queda como texto. None si no hay key o falla."""
    key = _anthropic_key()
    if not key or not image_b64:
        return None
    HAIKU = "claude-haiku-4-5-20251001"
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": mime, "data": image_b64}},
        {"type": "text", "text": (
            "Es una captura de una conversación de WhatsApp entre un cliente y Camila "
            "(la agente del negocio). Transcribí el intercambio que se ve, indicando quién "
            "dijo cada cosa (Cliente / Camila). Solo la transcripción fiel, sin opinar ni resumir.")},
    ]
    try:
        resp = requests.post(
            ANTHROPIC_API_URL,
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": HAIKU, "max_tokens": 1500, "messages": [{"role": "user", "content": content}]},
            timeout=60,
        )
    except Exception as e:
        print(f"[CAMILA-QUALITY] transcribir HTTP: {type(e).__name__}: {e}")
        return None
    if resp.status_code != 200:
        print(f"[CAMILA-QUALITY] transcribir HTTP {resp.status_code}: {resp.text[:200]}")
        return None
    try:
        data = resp.json()
        from app.services import anthropic_usage
        anthropic_usage.registrar("Transcripción imagen (calidad)", HAIKU, data.get("usage"), source)
        return (data.get("content") or [{}])[0].get("text", "").strip() or None
    except Exception as e:
        print(f"[CAMILA-QUALITY] transcribir parse: {e}")
        return None


def transcribir_imagen_error(image_b64: str, mime: str = "image/png", source: str | None = None) -> str | None:
    """Lee UNA imagen adjunta a un error cargado a mano (captura de un bug, mensaje
    de error, pantalla, o conversación) con Haiku-visión y devuelve una descripción
    fiel para que quede como texto en el error. Barato (Haiku), 1 sola vez. None si
    no hay key o falla."""
    key = _anthropic_key()
    if not key or not image_b64:
        return None
    HAIKU = "claude-haiku-4-5-20251001"
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": mime, "data": image_b64}},
        {"type": "text", "text": (
            "Es una captura que documenta un error o problema (puede ser un mensaje de error, "
            "una pantalla de una app/web, o una conversación de WhatsApp). Describí fielmente y "
            "en detalle lo que se ve: transcribí TODO el texto visible (mensajes de error, "
            "botones, títulos, el intercambio si es un chat indicando quién dijo cada cosa) para "
            "que sirva de referencia técnica. Sin opinar ni resumir de más; priorizá el texto literal.")},
    ]
    try:
        resp = requests.post(
            ANTHROPIC_API_URL,
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": HAIKU, "max_tokens": 1500, "messages": [{"role": "user", "content": content}]},
            timeout=60,
        )
    except Exception as e:
        print(f"[CAMILA-QUALITY] transcribir error HTTP: {type(e).__name__}: {e}")
        return None
    if resp.status_code != 200:
        print(f"[CAMILA-QUALITY] transcribir error HTTP {resp.status_code}: {resp.text[:200]}")
        return None
    try:
        data = resp.json()
        from app.services import anthropic_usage
        anthropic_usage.registrar("Transcripción imagen (error)", HAIKU, data.get("usage"), source)
        return (data.get("content") or [{}])[0].get("text", "").strip() or None
    except Exception as e:
        print(f"[CAMILA-QUALITY] transcribir error parse: {e}")
        return None


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


# ── conversaciones del día ────────────────────────────────────────────────────

def _conversaciones_del_dia(db, fecha: str) -> list[dict]:
    """Mirrors con actividad ese día (BA) → su transcript (últimos N mensajes).
    Devuelve [{mirror_id, telefono, nombre, transcript, n_msgs_dia}]."""
    from app.models.etiguel_mirror import EtiguelMirror, EtiguelMirrorMensaje
    day_start = datetime.strptime(fecha, "%Y-%m-%d").replace(tzinfo=_BA)
    day_end = day_start + timedelta(days=1)
    us, ue = day_start.astimezone(timezone.utc), day_end.astimezone(timezone.utc)

    rows = (db.query(EtiguelMirrorMensaje.mirror_id)
            .filter(EtiguelMirrorMensaje.fecha >= us, EtiguelMirrorMensaje.fecha < ue)
            .all())
    cont: dict[int, int] = {}
    for (mid,) in rows:
        cont[mid] = cont.get(mid, 0) + 1
    if not cont:
        return []

    out = []
    for mid in sorted(cont, key=lambda k: cont[k], reverse=True)[:MAX_CONV_POR_DIA]:
        mirror = db.get(EtiguelMirror, mid)
        if not mirror:
            continue
        msgs = (db.query(EtiguelMirrorMensaje)
                .filter(EtiguelMirrorMensaje.mirror_id == mid)
                .order_by(EtiguelMirrorMensaje.fecha.asc(), EtiguelMirrorMensaje.id.asc())
                .all())
        msgs = msgs[-MAX_MSGS_POR_CONV:]
        lineas = []
        for m in msgs:
            quien = "Cliente" if m.direccion == "in" else "Camila"
            txt = (m.texto or "").strip().replace("\n", " ")
            if txt:
                lineas.append(f"[{quien}] {txt}")
        transcript = "\n".join(lineas)[-MAX_CHARS_TRANSCRIPT:]
        if not transcript:
            continue
        out.append({"mirror_id": mid, "telefono": mirror.telefono,
                    "nombre": mirror.nombre, "transcript": transcript,
                    "n_msgs_dia": cont[mid]})
    return out


# ── loop de aprendizaje: ejemplos calibradores ─────────────────────────────────

def _ejemplos_calibracion(db, source: str) -> str:
    """Arma el bloque de calibración a partir de las confirmaciones de Sebi.
    Prioriza los falso_positivo (lo que NO hay que marcar) y suma aciertos."""
    from app.models.camila_revision import CamilaRevision
    rows = (db.query(CamilaRevision)
            .filter(CamilaRevision.source == source,
                    CamilaRevision.veredicto.isnot(None))
            .order_by(CamilaRevision.revisado_at.desc())
            .limit(MAX_EJEMPLOS_CALIBRACION * 2).all())
    fp = [r for r in rows if r.veredicto == "falso_positivo"][:MAX_EJEMPLOS_CALIBRACION]
    ac = [r for r in rows if r.veredicto == "acierto"][:MAX_EJEMPLOS_CALIBRACION]
    if not fp and not ac:
        return ""
    partes = ["\n\nCALIBRACIÓN (feedback real de Sebi sobre tus revisiones anteriores):"]
    if fp:
        partes.append("\nCasos que marcaste pero Sebi dijo que Camila estuvo BIEN "
                      "(NO vuelvas a marcar casos así):")
        for r in fp:
            nota = f" — Sebi: {r.nota_sebi.strip()}" if r.nota_sebi else ""
            partes.append(f"- [{r.categoria}] {r.titulo}{nota}")
    if ac:
        partes.append("\nCasos que marcaste y Sebi confirmó que estuvieron MAL "
                      "(seguí detectando este tipo):")
        for r in ac:
            nota = f" — Sebi: {r.nota_sebi.strip()}" if r.nota_sebi else ""
            partes.append(f"- [{r.categoria}] {r.titulo}{nota}")
    return "\n".join(partes)


def _fixes_aplicados(db, source: str, limit: int = 40) -> str:
    """Changelog de arreglos MANUALES de Camila (#95). El especialista lo lee para
    NO volver a reportar algo que Sebi ya arregló a mano (evita oportunidades de
    mejora duplicadas). Incluye teléfono cuando el fix fue por una conversación."""
    try:
        from app.models.camila_fix import CamilaFix
        rows = (db.query(CamilaFix)
                .filter(CamilaFix.source == source)
                .order_by(CamilaFix.creado_at.desc())
                .limit(limit).all())
    except Exception:
        return ""
    if not rows:
        return ""
    partes = ["\n\nARREGLOS YA HECHOS A MANO (NO los vuelvas a marcar — ya están resueltos "
              "en Camila; marcarlos sería una mejora DUPLICADA):"]
    for fx in rows:
        tel = f" (tel {fx.telefono})" if fx.telefono else ""
        cat = f"[{fx.categoria}] " if fx.categoria else ""
        partes.append(f"- {cat}{fx.descripcion.strip()}{tel}")
    return "\n".join(partes)


def _system_prompt(source: str, calibracion: str, fixes: str = "") -> str:
    negocio = _NEGOCIO.get(source, _NEGOCIO["etiguel"])
    cats = "\n".join(f"  - {k}: {v}" for k, v in CATEGORIAS.items())
    return (
        "Sos 'Especialista Negocio', un especialista en el modelo de negocio que "
        "audita la calidad de la atención de Camila (una agente de IA que atiende "
        "WhatsApp por el negocio). Tu trabajo es "
        "leer una conversación y juzgar, con criterio comercial, si lo que respondió "
        "Camila estuvo bien o si hay algo que el dueño del negocio (Sebi) debería "
        "revisar. Sos exigente pero NO marcás cualquier cosa: solo lo que realmente "
        "vale la pena (un lead que se pierde, info equivocada, una venta que se dejó "
        "pasar, un tono que aleja al cliente). Una conversación normal y bien atendida "
        "NO se marca.\n\n"
        f"EL NEGOCIO:\n{negocio}\n\n"
        f"CATEGORÍAS de observación:\n{cats}\n"
        f"{calibracion}"
        f"{fixes}\n\n"
        "Respondé SOLO con un JSON válido (sin texto alrededor, sin ```), así:\n"
        '{"revisar": true|false, "categoria": "<una de las categorías>", '
        '"severidad": "alta"|"media"|"baja", "titulo": "<resumen corto, máx 110 car>", '
        '"detalle": "<qué hizo Camila y por qué es discutible, 1-3 oraciones>", '
        '"fragmento": "<la parte textual de la charla que lo justifica>", '
        '"sugerencia": "<cómo debería haber respondido / qué ajustar en Camila>"}\n'
        "Si la conversación estuvo bien atendida, devolvé {\"revisar\": false} y nada más."
    )


# ── revisión de un día ──────────────────────────────────────────────────────

def _ya_revisada(db, source: str, telefono: str | None, fecha: str, categoria: str) -> bool:
    from app.models.camila_revision import CamilaRevision
    return db.query(CamilaRevision).filter(
        CamilaRevision.source == source,
        CamilaRevision.telefono == telefono,
        CamilaRevision.fecha == fecha,
        CamilaRevision.categoria == categoria,
    ).first() is not None


def revisar_dia(source: str = "etiguel", fecha: str | None = None, notify: bool = True) -> dict:
    """Revisa la calidad de las conversaciones con actividad ese día. Persiste solo
    lo que el agente marca como dudoso (estado 'nuevo'). Devuelve un resumen."""
    from app.database import SessionLocal
    from app.models.camila_revision import CamilaRevision
    fecha = fecha or _ayer_ba()
    db = SessionLocal()
    nuevas = 0
    revisadas = 0
    try:
        convs = _conversaciones_del_dia(db, fecha)
        if not convs:
            return {"source": source, "fecha": fecha, "conversaciones": 0, "nuevas": 0}
        calibracion = _ejemplos_calibracion(db, source)
        fixes = _fixes_aplicados(db, source)
        system = _system_prompt(source, calibracion, fixes)
        for c in convs:
            revisadas += 1
            user = (f"Conversación de Camila con {c.get('nombre') or 'un cliente'} "
                    f"(tel {c.get('telefono') or '?'}), del {fecha}:\n\n{c['transcript']}")
            data = _parse_json(_post(system, user, source=source))
            if not data or not data.get("revisar"):
                continue
            categoria = (data.get("categoria") or "otro").strip()
            if categoria not in CATEGORIAS:
                categoria = "otro"
            if _ya_revisada(db, source, c.get("telefono"), fecha, categoria):
                continue
            sev = (data.get("severidad") or "media").strip()
            if sev not in ("alta", "media", "baja"):
                sev = "media"
            db.add(CamilaRevision(
                source=source, mirror_id=c.get("mirror_id"), telefono=c.get("telefono"),
                nombre=c.get("nombre"), fecha=fecha, categoria=categoria, severidad=sev,
                titulo=(data.get("titulo") or "Revisar conversación")[:200],
                detalle=(data.get("detalle") or "")[:4000],
                fragmento=(data.get("fragmento") or "")[:4000],
                sugerencia=(data.get("sugerencia") or "")[:4000],
                estado="nuevo",
            ))
            nuevas += 1
        db.commit()
    finally:
        db.close()

    if notify and nuevas > 0:
        try:
            from app.services import push
            push.notificar_global(
                "calidad_revision",
                f"🔎 Especialista Negocio: {nuevas} conversación(es) para revisar",
                "Marqué respuestas de Camila para que confirmes si estuvieron bien o mal.",
                {"tipo": "calidad", "source": source, "nav": "calidad"},
            )
        except Exception as e:
            print(f"[CAMILA-QUALITY] push: {type(e).__name__}: {e}")
    return {"source": source, "fecha": fecha, "conversaciones": revisadas, "nuevas": nuevas}


# ── lectura / confirmación (UI) ───────────────────────────────────────────────

def get_revisiones(source: str = "etiguel", estado: str | None = None) -> list[dict]:
    from app.database import SessionLocal
    from app.models.camila_revision import CamilaRevision
    db = SessionLocal()
    try:
        q = db.query(CamilaRevision).filter(CamilaRevision.source == source)
        if estado:
            q = q.filter(CamilaRevision.estado == estado)
        sev = {"alta": 0, "media": 1, "baja": 2}
        rows = q.all()
        rows.sort(key=lambda r: (0 if r.estado == "nuevo" else 1,
                                 sev.get(r.severidad, 9),
                                 -(r.created_at.timestamp() if r.created_at else 0)))
        return [_to_dict(r) for r in rows]
    finally:
        db.close()


def _to_dict(r) -> dict:
    return {
        "id": r.id, "source": r.source, "mirror_id": r.mirror_id,
        "telefono": r.telefono, "nombre": r.nombre, "fecha": r.fecha,
        "categoria": r.categoria, "severidad": r.severidad, "titulo": r.titulo,
        "detalle": r.detalle, "fragmento": r.fragmento, "sugerencia": r.sugerencia,
        "origen": getattr(r, "origen", "especialista"),
        "estado": r.estado, "veredicto": r.veredicto, "nota_sebi": r.nota_sebi,
        "resuelto_directo": bool(getattr(r, "resuelto_directo", False)),
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "revisado_at": r.revisado_at.isoformat() if r.revisado_at else None,
    }


def confirmar_revision(rev_id: int, veredicto: str, nota: str | None = None,
                       resuelto_directo: bool = False) -> dict | None:
    """Sebi confirma: 'acierto' (Camila mal) | 'falso_positivo' (Camila bien).
    Esto alimenta el loop de aprendizaje. Devuelve la revisión actualizada.

    Si `resuelto_directo` (solo válido con 'acierto'): Sebi ya arregló a Camila a
    mano. La revisión queda como 'acierto' (el especialista la sigue tomando como
    caso a detectar → calibración), pero se marca incorporada_at=ahora para que NO
    entre a la cola de Aprendizajes (el prompt de Camila ya está corregido)."""
    if veredicto not in ("acierto", "falso_positivo"):
        raise ValueError("veredicto inválido")
    if resuelto_directo and veredicto != "acierto":
        raise ValueError("resuelto_directo solo aplica a 'acierto'")
    from app.database import SessionLocal
    from app.models.camila_revision import CamilaRevision
    db = SessionLocal()
    try:
        r = db.get(CamilaRevision, rev_id)
        if not r:
            return None
        ahora = datetime.now(timezone.utc)
        r.veredicto = veredicto
        r.estado = "revisado"
        r.nota_sebi = (nota or None)
        r.revisado_at = ahora
        if resuelto_directo:
            r.resuelto_directo = True
            r.incorporada_at = ahora   # fuera de la cola de Aprendizajes (ya resuelto)
            # #95: dejarlo también en el changelog de fixes manuales, así el
            # especialista no lo re-reporta en días siguientes (dedup duplicados).
            try:
                from app.models.camila_fix import CamilaFix
                db.add(CamilaFix(
                    source=r.source, telefono=r.telefono, categoria=r.categoria,
                    descripcion=(r.titulo or "Arreglo manual")[:500],
                ))
            except Exception:
                pass
        db.commit()
        db.refresh(r)
        return _to_dict(r)
    finally:
        db.close()


def borrar_revision(rev_id: int) -> bool:
    from app.database import SessionLocal
    from app.models.camila_revision import CamilaRevision
    db = SessionLocal()
    try:
        r = db.get(CamilaRevision, rev_id)
        if not r:
            return False
        db.delete(r)
        db.commit()
        return True
    finally:
        db.close()


# ── reporte manual de Sebi (desde un lead) ────────────────────────────────────

def crear_reporte_manual(source: str, texto: str, telefono: str | None = None,
                         nombre: str | None = None, imagen_b64: str | None = None,
                         imagen_mime: str = "image/jpeg") -> dict:
    """Sebi reporta a mano que Camila estuvo mal en un lead. Entra YA confirmado como
    'acierto' (Sebi es la verdad → no se re-confirma) y suma directo a las lecciones
    pendientes. Si es Etiguel, linkea la conversación espejada por teléfono (para
    poder abrirla desde Calidad). Si viene una imagen de la conversación, la transcribe
    1 sola vez (Haiku) y suma la transcripción al texto. Devuelve la revisión creada."""
    texto = (texto or "").strip()
    # Si hay imagen, la transcribimos y la sumamos como contexto de la lección.
    transcripcion = transcribir_imagen(imagen_b64, imagen_mime, source) if imagen_b64 else None
    if not texto and not transcripcion:
        raise ValueError("el reporte está vacío")
    detalle = texto
    if transcripcion:
        detalle = (f"{texto}\n\n" if texto else "") + f"[Conversación de la captura adjunta]:\n{transcripcion}"
    from app.database import SessionLocal
    from app.models.camila_revision import CamilaRevision
    db = SessionLocal()
    try:
        mirror_id = None
        if source == "etiguel" and telefono:
            try:
                from app.models.etiguel_mirror import EtiguelMirror
                m = (db.query(EtiguelMirror)
                     .filter(EtiguelMirror.telefono == telefono).first())
                if m:
                    mirror_id = m.id
                    nombre = nombre or m.nombre
            except Exception:
                pass
        ahora = datetime.now(timezone.utc)
        base_titulo = (texto or transcripcion or "").replace("\n", " ").strip()
        titulo = (base_titulo[:107] + "…") if len(base_titulo) > 108 else base_titulo
        r = CamilaRevision(
            source=source, mirror_id=mirror_id, telefono=telefono, nombre=nombre,
            fecha=_hoy_ba(), categoria="otro", severidad="media",
            titulo=titulo or "Reporte de calidad",
            detalle=detalle[:6000], fragmento="", sugerencia="",
            origen="sebi", estado="revisado", veredicto="acierto",
            nota_sebi=detalle[:6000], revisado_at=ahora,
        )
        db.add(r)
        db.commit()
        db.refresh(r)
        out = _to_dict(r)
    finally:
        db.close()
    # Suma para las 5: si llegó al umbral, dispara la consolidación (con su push).
    try:
        from app.services import camila_aprendizaje
        camila_aprendizaje.maybe_proponer(source)
    except Exception as e:
        print(f"[CAMILA-QUALITY] maybe_proponer tras reporte: {type(e).__name__}: {e}")
    return out


def get_sources_calidad() -> list[dict]:
    """Lista de clientes para el selector de Calidad: Etiguel + cada tenant.
    `source` es el valor que se filtra ('etiguel' o el slug del tenant)."""
    from app.database import SessionLocal
    from app.models.tenant import Tenant
    out = [{"source": "etiguel", "nombre": "Etiguel"}]
    db = SessionLocal()
    try:
        for t in db.query(Tenant).order_by(Tenant.nombre.asc()).all():
            out.append({"source": t.slug, "nombre": t.nombre})
    finally:
        db.close()
    return out


# ── loop diario ───────────────────────────────────────────────────────────────

def _hoy_ba() -> str:
    return datetime.now(_BA).strftime("%Y-%m-%d")


def _ayer_ba() -> str:
    return (datetime.now(_BA) - timedelta(days=1)).strftime("%Y-%m-%d")


def start():
    def loop():
        time.sleep(180)  # esperar a que el backend levante
        last_day = None
        while True:
            hoy = _hoy_ba()
            if last_day != hoy:  # 1×/día: revisa el día anterior (ya cerrado)
                try:
                    revisar_dia("etiguel", _ayer_ba(), notify=True)
                except Exception as e:
                    print(f"[CAMILA-QUALITY] revisar ayer: {type(e).__name__}: {e}")
                # Recordatorio semanal de auditoría del prompt completo (nivel 2).
                try:
                    from app.services import camila_prompt_audit
                    camila_prompt_audit.correr_auto("etiguel")
                except Exception as e:
                    print(f"[CAMILA-QUALITY] auditoría auto: {type(e).__name__}: {e}")
                last_day = hoy
            time.sleep(3 * 3600)

    threading.Thread(target=loop, daemon=True, name="camila-quality").start()
