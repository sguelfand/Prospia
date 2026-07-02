"""Datos semilla del Test LLM: banco de escenarios (los casos de uso de Camila) y
motores default (catálogo MyClaw, el gateway real donde corre Camila).

Los escenarios son guiones cortos de turnos del cliente + qué se espera que Camila
decida. Editable después desde la UI; esto es solo el arranque."""
from __future__ import annotations
import json

# Motores default por OpenRouter (MyClaw está bloqueado por IP desde el backend).
# Precio oficial en $/token: (in, out, cache_read, cache_write). NO se incluye Opus:
# es más caro que Sonnet y Sonnet ya funciona bien → no aporta como candidato.
_OR_BASE = "https://openrouter.ai/api/v1"

MOTORES_DEFAULT = [
    {"nombre": "Sonnet 4.6 — actual", "provider": "openrouter", "model_id": "anthropic/claude-sonnet-4.6",
     "base_url": _OR_BASE, "rate": (3.0e-6, 15.0e-6, 0.30e-6, 3.75e-6), "es_actual": True,
     "notas": "El modelo que usa Camila hoy. Baseline de comparación."},
    {"nombre": "Haiku 4.5", "provider": "openrouter", "model_id": "anthropic/claude-haiku-4.5",
     "base_url": _OR_BASE, "rate": (1.0e-6, 5.0e-6, 0.10e-6, 1.25e-6), "es_actual": False,
     "notas": "3× más barato que Sonnet. Candidato para casos simples."},
    {"nombre": "GPT-5.4", "provider": "openrouter", "model_id": "openai/gpt-5.4",
     "base_url": _OR_BASE, "rate": (2.50e-6, 15.0e-6, 0.0, 0.0), "es_actual": False,
     "notas": "Fallback actual de Camila. Comparación cross-proveedor."},
]

# Escenarios: (slug, nombre, caso_uso, descripcion, guion[list], esperado{dict})
ESCENARIOS: list[tuple] = [
    ("prospeccion_frio", "Prospección fría — interés inicial", "prospeccion",
     "Prospect recibe primer contacto y pregunta por el servicio.",
     ["Hola, ¿qué hacen ustedes exactamente?", "Ah mirá, ¿y hacen telas para camisetas deportivas?"],
     {"conducta": "Presentar Etiguel, explicar sublimación, generar interés sin derivar todavía."}),
    ("prospeccion_precio", "Prospección — pide precio directo", "prospeccion",
     "Prospect pide precio de un producto concreto.",
     ["Hola", "Necesito cotizar 200 metros de tela sublimable de 220g, ¿cuánto sale?"],
     {"conducta": "Cotizar con precio directo (usar sublimacion.md), no decir 'rangos'."}),
    ("lead_recontacto", "Lead recontactado", "lead",
     "Cliente que dejó consulta en la landing y retoma.",
     ["Sí, hola, había consultado hace un tiempo", "¿Me recordás qué hacían? algo de sublimación era"],
     {"conducta": "Retomar sin re-presentar la empresa desde cero, atender la consulta."}),
    ("recontacto_cadencia", "Recontacto de cadencia (silencio)", "recontacto",
     "Cliente que no respondió y reacciona al 2º intento.",
     ["Perdón, se me había pasado tu mensaje", "Contame de nuevo qué ofrecían"],
     {"conducta": "Romper el hielo, retomar la venta sin cambiar de dirección."}),
    ("inbound_directo", "Inbound directo (cliente escribe)", "inbound",
     "Cliente que encontró el número solo y escribe directo.",
     ["Hola! los encontré por la web. Necesito sublimar unas cintas", "¿Qué mínimos manejan?"],
     {"conducta": "Presentarse, atender como vendedora, cotizar/derivar según interés."}),
    ("consulta_no_sabe", "Consulta que no sabe → escalar", "consulta",
     "Cliente pregunta algo fuera del conocimiento de Camila.",
     ["¿Ustedes hacen sublimación sobre poliéster reciclado con certificación GRS?"],
     {"tool": "escalar_consulta", "conducta": "NO inventar; escalar a Sebi."}),
    ("callback_agendado", "Callback agendado (fecha futura)", "callback",
     "Cliente pide ser contactado más adelante.",
     ["Ahora estamos cerrados por vacaciones", "Escribime a fin de mes mejor"],
     {"tool": "agendar_contacto", "conducta": "Agendar la fecha y cerrar amable."}),
    ("redireccionar", "Redirección a otro contacto", "redireccion",
     "El contacto dice que hable con otra persona.",
     ["No, yo no me ocupo de compras", "Hablá con Juan, es el +54 9 11 2234 5678"],
     {"tool": "redireccionar", "conducta": "Ejecutar redirección, NO mandar WhatsApp directo."}),
    ("no_interesa", "No interesa (rechazo claro)", "rechazo",
     "Cliente rechaza sin lugar a dudas.",
     ["No gracias, ya tenemos proveedor hace años y estamos bien"],
     {"tool": "no_interesa", "conducta": "Agradecer breve y frenar, no insistir."}),
    ("interesado", "Interesado (señal de avance)", "interesado",
     "Cliente da señal clara de querer avanzar.",
     ["Perfecto, necesito una cotización formal por 500 metros de tela 220g y coordinar una visita"],
     {"tool": "interesado", "conducta": "Avisar que Delfina lo contacta y derivar."}),
    ("capacidad_propia", "Ya tiene capacidad propia", "rechazo",
     "Cliente menciona que fabrica él mismo.",
     ["Gracias pero nosotros tenemos nuestros propios plotters de sublimación"],
     {"tool": "no_interesa", "conducta": "Tratar como no interesa, no seguir preguntando."}),
    ("pide_humano", "Pide hablar con una persona", "derivacion",
     "Cliente pide un humano directamente.",
     ["Prefiero hablar con una persona de tu equipo, ¿se puede?"],
     {"tool": "interesado", "conducta": "Avisar que Delfina lo contacta."}),
    ("cotizacion_etiquetas", "Cotización de etiquetas", "cotizacion",
     "Cliente pregunta por etiquetas (otro producto).",
     ["¿Hacen etiquetas bordadas en tafeta? necesito 5000 unidades", "¿Precio aproximado?"],
     {"conducta": "Usar etiquetas.md, cotizar precio directo."}),
    ("regateo", "Regateo / pide descuento", "cotizacion",
     "Cliente presiona por precio más bajo.",
     ["Necesito 300 metros de tela 220g", "Está caro, ¿no me hacés un mejor precio?"],
     {"conducta": "Cotizar con criterio; manejar el precio sin regalar margen ni inventar descuentos."}),
    ("mezcla_temas", "Mezcla sublimación + etiquetas", "cotizacion",
     "Cliente pregunta por dos productos a la vez.",
     ["Necesito tela sublimable Y también etiquetas para el mismo pedido, ¿cotizan las dos cosas?"],
     {"conducta": "Distinguir ambos productos, cotizar cada uno con su archivo."}),
    ("cliente_confundido", "Cliente confundido / vago", "prospeccion",
     "Cliente no sabe bien qué necesita.",
     ["Hola, necesito algo para mi marca de ropa pero no sé bien qué", "¿Qué me recomendás?"],
     {"conducta": "Hacer preguntas para entender la necesidad, no cotizar a ciegas."}),
    ("urgencia", "Pedido urgente", "interesado",
     "Cliente con urgencia y volumen.",
     ["Necesito 1000 metros sublimados para la semana que viene, ¿pueden?"],
     {"tool": "interesado", "conducta": "Detectar interés fuerte y derivar rápido a Delfina."}),
    ("fuera_de_rubro", "Pregunta fuera de rubro", "consulta",
     "Cliente pide algo que Etiguel no hace.",
     ["¿Ustedes hacen bordado 3D sobre cuero genuino?"],
     {"tool": "escalar_consulta", "conducta": "No inventar; escalar o aclarar con honestidad."}),
    ("tono_maltrato", "Cliente hostil", "prospeccion",
     "Cliente responde de mala forma.",
     ["¿Otra vez ustedes? dejen de romper con mensajes"],
     {"conducta": "Tono cordial, ofrecer no molestar / frenar sin discutir."}),
    ("datos_empresa", "Pregunta datos de la empresa", "prospeccion",
     "Cliente pide info institucional.",
     ["¿Dónde están ubicados y hace cuánto trabajan?", "¿Facturan A?"],
     {"conducta": "Responder con datos reales del negocio (USER.md/IDENTITY.md), sin inventar."}),
]


def seed_motores(db) -> int:
    from app.models.test_llm import TestLlmMotor
    # Solo sembrar si NO hay ningún motor (primer arranque). Si el usuario borró alguno
    # NO se re-crea (antes se re-seedeaba y los borrados reaparecían).
    if db.query(TestLlmMotor).count() > 0:
        return 0
    creados = 0
    for m in MOTORES_DEFAULT:
        pin, pout, pcr, pcw = m["rate"]
        db.add(TestLlmMotor(
            nombre=m["nombre"], provider=m["provider"], model_id=m["model_id"],
            base_url=m["base_url"], precio_in=pin, precio_out=pout,
            precio_cache_read=pcr, precio_cache_write=pcw,
            es_actual=m["es_actual"], notas=m["notas"], activo=True))
        creados += 1
    db.commit()
    return creados


def seed_escenarios(db) -> int:
    from app.models.test_llm import TestLlmEscenario
    # Igual que motores: solo si la tabla está vacía (respeta borrados/ediciones del usuario).
    if db.query(TestLlmEscenario).count() > 0:
        return 0
    creados = 0
    for i, (slug, nombre, caso, desc, guion, esperado) in enumerate(ESCENARIOS):
        db.add(TestLlmEscenario(
            slug=slug, nombre=nombre, caso_uso=caso, descripcion=desc,
            guion=json.dumps(guion, ensure_ascii=False),
            esperado=json.dumps(esperado, ensure_ascii=False),
            orden=i, activo=True))
        creados += 1
    db.commit()
    return creados
