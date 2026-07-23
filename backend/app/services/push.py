"""Envío de notificaciones push a la app de administración vía Expo Push API.

La cadena es: backend → Expo (exp.host) → FCM (Google) → celular. Acá solo
hablamos con Expo; Expo se encarga del resto. No bloquea el request que dispara
el evento: se manda en un thread daemon."""
import threading

import requests

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

# Eventos de push toggleables por dispositivo (#38). Cada tupla es
# (key, label, descripcion): label = lo que ve el usuario en la config; descripcion
# = el texto breve que abre el ícono "i" al lado del toggle (app + web). El orden es
# el de la UI. REGLA: toda notificación nueva se agrega CON su descripción (la "i"
# de la UI se alimenta de acá; sin descripción queda un toggle sin explicar).
EVENTOS_PUSH: list[tuple[str, str, str]] = [
    ("interesado", "Interesado", "Un prospecto pasó a interesado: mostró intención de compra."),
    ("respuesta", "Primera respuesta", "Un prospecto respondió por primera vez a un contacto."),
    ("mensaje_entrante", "Cada mensaje entrante", "Cada mensaje nuevo de un prospecto que ya está en conversación."),
    ("error_camila", "Error de Camila", "Camila tuvo un error y quedó reportado para revisar."),
    ("consulta_camila", "Consulta de Camila (no sabe qué responder)", "Camila no supo qué responder y te consulta para que la destrabes."),
    ("standby", "Pendiente en espera (standby)", "Frené un pendiente de la cola porque me falta info tuya para terminarlo."),
    ("cola_terminada", "Cola de pendientes terminada", "Terminé de procesar toda la cola de pendientes."),
    ("claude_termino", "Claude terminó una tarea (Prospia)", "Claude terminó cualquier tarea de Prospia, no solo la cola."),
    ("necesita_autorizacion", "Necesita tu autorización", "Me trabé en una tarea de la cola esperando tu OK para seguir."),
    ("servicio_caido", "Servicio caído (monitoreo)", "Un servicio monitoreado se cayó."),
    ("servicio_recuperado", "Servicio recuperado (monitoreo)", "Un servicio que estaba caído volvió a funcionar."),
    ("tokens_oportunidad", "Oportunidad de mejora de consumo (tokens)", "Detecté una oportunidad de bajar el consumo de tokens (costo)."),
    ("calidad_revision", "Calidad de Camila (revisar conversación)", "El especialista del negocio marcó respuestas de Camila para que confirmes si estuvieron bien o mal."),
    ("pregunta_claude", "Claude te pregunta algo (responder desde el cel)", "Claude te hace una pregunta con opciones para que respondas desde el cel."),
    ("saldo_bajo", "Saldo bajo de un proveedor de IA", "Un proveedor de IA se está quedando sin saldo (OpenRouter ≤ US$1, o MyClaw sin saldo). Recargá para que Camila no quede muda."),
    ("sesion_espera", "Sesión de la Mac TE ESPERA (pantalla Sesiones)", "Una sesión de Claude de la Mac quedó esperándote: te hizo una pregunta o necesita un OK para seguir. Es de la pantalla Sesiones — no confundir con \"Claude terminó una tarea (Prospia)\"."),
    ("sesion_termino", "Sesión de la Mac TERMINÓ su tarea (pantalla Sesiones)", "Una sesión de Claude de la Mac terminó lo que le pediste (solo turnos de más de un minuto). Arranca APAGADO: prendelo si querés estos avisos. Es de la pantalla Sesiones — distinto de \"Claude terminó una tarea (Prospia)\"."),
]
EVENTOS_PUSH_KEYS = [k for k, _, _ in EVENTOS_PUSH]

# Eventos OPT-IN: arrancan APAGADOS y solo llegan a los devices que los prenden.
# El resto de EVENTOS_PUSH es opt-out (sin fila en push_event_mutes = activado).
# Para estos, la fila en push_event_mutes se reinterpreta al revés: PRESENCIA de
# fila = ACTIVADO (suscripto). Sin fila = no recibe. (Ver _tokens_para_evento y
# los endpoints /notif-prefs.) claude_termino avisa al terminar CUALQUIER tarea
# de Prospia; default OFF para no inundar a quien no lo quiera.
EVENTOS_PUSH_DEFAULT_OFF = {"claude_termino", "sesion_termino"}

# Eventos configurables POR CLIENTE (#44) + su default cuando no hay fila.
# (key, label, descripcion) — ver EVENTOS_PUSH. mensaje_entrante arranca OFF.
EVENTOS_CLIENTE: list[tuple[str, str, str]] = [
    ("interesado", "Interesado", "Este cliente: un prospecto pasó a interesado."),
    ("respuesta", "Primera respuesta", "Este cliente: un prospecto respondió por primera vez."),
    ("mensaje_entrante", "Cada mensaje entrante", "Este cliente: cada mensaje nuevo de un prospecto en conversación. Arranca apagado."),
]
DEFAULT_CLIENTE_EVENTO = {"interesado": True, "respuesta": True, "mensaje_entrante": False}


def _cliente_evento_ok(db, expo_token: str, tenant_id: int, evento: str) -> bool:
    """¿Este device quiere `evento` para `tenant_id`? Usa la fila explícita de
    push_cliente_evento o el default (#44)."""
    from app.models.push_cliente_evento import PushClienteEvento
    row = (
        db.query(PushClienteEvento)
        .filter(
            PushClienteEvento.expo_token == expo_token,
            PushClienteEvento.tenant_id == tenant_id,
            PushClienteEvento.evento == evento,
        )
        .first()
    )
    return row.enabled if row else DEFAULT_CLIENTE_EVENTO.get(evento, True)


def _tokens_para_evento(db, evento: str) -> list[str]:
    """Devices a los que SÍ hay que mandarles este evento: todos menos los que lo
    tienen silenciado en push_event_mutes (#38)."""
    from app.models.device import Device
    from app.models.push_event_mute import PushEventMute

    con_fila = {
        t for (t,) in db.query(PushEventMute.expo_token)
        .filter(PushEventMute.evento == evento)
        .all()
    }
    if evento in EVENTOS_PUSH_DEFAULT_OFF:
        # opt-in: la fila marca "suscripto" → solo esos devices reciben.
        return [d.expo_token for d in db.query(Device).all() if d.expo_token in con_fila]
    # opt-out (default): la fila marca "silenciado".
    return [d.expo_token for d in db.query(Device).all() if d.expo_token not in con_fila]


def _enviar(tokens: list[str], title: str, body: str, data: dict) -> None:
    if not tokens:
        print("[PUSH] sin devices registrados, no se envía nada")
        return
    # categoryId habilita botones de acción en la notificación del sistema (la app
    # registra la categoría con setNotificationCategoryAsync). claude_termino trae
    # el botón "Desactivar avisos".
    categoria = "claude_termino" if data.get("evento") == "claude_termino" else None
    messages = [
        {
            "to": t,
            "title": title,
            "body": body,
            "data": data,
            "sound": "default",
            "priority": "high",
            "channelId": "default",
            **({"categoryId": categoria} if categoria else {}),
        }
        for t in tokens
    ]
    try:
        resp = requests.post(
            EXPO_PUSH_URL,
            json=messages,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            timeout=10,
        )
        print(f"[PUSH] enviado a {len(tokens)} device(s) → HTTP {resp.status_code}: {resp.text[:300]}")
    except Exception as e:
        print(f"[PUSH] error enviando: {type(e).__name__}: {e}")


def _log_aviso(db, tipo: str, title: str, body: str, tenant_id=None, cliente=None, prospect_id=None, detalle=None, sesion_id=None) -> int | None:
    """Persiste el push como Aviso (#42) para que quede en el historial de la app.
    Devuelve el id del aviso creado (para deep-link desde la push) o None si falla.
    `detalle` = conclusión completa (texto largo) que se ve al tocar "Detalle".
    Best-effort: si falla, no rompe el envío."""
    from app.models.aviso import Aviso
    try:
        av = Aviso(tipo=tipo, title=title[:160], body=(body or "")[:2000],
                   tenant_id=tenant_id, cliente=cliente, prospect_id=prospect_id,
                   detalle=(detalle or None) and detalle[:8000],
                   sesion_id=(sesion_id or None) and str(sesion_id)[:64])
        db.add(av)
        db.commit()
        return av.id
    except Exception as e:
        db.rollback()
        print(f"[PUSH] no se pudo guardar el aviso: {type(e).__name__}: {e}")
        return None


def _textos_evento(evento: str, cliente: str, nombre: str, detalle: str | None) -> tuple[str, str]:
    """Arma (title, body) de un evento de cliente. Compartido Plataforma/Etiguel."""
    resumen = (detalle or "").strip()
    if evento == "respuesta":
        return f"💬 Nueva respuesta — {cliente}", f"{nombre} respondió por primera vez"
    if evento == "interesado":
        return f"🔥 Interesado — {cliente}", f"{nombre}" + (f": {resumen[:90]}" if resumen else " se mostró interesado")
    if evento == "mensaje_entrante":
        return f"💬 {cliente} · {nombre}", (resumen[:120] if resumen else "Nuevo mensaje entrante")
    return f"{cliente}", resumen[:120]


def _push_reciente(db, tipo: str, title: str, minutos: int = 5) -> bool:
    """¿Ya se mandó un push del mismo tipo+título hace menos de `minutos`? Sirve para
    no inundar: si el cliente manda 4 mensajes seguidos, el title de mensaje_entrante
    es siempre el mismo (cliente + nombre) → un solo push cada 5 min en vez de 4 (#63).
    Usa el historial de avisos (#42): robusto ante reinicios y multi-worker (vive en
    la DB, no en memoria de proceso)."""
    from datetime import datetime, timedelta, timezone
    from app.models.aviso import Aviso

    corte = datetime.now(timezone.utc) - timedelta(minutes=minutos)
    return (
        db.query(Aviso.id)
        .filter(Aviso.tipo == tipo, Aviso.title == title, Aviso.fecha >= corte)
        .first()
        is not None
    )


def _enviar_evento_filtrado(db, evento: str, title: str, body: str, tenant_id: int,
                            cliente: str | None = None, prospect_id: int | None = None,
                            extra: dict | None = None) -> int:
    """Manda un push de evento de cliente (interesado/respuesta/mensaje_entrante)
    respetando el toggle GLOBAL por evento (#38) Y el toggle POR CLIENTE (#44).
    Sirve para Plataforma y para Etiguel (tenant -1). Persiste aviso. `extra` se
    mergea en el `data` de la push (deep-link: nav + ids). Devuelve a cuántos
    devices se mandó."""
    from app.models.device import Device
    # Debounce de mensaje_entrante (#63): solo este evento "spamea" (un push por
    # mensaje). interesado/respuesta son one-shot por transición, no se debouncean.
    if evento == "mensaje_entrante" and _push_reciente(db, evento, title):
        print(f"[PUSH] debounce: {evento} '{title[:60]}' ya enviado hace <5min, se omite")
        return 0
    permitidos = set(_tokens_para_evento(db, evento))
    tokens = [
        d.expo_token for d in db.query(Device).all()
        if d.expo_token in permitidos and _cliente_evento_ok(db, d.expo_token, tenant_id, evento)
    ]
    # Persistir el aviso ANTES de enviar para incluir su id en la push (deep-link).
    aviso_id = _log_aviso(db, evento, title, body, tenant_id=tenant_id, cliente=cliente, prospect_id=prospect_id) if tokens else None
    data = {"tenant_id": tenant_id, "prospect_id": prospect_id, "evento": evento, "aviso_id": aviso_id}
    if extra:
        data.update(extra)
    _enviar(tokens, title, body, data)
    return len(tokens)


def _notificar_evento(prospect_id: int, tipo: str, detalle: str | None) -> None:
    from app.database import SessionLocal
    from app.models.prospect import Prospect
    from app.models.tenant import Tenant

    # tipo del endpoint → clave de evento de la config
    evento = "respuesta" if tipo == "en_conversacion" else tipo  # interesado / mensaje_entrante / respuesta
    db = SessionLocal()
    try:
        prospect = db.get(Prospect, prospect_id)
        if not prospect:
            return
        tenant = db.get(Tenant, prospect.tenant_id)
        cliente = tenant.nombre if tenant else "Cliente"
        title, body = _textos_evento(evento, cliente, prospect.nombre, detalle)
        # deep-link: abrir la ficha del prospect (ProspectDetail) al tocar
        _enviar_evento_filtrado(db, evento, title, body, prospect.tenant_id, cliente=cliente,
                                prospect_id=prospect_id, extra={"nav": "prospect", "cliente": cliente})
    except Exception as e:
        print(f"[PUSH] error armando notificación: {type(e).__name__}: {e}")
    finally:
        db.close()


def notificar_evento_async(prospect_id: int, tipo: str, detalle: str | None = None) -> None:
    """Dispara la notificación en background (no bloquea el webhook que la origina)."""
    threading.Thread(
        target=_notificar_evento,
        args=(prospect_id, tipo, detalle),
        daemon=True,
    ).start()


# Etiguel vive en Monday, fuera de la tabla `prospects` (tenant sentinela -1).
ETIGUEL_TENANT_ID = -1
ETIGUEL_NOMBRE = "Etiguel"


def _notificar_evento_etiguel(evento: str, nombre: str, detalle: str | None, mirror_id: int | None) -> None:
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        title, body = _textos_evento(evento, ETIGUEL_NOMBRE, nombre or "un lead", detalle)
        # deep-link: abrir el detalle del lead de Etiguel (EtiguelMirrorDetail) por id
        _enviar_evento_filtrado(db, evento, title, body, ETIGUEL_TENANT_ID, cliente=ETIGUEL_NOMBRE,
                                extra={"nav": "etiguel_lead", "mirror_id": mirror_id})
    except Exception as e:
        print(f"[PUSH] error armando evento Etiguel: {type(e).__name__}: {e}")
    finally:
        db.close()


def notificar_evento_etiguel_async(evento: str, nombre: str, detalle: str | None = None,
                                   mirror_id: int | None = None) -> None:
    """Push de un evento de Etiguel (interesado / respuesta / mensaje_entrante),
    respetando los mismos toggles (global + por cliente con tenant -1) que la
    Plataforma. Lo dispara el espejo de Etiguel (#44 diferenciado). `mirror_id` =
    id del registro en etiguel_mirror, para abrir ese lead al tocar la push."""
    threading.Thread(target=_notificar_evento_etiguel, args=(evento, nombre, detalle, mirror_id), daemon=True).start()


def _notificar_error(error_id: int, fuente: str, contenido: str) -> None:
    from app.database import SessionLocal
    from app.models.device import Device

    db = SessionLocal()
    try:
        title = f"⚠️ Error de Camila #{error_id}"
        resumen = (contenido or "").strip().replace("\n", " ")
        body = (f"[{fuente}] " + resumen)[:140] if resumen else f"[{fuente}] error capturado"
        # Alerta global, pero respeta el toggle de evento "error_camila" (#38).
        tokens = _tokens_para_evento(db, "error_camila")
        aviso_id = _log_aviso(db, "error_camila", title, body) if tokens else None
        _enviar(tokens, title, body, {"tipo": "agent_error", "error_id": error_id, "aviso_id": aviso_id, "nav": "error"})
    except Exception as e:
        print(f"[PUSH] error armando alerta de error: {type(e).__name__}: {e}")
    finally:
        db.close()


def notificar_error_async(error_id: int, fuente: str, contenido: str) -> None:
    """Dispara el push de alerta de error en background (no bloquea el ingest)."""
    threading.Thread(target=_notificar_error, args=(error_id, fuente, contenido), daemon=True).start()


def _notificar_consulta(consulta_id: int, fuente: str, telefono: str | None, pregunta: str) -> None:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        marca = "" if (fuente or "etiguel") == "etiguel" else f"[{fuente}] "
        title = f"❓ {marca}Camila no sabe qué contestar"
        resumen = (pregunta or "").strip().replace("\n", " ")
        quien = (telefono or "").strip()
        body = ((f"{quien}: " if quien else "") + resumen)[:140] or "Nueva consulta"
        # Respeta el toggle de evento "consulta_camila" (#38).
        tokens = _tokens_para_evento(db, "consulta_camila")
        aviso_id = _log_aviso(db, "consulta_camila", title, body) if tokens else None
        # deep-link: tocar la push abre DIRECTO la ventana de contestar.
        _enviar(tokens, title, body, {"tipo": "consulta", "consulta_id": consulta_id,
                                      "aviso_id": aviso_id, "nav": "preguntas"})
    except Exception as e:
        print(f"[PUSH] error armando consulta: {type(e).__name__}: {e}")
    finally:
        db.close()


def notificar_consulta_async(consulta_id: int, fuente: str, telefono: str | None, pregunta: str) -> None:
    """Push de una consulta nueva de Camila (no sabe qué responder). Lleva
    `nav:preguntas` + `consulta_id` para que el tap abra directo la ventana de
    contestar. Background (no bloquea el ingest)."""
    threading.Thread(target=_notificar_consulta, args=(consulta_id, fuente, telefono, pregunta), daemon=True).start()


def _notificar_pregunta_claude(pregunta_id: int, header: str | None, pregunta: str,
                               n_opciones: int, n_preguntas: int = 1) -> None:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        marca = f"{header} · " if header else ""
        base_title = "🤔 Claude te pregunta algo" if n_preguntas <= 1 else f"🤔 Claude te hace {n_preguntas} preguntas"
        # Lleva el #N para poder distinguir cada pregunta (mismo número que en la pantalla).
        title = f"{base_title} (#{pregunta_id})"
        resumen = (pregunta or "").strip().replace("\n", " ")
        cola = f" · +{n_preguntas - 1} más" if n_preguntas > 1 else (f" · {n_opciones} opciones" if n_opciones else "")
        body = (marca + resumen)[:140] + cola
        # Respeta el toggle de evento "pregunta_claude" (#38).
        tokens = _tokens_para_evento(db, "pregunta_claude")
        aviso_id = _log_aviso(db, "pregunta_claude", title, body) if tokens else None
        # deep-link: tocar la push abre DIRECTO la pantalla de la pregunta.
        _enviar(tokens, title, body, {"tipo": "pregunta_claude", "pregunta_id": pregunta_id,
                                      "aviso_id": aviso_id, "nav": "pregunta_claude"})
    except Exception as e:
        print(f"[PUSH] error armando pregunta de Claude: {type(e).__name__}: {e}")
    finally:
        db.close()


def notificar_pregunta_claude_async(pregunta_id: int, header: str | None, pregunta: str,
                                    n_opciones: int, n_preguntas: int = 1) -> None:
    """Push de una pregunta (o tanda) nueva de Claude Code (switch ON). Lleva
    `nav:pregunta_claude` + `pregunta_id` para que el tap abra directo la pantalla.
    Background (no bloquea el POST del MCP)."""
    threading.Thread(target=_notificar_pregunta_claude,
                     args=(pregunta_id, header, pregunta, n_opciones, n_preguntas), daemon=True).start()


def _notificar_aviso(title: str, body: str, data: dict, detalle: str | None = None) -> None:
    from app.database import SessionLocal
    from app.models.device import Device

    db = SessionLocal()
    try:
        # Aviso al dueño (primer contacto, consulta de Camila, alertas técnicas):
        # va a TODOS los devices, sin filtro de silencio por cliente.
        tokens = [d.expo_token for d in db.query(Device).all()]
        # `mirror_id` (deep-link a una conversación de Etiguel) se guarda como
        # prospect_id del aviso → el botón "Ver" de la lista de Avisos lo reusa.
        aviso_id = _log_aviso(db, (data or {}).get("tipo", "aviso"), title, body,
                              prospect_id=(data or {}).get("mirror_id"),
                              detalle=detalle) if tokens else None
        _enviar(tokens, title, body, {**(data or {}), "aviso_id": aviso_id})
    except Exception as e:
        print(f"[PUSH] error armando aviso: {type(e).__name__}: {e}")
    finally:
        db.close()


def notificar_aviso_async(title: str, body: str, data: dict | None = None,
                          detalle: str | None = None) -> None:
    """Push genérico de aviso (reemplaza los mails de notificación). Background.
    `detalle` = texto largo opcional (p.ej. reporte completo del smoke) que la
    pantalla de Avisos muestra al tocar "Detalle"; el push solo lleva `body`."""
    threading.Thread(target=_notificar_aviso, args=(title, body, data or {}, detalle),
                     daemon=True).start()


def _notificar_global(evento: str, title: str, body: str, data: dict, detalle=None) -> None:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        tokens = _tokens_para_evento(db, evento)
        aviso_id = _log_aviso(db, evento, title, body, detalle=detalle, sesion_id=data.get("sesion_id")) if tokens else None
        _enviar(tokens, title, body, {**data, "evento": evento, "aviso_id": aviso_id})
    except Exception as e:
        print(f"[PUSH] error armando push global {evento}: {type(e).__name__}: {e}")
    finally:
        db.close()


def notificar_global(evento: str, title: str, body: str, data: dict | None = None, detalle=None) -> int:
    """Push de un evento global (#38): standby / cola_terminada /
    necesita_autorizacion / claude_termino. Respeta el toggle por dispositivo.
    `detalle` = conclusión completa para la pantalla Avisos. SINCRÓNICO (lo llama
    Claude desde un script o el endpoint /admin/notify). Devuelve a cuántos
    devices se mandó."""
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        tokens = _tokens_para_evento(db, evento)
        aviso_id = _log_aviso(db, evento, title, body, detalle=detalle, sesion_id=(data or {}).get("sesion_id")) if tokens else None
        _enviar(tokens, title, body, {**(data or {}), "evento": evento, "aviso_id": aviso_id})
        return len(tokens)
    finally:
        db.close()


def notificar_global_async(evento: str, title: str, body: str, data: dict | None = None, detalle=None) -> None:
    """Versión background de notificar_global (para disparar desde un request)."""
    threading.Thread(target=_notificar_global, args=(evento, title, body, data or {}, detalle), daemon=True).start()


def enviar_prueba() -> int:
    """Manda una notificación de prueba a todos los devices registrados.
    Devuelve a cuántos se envió. Útil para verificar el circuito de push."""
    from app.database import SessionLocal
    from app.models.device import Device

    db = SessionLocal()
    try:
        tokens = [d.expo_token for d in db.query(Device).all()]
        _enviar(tokens, "🔔 Prospia Admin", "Notificación de prueba — ¡funciona! ✓", {"tipo": "test"})
        return len(tokens)
    finally:
        db.close()
