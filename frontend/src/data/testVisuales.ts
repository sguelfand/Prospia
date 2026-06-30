// Registro de funciones de la web Prospia para los TESTS VISUALES.
// ─────────────────────────────────────────────────────────────────────────
// Es la FUENTE DE VERDAD de la pantalla "Test visuales":
//   • Pendientes  = TODAS las funciones (las que aún no tienen test).
//   • Realizados  = las que ya tienen un test (cubierto: true).
// Cuando se escribe un test para una función, se marca `cubierto: true` y se
// anota `archivoTest`. La función NO se borra: pasa a Realizados y queda
// marcada también en la vista completa.
//
// Fuente del inventario: e2e/INVENTARIO-FUNCIONES.md
// Nivel: 'publico' | 1 (superadmin) | 2 (cliente). 'ambos' = 1 y 2.

export type NivelTest = "publico" | 1 | 2 | "ambos";

export type FuncionTest = {
  id: string;
  pantalla: string;
  nivel: NivelTest;
  nombre: string;
  /** Qué hace y cómo se dispara (lo que el test verifica al "apretar el botón"). */
  descripcion: string;
  cubierto: boolean;
  /** Spec de Playwright que la cubre (si cubierto). */
  archivoTest?: string;
};

/** Orden de las pantallas en la UI. */
export const PANTALLAS_ORDEN: string[] = [
  "Login",
  "Navegación / global",
  "Dashboard (cliente)",
  "Dashboard (comparativa)",
  "Prospects",
  "Términos",
  "Configuración",
  "Admin clientes",
  "Pendientes",
  "Errores",
  "Preguntas",
  "Monitoreo · Servicios",
  "Monitoreo · Tokens",
  "Monitoreo · Calidad",
];

export const FUNCIONES_TEST: FuncionTest[] = [
  // ── Login ────────────────────────────────────────────────────────────────
  { id: "login.form", pantalla: "Login", nivel: "publico", nombre: "Formulario de login visible", descripcion: "En /login se ven los campos Usuario y Contraseña y el botón Entrar.", cubierto: true, archivoTest: "login.spec.ts" },
  { id: "login.ok", pantalla: "Login", nivel: "publico", nombre: "Login válido entra al dashboard", descripcion: "Con usuario y contraseña correctos, Entrar lleva al /dashboard.", cubierto: true, archivoTest: "login.spec.ts" },
  { id: "login.invalido", pantalla: "Login", nivel: "publico", nombre: "Login inválido no entra", descripcion: "Con contraseña incorrecta queda en /login y no autentica.", cubierto: true, archivoTest: "login.spec.ts" },
  { id: "login.protegida", pantalla: "Login", nivel: "publico", nombre: "Ruta protegida sin sesión redirige", descripcion: "Entrar a /prospects sin sesión redirige a /login.", cubierto: true, archivoTest: "login.spec.ts" },
  { id: "login.toggle-pwd", pantalla: "Login", nivel: "publico", nombre: "Mostrar/ocultar contraseña", descripcion: "El ojo alterna entre ver y ocultar la contraseña.", cubierto: false },

  // ── Navegación / global ───────────────────────────────────────────────────
  { id: "nav.dashboard", pantalla: "Navegación / global", nivel: "ambos", nombre: "Ir a Dashboard", descripcion: "El item Dashboard del menú abre /dashboard.", cubierto: true, archivoTest: "navegacion.spec.ts" },
  { id: "nav.prospects", pantalla: "Navegación / global", nivel: 2, nombre: "Ir a Prospects", descripcion: "El item Prospects del menú abre /prospects (click real desde el menú).", cubierto: true, archivoTest: "navegacion.spec.ts" },
  { id: "nav.terminos", pantalla: "Navegación / global", nivel: 2, nombre: "Ir a Términos", descripcion: "El item Términos del menú abre /terminos.", cubierto: true, archivoTest: "navegacion.spec.ts" },
  { id: "nav.preguntas", pantalla: "Navegación / global", nivel: "ambos", nombre: "Ir a Preguntas", descripcion: "El item Preguntas del menú abre /preguntas.", cubierto: true, archivoTest: "navegacion.spec.ts" },
  { id: "nav.configuracion", pantalla: "Navegación / global", nivel: "ambos", nombre: "Ir a Configuración", descripcion: "El item Configuración del menú abre /configuracion.", cubierto: true, archivoTest: "navegacion.spec.ts" },
  { id: "nav.monitoreo-toggle", pantalla: "Navegación / global", nivel: 1, nombre: "Desplegar grupo Monitoreo", descripcion: "El grupo Monitoreo del menú se despliega/colapsa.", cubierto: false },
  { id: "nav.mon-servicios", pantalla: "Navegación / global", nivel: 1, nombre: "Ir a Monitoreo · Servicios", descripcion: "Abre /monitoreo/servicios.", cubierto: false },
  { id: "nav.mon-tokens", pantalla: "Navegación / global", nivel: 1, nombre: "Ir a Monitoreo · Tokens", descripcion: "Abre /monitoreo/tokens.", cubierto: false },
  { id: "nav.mon-calidad", pantalla: "Navegación / global", nivel: 1, nombre: "Ir a Monitoreo · Calidad", descripcion: "Abre /monitoreo/calidad.", cubierto: false },
  { id: "nav.pendientes", pantalla: "Navegación / global", nivel: 1, nombre: "Ir a Pendientes", descripcion: "Abre /pendientes.", cubierto: false },
  { id: "nav.errores", pantalla: "Navegación / global", nivel: 1, nombre: "Ir a Errores", descripcion: "Abre /errores.", cubierto: false },
  { id: "nav.admin-clientes", pantalla: "Navegación / global", nivel: 1, nombre: "Ir a Admin clientes", descripcion: "Abre /admin-clientes.", cubierto: false },
  { id: "nav.sidebar-colapsar", pantalla: "Navegación / global", nivel: "ambos", nombre: "Colapsar/expandir sidebar", descripcion: "El botón de chevron colapsa y expande el menú lateral.", cubierto: false },
  { id: "global.logout", pantalla: "Navegación / global", nivel: "ambos", nombre: "Cerrar sesión", descripcion: "Salir borra la sesión y vuelve a /login.", cubierto: false },
  { id: "global.tema", pantalla: "Navegación / global", nivel: "ambos", nombre: "Cambiar tema claro/oscuro", descripcion: "El toggle de tema cambia entre claro y oscuro.", cubierto: false },
  { id: "global.ver-como", pantalla: "Navegación / global", nivel: 1, nombre: "Ver como un cliente", descripcion: "El selector impersona a un cliente y entra como él.", cubierto: false },
  { id: "global.volver-admin", pantalla: "Navegación / global", nivel: 1, nombre: "Volver a admin", descripcion: "Durante la impersonación, el banner vuelve al superadmin.", cubierto: false },
  { id: "global.reportar-error", pantalla: "Navegación / global", nivel: 2, nombre: "Reportar error", descripcion: "El botón abre el asistente que reporta un bug.", cubierto: false },
  { id: "global.asistente", pantalla: "Navegación / global", nivel: 2, nombre: "Asistente flotante de ayuda", descripcion: "El botón flotante abre la ayuda contextual.", cubierto: false },

  // ── Dashboard (cliente) ────────────────────────────────────────────────────
  { id: "dash.kpis", pantalla: "Dashboard (cliente)", nivel: 2, nombre: "KPIs del dashboard cargan", descripcion: "Se ven Prospects generados, Tasa de respuesta y Tasa de conversión.", cubierto: true, archivoTest: "dashboard.spec.ts" },
  { id: "dash.kpi-navega", pantalla: "Dashboard (cliente)", nivel: 2, nombre: "KPI navega a Prospects filtrado", descripcion: "Click en una KPI lleva a Prospects con ese filtro aplicado.", cubierto: false },
  { id: "dash.grafico-termino", pantalla: "Dashboard (cliente)", nivel: 2, nombre: "Gráfico por término navega", descripcion: "Click en el panel de un término lleva a Prospects de ese término.", cubierto: false },
  { id: "dash.pie-estado", pantalla: "Dashboard (cliente)", nivel: 2, nombre: "Pie por estado navega", descripcion: "Click en un sector/leyenda del pie filtra Prospects por estado.", cubierto: false },
  { id: "dash.evolucion", pantalla: "Dashboard (cliente)", nivel: 2, nombre: "Evolución histórica navega", descripcion: "Click en el tooltip de la línea lleva a Prospects de ese mes.", cubierto: false },
  { id: "dash.widget-mover", pantalla: "Dashboard (cliente)", nivel: 2, nombre: "Arrastrar widget", descripcion: "Agarrar el grip y reordenar un widget; el layout se guarda.", cubierto: false },
  { id: "dash.widget-resize", pantalla: "Dashboard (cliente)", nivel: 2, nombre: "Redimensionar widget", descripcion: "Agrandar/achicar un widget desde la esquina.", cubierto: false },
  { id: "dash.widget-renombrar", pantalla: "Dashboard (cliente)", nivel: 2, nombre: "Renombrar widget", descripcion: "Click en el título, editar y guardar el nuevo nombre.", cubierto: false },
  { id: "dash.widget-reset", pantalla: "Dashboard (cliente)", nivel: 2, nombre: "Resetear layout", descripcion: "↺ Reordenar vuelve al orden y títulos originales.", cubierto: false },
  { id: "dash.visual", pantalla: "Dashboard (cliente)", nivel: 2, nombre: "Captura visual del dashboard", descripcion: "Screenshot de referencia. Pendiente: el tablero movible (react-grid-layout) corre el layout unos píxeles entre corridas y hace inestable la comparación; falta un enfoque robusto (enmascarar o congelar el grid).", cubierto: false },

  // ── Dashboard (comparativa, N1) ─────────────────────────────────────────────
  { id: "dashadmin.kpis", pantalla: "Dashboard (comparativa)", nivel: 1, nombre: "KPIs totales cargan", descripcion: "La vista de superadmin muestra los totales agregados de clientes.", cubierto: false },
  { id: "dashadmin.detalle-tokens", pantalla: "Dashboard (comparativa)", nivel: 1, nombre: "Ver detalle de tokens", descripcion: "El link 'ver detalle →' abre el detalle de costos.", cubierto: false },
  { id: "dashadmin.impersonar", pantalla: "Dashboard (comparativa)", nivel: 1, nombre: "Click en cliente impersona", descripcion: "Click en una barra/fila de un cliente entra como ese cliente.", cubierto: false },
  { id: "dashadmin.widgets", pantalla: "Dashboard (comparativa)", nivel: 1, nombre: "Widgets (mover/resize/renombrar/reset)", descripcion: "Tablero movible igual que el del cliente.", cubierto: false },

  // ── Prospects (N2) ──────────────────────────────────────────────────────────
  { id: "prospects.lista", pantalla: "Prospects", nivel: 2, nombre: "Lista de prospects carga", descripcion: "La pantalla Prospects abre y muestra la lista paginada.", cubierto: true, archivoTest: "navegacion.spec.ts" },
  { id: "prospects.visual", pantalla: "Prospects", nivel: 2, nombre: "Captura visual de Prospects", descripcion: "Screenshot de referencia de la lista.", cubierto: true, archivoTest: "visual.spec.ts" },
  { id: "prospects.buscar", pantalla: "Prospects", nivel: 2, nombre: "Buscar por nombre/email/web", descripcion: "El buscador filtra la lista por texto.", cubierto: false },
  { id: "prospects.filtro-estado", pantalla: "Prospects", nivel: 2, nombre: "Filtrar por estado", descripcion: "El dropdown de estado filtra los prospects.", cubierto: false },
  { id: "prospects.quitar-mes", pantalla: "Prospects", nivel: 2, nombre: "Quitar filtro de mes", descripcion: "El chip 'Mes: X ✕' remueve el filtro de mes.", cubierto: false },
  { id: "prospects.columnas", pantalla: "Prospects", nivel: 2, nombre: "Selector de columnas", descripcion: "Mostrar/ocultar columnas de la tabla (desktop).", cubierto: false },
  { id: "prospects.seleccion-lote", pantalla: "Prospects", nivel: 2, nombre: "Selección múltiple", descripcion: "Seleccionar uno/todos con los checkboxes.", cubierto: false },
  { id: "prospects.contactar-lote", pantalla: "Prospects", nivel: 2, nombre: "Contactar seleccionados", descripcion: "Contactar X seleccionados desde la barra superior.", cubierto: false },
  { id: "prospects.contactar", pantalla: "Prospects", nivel: 2, nombre: "Contactar un prospect", descripcion: "El botón Contactar inicia el contacto de ese prospect.", cubierto: false },
  { id: "prospects.chat", pantalla: "Prospects", nivel: 2, nombre: "Abrir conversación", descripcion: "El botón Chat abre el panel con el hilo de WhatsApp.", cubierto: false },
  { id: "prospects.historial", pantalla: "Prospects", nivel: 2, nombre: "Abrir historial", descripcion: "El botón Historial abre el panel con el timeline.", cubierto: false },
  { id: "prospects.clasificar", pantalla: "Prospects", nivel: 2, nombre: "Cambiar clasificación", descripcion: "Asignar ALTO/MEDIO/BAJO + detalle desde el popover.", cubierto: false },
  { id: "prospects.verificar-clasif", pantalla: "Prospects", nivel: 2, nombre: "Verificar clasificación", descripcion: "Marcar la clasificación como verificada.", cubierto: false },
  { id: "prospects.cambiar-estado", pantalla: "Prospects", nivel: 2, nombre: "Cambiar estado", descripcion: "Cambiar el estado del prospect desde la tabla.", cubierto: false },
  { id: "prospects.paginar", pantalla: "Prospects", nivel: 2, nombre: "Paginación", descripcion: "Ir a página anterior/siguiente.", cubierto: false },
  { id: "prospects.hist-agregar", pantalla: "Prospects", nivel: 2, nombre: "Agregar entrada de historial", descripcion: "Crear una entrada manual en el historial.", cubierto: false },
  { id: "prospects.hist-editar", pantalla: "Prospects", nivel: 2, nombre: "Editar entrada de historial", descripcion: "Editar y guardar una entrada del historial.", cubierto: false },
  { id: "prospects.hist-eliminar", pantalla: "Prospects", nivel: 2, nombre: "Eliminar entrada de historial", descripcion: "Borrar una entrada del historial (con confirmación).", cubierto: false },

  // ── Términos (N2) ────────────────────────────────────────────────────────────
  { id: "terminos.lista", pantalla: "Términos", nivel: 2, nombre: "Lista de términos carga", descripcion: "La pantalla Términos abre y muestra los términos.", cubierto: true, archivoTest: "navegacion.spec.ts" },
  { id: "terminos.visual", pantalla: "Términos", nivel: 2, nombre: "Captura visual de Términos", descripcion: "Screenshot de referencia.", cubierto: true, archivoTest: "visual.spec.ts" },
  { id: "terminos.agregar", pantalla: "Términos", nivel: 2, nombre: "Agregar término", descripcion: "Escribir un término y Agregar (o Enter) lo crea.", cubierto: false },
  { id: "terminos.ir-prospects", pantalla: "Términos", nivel: 2, nombre: "Ir a Prospects por término", descripcion: "Click en 'X encontrados/interesados' filtra Prospects.", cubierto: false },
  { id: "terminos.scrapear", pantalla: "Términos", nivel: 2, nombre: "Scrapear término", descripcion: "El botón Play inicia el scraper y muestra el estado.", cubierto: false },
  { id: "terminos.eliminar", pantalla: "Términos", nivel: 2, nombre: "Eliminar término", descripcion: "Borrar un término (con confirmación).", cubierto: false },

  // ── Configuración (ambos) ──────────────────────────────────────────────────
  { id: "config.visual", pantalla: "Configuración", nivel: "ambos", nombre: "Captura visual de Configuración", descripcion: "Screenshot de referencia.", cubierto: true, archivoTest: "visual.spec.ts" },
  { id: "config.perfil", pantalla: "Configuración", nivel: "ambos", nombre: "Editar perfil", descripcion: "Editar nombre/usuario y Guardar.", cubierto: false },
  { id: "config.cambiar-pwd", pantalla: "Configuración", nivel: "ambos", nombre: "Cambiar contraseña", descripcion: "Actual + nueva + repetir → Cambiar contraseña.", cubierto: false },
  { id: "config.negocio", pantalla: "Configuración", nivel: 2, nombre: "Editar info del negocio", descripcion: "Editar los campos del negocio (auto-guardado).", cubierto: false },
  { id: "config.push", pantalla: "Configuración", nivel: 1, nombre: "Toggle notificaciones push", descripcion: "Activar/desactivar eventos de push por dispositivo.", cubierto: false },
  { id: "config.init-prueba", pantalla: "Configuración", nivel: 1, nombre: "Inicializar prueba", descripcion: "Abrir, cargar teléfono y Confirmar y limpiar.", cubierto: false },

  // ── Admin clientes (N1) ──────────────────────────────────────────────────────
  { id: "admincli.seleccionar", pantalla: "Admin clientes", nivel: 1, nombre: "Seleccionar cliente", descripcion: "El dropdown carga la config del cliente elegido.", cubierto: false },
  { id: "admincli.acceso", pantalla: "Admin clientes", nivel: 1, nombre: "Editar y guardar acceso", descripcion: "Editar nombre/usuario/contraseña y Guardar.", cubierto: false },
  { id: "admincli.reset-pwd", pantalla: "Admin clientes", nivel: 1, nombre: "Reset de contraseña", descripcion: "Resetear la contraseña a la default (12345).", cubierto: false },
  { id: "admincli.envio", pantalla: "Admin clientes", nivel: 1, nombre: "Config de contacto/envío", descripcion: "Toggle auto, tope/día, horas y delay.", cubierto: false },
  { id: "admincli.mensajes", pantalla: "Admin clientes", nivel: 1, nombre: "Mensajes rotativos", descripcion: "Editar, agregar y eliminar plantillas.", cubierto: false },
  { id: "admincli.cadencia", pantalla: "Admin clientes", nivel: 1, nombre: "Cadencia de re-contacto", descripcion: "Días entre intentos, máx contactos, días cancelar.", cubierto: false },
  { id: "admincli.init-prueba", pantalla: "Admin clientes", nivel: 1, nombre: "Inicializar prueba per-cliente", descripcion: "Cargar teléfono y Confirmar y borrar.", cubierto: false },
  { id: "admincli.info-negocio", pantalla: "Admin clientes", nivel: 1, nombre: "Info del negocio del cliente", descripcion: "Editar la info de negocio del cliente.", cubierto: false },

  // ── Pendientes (N1) ──────────────────────────────────────────────────────────
  { id: "pend.filtros-estado", pantalla: "Pendientes", nivel: 1, nombre: "Filtrar por estado", descripcion: "Chips Pendientes/Hechas/Todas.", cubierto: false },
  { id: "pend.filtros-area", pantalla: "Pendientes", nivel: 1, nombre: "Filtrar por área", descripcion: "Chips App/Web/Etiguel/Todas las áreas.", cubierto: false },
  { id: "pend.orden", pantalla: "Pendientes", nivel: 1, nombre: "Ordenar y vista", descripcion: "Orden por fecha/prioridad y vista agrupada/junta.", cubierto: false },
  { id: "pend.nuevo", pantalla: "Pendientes", nivel: 1, nombre: "Crear pendiente", descripcion: "Modal Nuevo con todos los campos → Guardar.", cubierto: false },
  { id: "pend.detalle", pantalla: "Pendientes", nivel: 1, nombre: "Abrir/cerrar detalle", descripcion: "Expandir la descripción de un pendiente.", cubierto: false },
  { id: "pend.realizado", pantalla: "Pendientes", nivel: 1, nombre: "Marcar realizado / reabrir", descripcion: "Marcar un pendiente como hecho y reabrirlo.", cubierto: false },
  { id: "pend.editar", pantalla: "Pendientes", nivel: 1, nombre: "Editar / copiar / borrar", descripcion: "Editar, copiar al portapapeles y borrar un pendiente.", cubierto: false },
  { id: "pend.cola", pantalla: "Pendientes", nivel: 1, nombre: "Cola: encolar/procesar", descripcion: "Sacar de cola, procesar en lote, confirmar/rechazar.", cubierto: false },

  // ── Errores (N1) ──────────────────────────────────────────────────────────────
  { id: "errores.tabs", pantalla: "Errores", nivel: 1, nombre: "Tabs Nuevos/Reportados/Fixed", descripcion: "Filtrar errores por estado.", cubierto: false },
  { id: "errores.reportar", pantalla: "Errores", nivel: 1, nombre: "Reportar / quitar reporte", descripcion: "Marcar un error como reportado y revertirlo.", cubierto: false },
  { id: "errores.reabrir", pantalla: "Errores", nivel: 1, nombre: "Reabrir error fixed", descripcion: "Reabrir un error marcado como fixed.", cubierto: false },
  { id: "errores.borrar", pantalla: "Errores", nivel: 1, nombre: "Borrar error", descripcion: "Borrar un error (con confirmación).", cubierto: false },

  // ── Preguntas / consultas (ambos) ──────────────────────────────────────────
  { id: "preguntas.lista", pantalla: "Preguntas", nivel: "ambos", nombre: "Lista de preguntas carga", descripcion: "La pantalla Preguntas abre con sus tabs.", cubierto: true, archivoTest: "navegacion.spec.ts" },
  { id: "preguntas.tabs", pantalla: "Preguntas", nivel: "ambos", nombre: "Tabs Pendientes/Contestadas", descripcion: "Filtrar entre pendientes y contestadas.", cubierto: false },
  { id: "preguntas.seleccion", pantalla: "Preguntas", nivel: "ambos", nombre: "Selección múltiple + eliminar", descripcion: "Modo selección para borrar varias preguntas.", cubierto: false },
  { id: "preguntas.detalle", pantalla: "Preguntas", nivel: "ambos", nombre: "Abrir detalle", descripcion: "Abrir el modal de una pregunta.", cubierto: false },
  { id: "preguntas.contestar", pantalla: "Preguntas", nivel: "ambos", nombre: "Contestar pregunta", descripcion: "Escribir respuesta y Contestar (relaya a Camila).", cubierto: false },
  { id: "preguntas.borrar", pantalla: "Preguntas", nivel: "ambos", nombre: "Borrar pregunta contestada", descripcion: "Borrar una pregunta ya contestada.", cubierto: false },

  // ── Monitoreo · Servicios (N1) ──────────────────────────────────────────────
  { id: "monsvc.recheck-todo", pantalla: "Monitoreo · Servicios", nivel: 1, nombre: "Re-chequear todo", descripcion: "Fuerza el chequeo de todos los servicios.", cubierto: false },
  { id: "monsvc.recheck-uno", pantalla: "Monitoreo · Servicios", nivel: 1, nombre: "Re-chequear un servicio", descripcion: "Fuerza el chequeo de un servicio puntual.", cubierto: false },
  { id: "monsvc.frecuencia", pantalla: "Monitoreo · Servicios", nivel: 1, nombre: "Cambiar frecuencia", descripcion: "Cambiar la frecuencia del chequeo automático.", cubierto: false },

  // ── Monitoreo · Tokens (N1) ──────────────────────────────────────────────────
  { id: "montok.selector", pantalla: "Monitoreo · Tokens", nivel: 1, nombre: "Selector cliente/General", descripcion: "Cambiar entre General y un cliente; definir por defecto.", cubierto: false },
  { id: "montok.recalcular", pantalla: "Monitoreo · Tokens", nivel: 1, nombre: "Recalcular hoy", descripcion: "Recalcular la auditoría del día (cliente).", cubierto: false },
  { id: "montok.drilldown", pantalla: "Monitoreo · Tokens", nivel: 1, nombre: "Drill-down de un día", descripcion: "Click en un día abre el detalle de conversaciones.", cubierto: false },
  { id: "montok.expandir-conv", pantalla: "Monitoreo · Tokens", nivel: 1, nombre: "Expandir conversación", descripcion: "Abrir/cerrar el detalle de una conversación.", cubierto: false },
  { id: "montok.widgets", pantalla: "Monitoreo · Tokens", nivel: 1, nombre: "Widgets del tablero", descripcion: "Mover/redimensionar/renombrar/resetear widgets.", cubierto: false },

  // ── Monitoreo · Calidad (N1) ─────────────────────────────────────────────────
  { id: "moncal.selector", pantalla: "Monitoreo · Calidad", nivel: 1, nombre: "Selector cliente/Etiguel", descripcion: "Cambiar la fuente a revisar; definir por defecto.", cubierto: false },
  { id: "moncal.aprendizajes", pantalla: "Monitoreo · Calidad", nivel: 1, nombre: "Aprendizajes (consolidar/aprobar/descartar)", descripcion: "Consolidar lecciones, ver bloque, aprobar o descartar.", cubierto: false },
  { id: "moncal.tabs", pantalla: "Monitoreo · Calidad", nivel: 1, nombre: "Tabs Nuevas/Revisadas", descripcion: "Filtrar las revisiones por estado.", cubierto: false },
  { id: "moncal.revisar", pantalla: "Monitoreo · Calidad", nivel: 1, nombre: "Revisar (bien/mal + nota)", descripcion: "Expandir conversación, anotar y marcar bien/mal.", cubierto: false },
  { id: "moncal.borrar", pantalla: "Monitoreo · Calidad", nivel: 1, nombre: "Borrar revisión", descripcion: "Borrar una revisión (con confirmación).", cubierto: false },
];
