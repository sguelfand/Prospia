"""Esquema del relevamiento de cliente (intake).

Fuente ÚNICA de verdad de las secciones y campos que:
  (a) renderiza el formulario público `relevamiento-<slug>.html`, y
  (b) renderiza la sección "Información del negocio" en la Configuración del
      cliente (editable).

El backend expone este esquema en `GET /public/intake-schema` (para el form) y
lo embebe en `GET /me/info-negocio` (para la config). Así, si mañana hay que
agregar o cambiar un campo, se toca SOLO acá.

Cada campo: id (clave estable en `info_negocio.values`), label, tipo, oblig,
ayuda, y opciones (para select/multiselect). `tipo == "archivo"` se maneja
aparte (multipart) y no se guarda en `values`.

Tipos soportados por el front: text, textarea, select, multiselect, email, tel,
url, number, archivo.

`en_config`: si la sección se muestra (editable) en la Configuración del cliente.
La sección de control ("quién completa") queda fuera de la config."""

SECCIONES = [
    {
        "id": "empresa",
        "titulo": "La empresa",
        "descripcion": "Datos generales del negocio.",
        "en_config": True,
        "campos": [
            {"id": "nombre_comercial", "label": "Nombre comercial / marca", "tipo": "text", "oblig": True, "ayuda": "Cómo te conoce el mercado"},
            {"id": "razon_social", "label": "Razón social", "tipo": "text", "oblig": False},
            {"id": "cuit", "label": "CUIT", "tipo": "text", "oblig": False},
            {"id": "sitio_web", "label": "Sitio web", "tipo": "url", "oblig": False, "ayuda": "Dejar vacío si no tienen"},
            {"id": "instagram", "label": "Instagram", "tipo": "url", "oblig": False},
            {"id": "linkedin", "label": "LinkedIn (empresa)", "tipo": "url", "oblig": False},
            {"id": "facebook", "label": "Facebook", "tipo": "url", "oblig": False},
            {"id": "otras_redes", "label": "Otras redes / catálogo online", "tipo": "text", "oblig": False, "ayuda": "Ej: tienda Mercado Libre, catálogo de WhatsApp"},
            {"id": "pais", "label": "País de operación", "tipo": "select", "oblig": True, "opciones": ["Argentina", "Uruguay", "Chile", "Paraguay", "Otro"]},
            {"id": "provincias", "label": "Provincia/s donde operan", "tipo": "textarea", "oblig": True, "ayuda": "Listá las provincias o regiones"},
            {"id": "direccion", "label": "Dirección física principal", "tipo": "text", "oblig": False, "ayuda": "Showroom / depósito / oficina"},
            {"id": "telefono_empresa", "label": "Teléfono de la empresa", "tipo": "tel", "oblig": False},
            {"id": "email_empresa", "label": "Email general de la empresa", "tipo": "email", "oblig": False},
            {"id": "horario", "label": "Horario de atención", "tipo": "text", "oblig": False, "ayuda": "Ej: Lun-Vie 9-18, Sáb 9-13"},
            {"id": "antiguedad", "label": "Antigüedad de la empresa (años)", "tipo": "number", "oblig": False},
            {"id": "empleados", "label": "Cantidad de empleados", "tipo": "select", "oblig": False, "opciones": ["1-5", "6-20", "21-50", "50+"]},
        ],
    },
    {
        "id": "producto",
        "titulo": "Qué venden",
        "descripcion": "Producto / servicio y propuesta de valor.",
        "en_config": True,
        "campos": [
            {"id": "que_vende", "label": "En una frase, ¿qué vende la empresa?", "tipo": "text", "oblig": True, "ayuda": "Ej: Equipamiento sanitario y de obra para construcción B2B"},
            {"id": "descripcion_negocio", "label": "Descripción ampliada del negocio", "tipo": "textarea", "oblig": True, "ayuda": "Contanos en detalle qué hacen y a quién le venden"},
            {"id": "categorias", "label": "Categorías de producto que ofrecen", "tipo": "textarea", "oblig": True, "ayuda": "Ej: griferías, sanitarios, caños, bombas, herramientas…"},
            {"id": "productos_estrella", "label": "Productos / líneas estrella (lo que más venden)", "tipo": "textarea", "oblig": True, "ayuda": "Los 5-10 que más mueven"},
            {"id": "marcas", "label": "Marcas que representan / distribuyen", "tipo": "textarea", "oblig": False},
            {"id": "propuesta_valor", "label": "¿Por qué te compran a vos? (propuesta de valor)", "tipo": "textarea", "oblig": True, "ayuda": "Precio, stock, entrega, asesoramiento, cuenta corriente…"},
            {"id": "diferenciales", "label": "Diferenciales vs. la competencia", "tipo": "textarea", "oblig": True},
            {"id": "modalidad", "label": "¿Venden mayorista, minorista o ambos?", "tipo": "select", "oblig": True, "opciones": ["Mayorista", "Minorista", "Ambos"]},
            {"id": "ticket_promedio", "label": "Ticket promedio de venta", "tipo": "text", "oblig": False, "ayuda": "Rango aproximado"},
            {"id": "minimo_compra", "label": "Mínimo de compra (si aplica)", "tipo": "text", "oblig": False},
            {"id": "zona_cobertura", "label": "Zona de cobertura / entrega", "tipo": "textarea", "oblig": True, "ayuda": "Dónde entregan, si envían al interior, etc."},
        ],
    },
    {
        "id": "cliente_ideal",
        "titulo": "Cliente ideal",
        "descripcion": "Esto es lo que MÁS nos sirve para filtrar a quién contactar. Pensá en tus mejores clientes actuales: cuanto más preciso, mejor calificamos los prospects.",
        "en_config": True,
        "campos": [
            {"id": "a_quien_vende", "label": "¿A qué tipo de empresa/persona le vendés?", "tipo": "textarea", "oblig": True, "ayuda": "Ej: corralones, plomeros, constructoras, estudios de arquitectura, ferreterías…"},
            {"id": "tipos_ordenados", "label": "Tipos de cliente ordenados por importancia", "tipo": "textarea", "oblig": True, "ayuda": "Del que más te interesa al que menos"},
            {"id": "rubros_mejores", "label": "Rubros/industrias de tus MEJORES clientes", "tipo": "textarea", "oblig": True},
            {"id": "tamano_ideal", "label": "Tamaño de cliente ideal", "tipo": "multiselect", "oblig": True, "opciones": ["Unipersonal", "PyME chica", "PyME mediana", "Grande"]},
            {"id": "zonas_prioritarias", "label": "Zonas geográficas prioritarias", "tipo": "textarea", "oblig": True, "ayuda": "Dónde están tus mejores clientes / dónde querés crecer"},
            {"id": "senales_buen_candidato", "label": "Señales de que un prospect es buen candidato", "tipo": "textarea", "oblig": True, "ayuda": "Ej: tiene local a la calle, obra en curso, compra recurrente, +X empleados"},
            {"id": "senales_compra", "label": "Señales de compra / urgencia a detectar", "tipo": "textarea", "oblig": False, "ayuda": "Ej: está construyendo, renovó local, publicó búsqueda de materiales"},
            {"id": "alta_prioridad", "label": "¿Qué hace que un prospect sea ALTA prioridad?", "tipo": "textarea", "oblig": True, "ayuda": "El cliente ideal puro"},
            {"id": "media_prioridad", "label": "¿Qué lo hace prioridad MEDIA?", "tipo": "textarea", "oblig": False, "ayuda": "Sirve pero no es perfecto"},
            {"id": "baja_prioridad", "label": "¿Qué lo hace prioridad BAJA?", "tipo": "textarea", "oblig": False, "ayuda": "Contactable pero poco probable"},
            {"id": "no_contactar", "label": "¿A quién NO querés contactar nunca?", "tipo": "textarea", "oblig": True, "ayuda": "Ej: consumidor final, competidores, otros rubros"},
            {"id": "competidores", "label": "Competidores directos (para excluirlos)", "tipo": "textarea", "oblig": False, "ayuda": "Nombres o tipos de empresa a descartar"},
            {"id": "clientes_ideales_ejemplos", "label": "Describí 3 clientes \"ideales\" reales", "tipo": "textarea", "oblig": True, "ayuda": "Casos concretos (sin datos sensibles): nos enseñan el patrón a buscar"},
        ],
    },
    {
        "id": "busqueda",
        "titulo": "Dónde y cómo buscar prospects",
        "descripcion": "Para configurar el scraper.",
        "en_config": True,
        "campos": [
            {"id": "como_buscarias_google", "label": "¿Cómo buscarías en Google a un cliente tuyo?", "tipo": "textarea", "oblig": True, "ayuda": "Las palabras que vos pondrías. Ej: \"corralón zona oeste\", \"plomería matriculada CABA\""},
            {"id": "rubros_directorios", "label": "Rubros tal como aparecen en directorios / Google Maps", "tipo": "textarea", "oblig": True, "ayuda": "Cómo se categorizan tus clientes en Maps"},
            {"id": "zonas_primero", "label": "Zonas / localidades a scrapear primero", "tipo": "textarea", "oblig": True},
            {"id": "idioma_busqueda", "label": "Idioma de búsqueda", "tipo": "select", "oblig": False, "opciones": ["Español", "Inglés", "Portugués"]},
            {"id": "excluir_scraping", "label": "Tipos de empresa a EXCLUIR del scraping", "tipo": "textarea", "oblig": False, "ayuda": "Ej: grandes cadenas, retail de consumidor final"},
            {"id": "volumen_calidad", "label": "¿Buscás volumen o calidad?", "tipo": "select", "oblig": False, "opciones": ["Volumen", "Equilibrio", "Solo muy calificados"]},
            {"id": "directorios", "label": "¿Hay listados/directorios donde están tus clientes?", "tipo": "textarea", "oblig": False, "ayuda": "Cámaras, asociaciones, ferias del rubro"},
        ],
    },
    {
        "id": "outreach",
        "titulo": "Outreach: tono y mensajes",
        "descripcion": "Cómo se comunica el agente con los prospects.",
        "en_config": True,
        "campos": [
            {"id": "agente_nombre", "label": "¿Con qué nombre se presenta el agente?", "tipo": "text", "oblig": False, "ayuda": "Si lo dejás vacío usamos \"Camila\""},
            {"id": "empresa_nombre_msg", "label": "¿Cómo se nombra a la empresa en el mensaje?", "tipo": "text", "oblig": True, "ayuda": "Ej: \"te escribo de Saposnik\""},
            {"id": "tono", "label": "Tono de comunicación deseado", "tipo": "select", "oblig": True, "opciones": ["Cercano / informal", "Profesional / cordial", "Formal", "Técnico"]},
            {"id": "tratamiento", "label": "Tratamiento", "tipo": "select", "oblig": True, "opciones": ["Vos", "Usted"]},
            {"id": "destacar", "label": "Cosas que SÍ querés que destaque en el primer contacto", "tipo": "textarea", "oblig": True},
            {"id": "nunca_decir", "label": "Cosas que el agente NUNCA debe decir/prometer", "tipo": "textarea", "oblig": True, "ayuda": "Ej: no dar precios sin confirmar, no prometer plazos"},
            {"id": "gancho", "label": "¿Querés un descuento / gancho de primer contacto?", "tipo": "textarea", "oblig": False, "ayuda": "Ej: 10% primera compra, envío gratis primer pedido"},
            {"id": "presentacion_2lineas", "label": "Borrador de cómo presentarías tu empresa en 2 líneas", "tipo": "textarea", "oblig": False, "ayuda": "Nos sirve de base para los mensajes"},
            {"id": "canales", "label": "Canales de contacto a usar", "tipo": "multiselect", "oblig": True, "opciones": ["WhatsApp", "Email"]},
            {"id": "email_comercial", "label": "Email comercial para outreach (si usan Email)", "tipo": "email", "oblig": False},
        ],
    },
    {
        "id": "faq",
        "titulo": "Objeciones, FAQ y datos para el bot",
        "descripcion": "Lo que el agente necesita para responder bien.",
        "en_config": True,
        "campos": [
            {"id": "preguntas_frecuentes", "label": "Preguntas frecuentes de tus clientes + respuestas", "tipo": "textarea", "oblig": True, "ayuda": "Las 10 que más te hacen, con la respuesta"},
            {"id": "objeciones", "label": "Objeciones típicas y cómo las respondés", "tipo": "textarea", "oblig": True, "ayuda": "Ej: \"está caro\" → … / \"ya tengo proveedor\" → …"},
            {"id": "precios_bot", "label": "Precios o rangos que el bot PUEDE informar", "tipo": "textarea", "oblig": False, "ayuda": "Qué puede decir y qué no"},
            {"id": "formas_pago", "label": "Formas de pago", "tipo": "multiselect", "oblig": True, "opciones": ["Efectivo", "Transferencia", "Tarjeta", "Cuenta corriente", "Cheque", "Financiación"]},
            {"id": "cuenta_corriente", "label": "¿Ofrecés cuenta corriente / financiación? Condiciones", "tipo": "textarea", "oblig": False},
            {"id": "plazos_entrega", "label": "Plazos y costos de entrega", "tipo": "textarea", "oblig": False},
            {"id": "showroom", "label": "¿Tenés showroom para visitar?", "tipo": "text", "oblig": False},
            {"id": "devoluciones", "label": "Política de devoluciones / garantía", "tipo": "textarea", "oblig": False},
            {"id": "datos_no_revelar", "label": "Datos que el bot NO debe revelar", "tipo": "textarea", "oblig": False},
        ],
    },
    {
        "id": "handoff",
        "titulo": "Handoff: cuando un prospect se interesa",
        "descripcion": "Qué pasa cuando alguien muestra interés.",
        "en_config": True,
        "campos": [
            {"id": "deriva_nombre", "label": "Cuando alguien se interesa, ¿a quién se le pasa?", "tipo": "text", "oblig": True, "ayuda": "Nombre de la persona que sigue el lead"},
            {"id": "deriva_whatsapp", "label": "WhatsApp de esa persona", "tipo": "tel", "oblig": True},
            {"id": "deriva_email", "label": "Email de esa persona", "tipo": "email", "oblig": False},
            {"id": "notif_canal", "label": "¿Por dónde le avisamos cuando hay un interesado?", "tipo": "select", "oblig": True, "opciones": ["WhatsApp", "Email"], "ayuda": "Le mandamos el aviso al WhatsApp o email de arriba, según lo que elijas"},
            {"id": "info_para_seguir", "label": "¿Qué info necesita esa persona para seguir el lead?", "tipo": "textarea", "oblig": False},
            {"id": "horario_contacto", "label": "Horario en que se puede contactar prospects", "tipo": "text", "oblig": False, "ayuda": "Ej: 10 a 18 hs"},
            {"id": "crm", "label": "¿Usás algún CRM hoy?", "tipo": "text", "oblig": False, "ayuda": "Monday, HubSpot, Excel…"},
        ],
    },
    {
        "id": "archivos",
        "titulo": "Archivos",
        "descripcion": "Subí todo lo que tengas: cuanto más nos des, mejor entendemos tu cliente ideal y antes arrancamos.",
        "en_config": True,
        "campos": [
            {"id": "f_catalogo", "label": "Catálogo de productos", "tipo": "archivo", "oblig": False, "multiple": True},
            {"id": "f_lista_precios", "label": "Lista de precios", "tipo": "archivo", "oblig": False, "multiple": True},
            {"id": "f_base_contactos", "label": "Base de contactos actual (muestra o completa)", "tipo": "archivo", "oblig": False, "multiple": True, "ayuda": "Aunque sea una muestra: nos enseña el perfil real de cliente"},
            {"id": "f_logo", "label": "Logo (alta resolución)", "tipo": "archivo", "oblig": False, "multiple": True},
            {"id": "f_casos_exito", "label": "Casos de éxito / clientes destacados", "tipo": "archivo", "oblig": False, "multiple": True},
            {"id": "f_marketing", "label": "Material de marketing existente", "tipo": "archivo", "oblig": False, "multiple": True, "ayuda": "Folletos, presentaciones, fotos de productos"},
            {"id": "f_conversaciones", "label": "Conversaciones reales de venta (capturas / export)", "tipo": "archivo", "oblig": False, "multiple": True, "ayuda": "Oro puro para calibrar el tono y las objeciones del bot"},
            {"id": "f_plantillas", "label": "Plantillas / mensajes que ya usás para contactar", "tipo": "archivo", "oblig": False, "multiple": True},
        ],
    },
    {
        "id": "operativa",
        "titulo": "Algo más",
        "descripcion": "Cualquier cosa que debamos saber antes de arrancar.",
        "en_config": True,
        "campos": [
            {"id": "observaciones", "label": "Observaciones / cualquier cosa que debamos saber", "tipo": "textarea", "oblig": False},
        ],
    },
]


def secciones_publicas() -> list:
    """Esquema completo para el formulario público de relevamiento."""
    return SECCIONES


def secciones_config() -> list:
    """Solo las secciones que se editan desde la Configuración del cliente
    (excluye la sección de control 'quién completa')."""
    return [s for s in SECCIONES if s.get("en_config")]
