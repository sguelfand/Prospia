# Inventario de funciones de la web Prospia — base para tests visuales

## Estado de cobertura (act. 2026-06-30)
- ✅ **Login** (form, válido, inválido, ruta protegida) — `login.spec.ts`
- ✅ **Carga/render de TODA pantalla**: N2 (dashboard, prospects, términos, config,
  preguntas) — `navegacion.spec.ts`; N1 (dashboard comparativa, admin-clientes,
  pendientes, errores, preguntas, monitoreo servicios/tokens/calidad) — `admin.spec.ts`
  (con el superadmin de prueba `qa-admin`).
- ✅ **Dashboard N2 KPIs** — `dashboard.spec.ts`. **Visual regression** de prospects/
  términos/config — `visual.spec.ts`.
- ⏳ **Pendiente (capa de acciones)**: cada botón/form/filtro individual (buscar,
  filtrar, clasificar, agregar/borrar término, toggles, etc.). Se agregan por la
  regla "feature nueva → su test" + grinding. N2 = interacción real sobre `qa-test`;
  N1 = sin ejecutar escrituras que toquen datos reales de prod.

Total a la fecha: **25 tests verdes** (corrida #2 en el Historial).

---


Fuente: relevamiento automático del frontend (`src/pages` + `src/components`) y
backend (`app/routers`). Cada "función" = una acción de usuario con efecto
observable. Sirve como registro de Pendientes/Realizados de la pantalla
**Test visuales**. (N1 = superadmin, N2 = cliente.)

> Conteo granular total ≈ **365** micro-acciones. Para tests, se agrupan en
> **funciones accionables** (se excluyen hovers/tooltips/display puro y
> auto-guardados, que se verifican como parte de la acción que los dispara).

## 1. Login (público)
- Ingresar usuario / contraseña
- Mostrar/ocultar contraseña (ojo)
- Entrar (login válido)
- Login inválido → no entra
- Ruta protegida sin sesión → redirige a /login

## 2. Layout / global (N1 y N2)
- Navegar por cada item del menú (Dashboard, Prospects, Términos, Preguntas,
  Configuración; N1 además: Monitoreo/Servicios·Tokens·Calidad, Pendientes,
  Errores, Admin clientes, Testing/Visuales·Motores LLM)
- Desplegar/colapsar grupo "Monitoreo"
- Desplegar/colapsar grupo "Testing" (Visuales + Motores LLM)
- Colapsar/expandir sidebar
- Cerrar sesión (Salir)
- Cambiar tema light/dark
- Ver como un cliente (selector, solo N1) / Volver a admin (banner)
- Reportar error (N2)
- Abrir asistente flotante de ayuda (N2)

## 3. Dashboard cliente (N2)
- KPIs clickeables → van a Prospects filtrado (Prospects generados, En
  conversación, Interesados, Tasa de respuesta, Tasa de conversión)
- Gráfico por término → click "Encontrados / En conversación / Interesados"
- Pie por estado (Este mes / Total) → click sector y leyenda
- Evolución histórica → click en tooltip
- Widgets: arrastrar, redimensionar, renombrar (guardar/cancelar), resetear layout

## 4. Dashboard comparativa (N1)
- KPIs totales (display)
- "ver detalle →" de tokens
- Click en barra / fila de tabla → impersonar cliente
- Widgets (igual que cliente)

## 5. Prospects (N2)
- Buscar por nombre/email/web
- Filtrar por estado
- Quitar chip de mes
- Selector de columnas (toggle visibilidad)
- Seleccionar uno / todos + "Contactar X seleccionados"
- Por prospect: Contactar, Chat, Historial, cambiar clasificación + verificar,
  cambiar estado
- Clasificación (popover): cambiar nivel, agregar detalle, guardar/cerrar
- Paginación (anterior/siguiente)
- Panel Historial: abrir/cerrar, agregar entrada, editar, guardar, cancelar,
  eliminar, cambiar tipo/detalle/fecha
- Panel Conversación: abrir/cerrar, ver hilo
- (Desktop) redimensionar columnas

## 6. Términos (N2)
- Agregar término (botón / Enter)
- Ir a Prospects por "X encontrados" / "X interesados"
- Scrapear (Play) + ver estado
- Eliminar término

## 7. Configuración (N1 y N2)
- Perfil: editar nombre/usuario, guardar
- Cambiar contraseña (actual, nueva, repetir, ojo, guardar)
- Info del Negocio (N2): expandir, editar campos, auto-guardar
- Notificaciones push (N1): expandir, toggle por evento/dispositivo
- Inicializar prueba (N1): abrir, teléfono, confirmar y limpiar, cancelar

## 8. Admin clientes (N1)
- Seleccionar cliente
- Cliente y acceso: editar nombre/contacto/usuario/contraseña, guardar, reset a default
- Contacto y envío: toggle auto, máx/día, hora inicio/fin, delay
- Mensajes rotativos: editar, agregar, eliminar
- Cadencia: días 1→2→3, máx contactos, días cancelar
- Inicializar prueba per-cliente
- Info del negocio (igual que cliente)

## 9. Pendientes (N1)
- Filtros: estado (Pendientes/Hechas/Todas), área (App/Web/Etiguel/Todas),
  orden (Fecha/Prioridad), vista (Por áreas / Todas juntas)
- Nuevo pendiente (modal con todos los campos) + guardar/cancelar
- Por pendiente: abrir/cerrar detalle, marcar realizado, reabrir, copiar, editar,
  borrar, sacar de cola
- Lote: seleccionar, procesar, eliminar, cancelar
- Cola en proceso: volver a la cola, confirmar, rechazar, ver/ocultar conclusión

## 10. Errores de Camila (N1)
- Tabs: Nuevos / Reportados / Fixed
- Por error: quitar reporte, reabrir, borrar (el botón **Reportar** se sacó: ahora
  se manda a la cola con Seleccionar → Procesar)
- **Detalle**: si el error tiene transcripción de imagen, botón "Detalle" que la
  abre/cierra (la lista muestra solo la descripción)
- **Cargar error a mano**: cuadro de texto + adjuntar/pegar imagen (Ctrl+V, se
  transcribe con Haiku → queda en `detalle`) → cae en la cola de errores — ✅ `errores.spec.ts`
- **Seleccionar + Procesar** (cola FIFO, igual que Pendientes): tildar varios,
  Procesar, recuadro "Procesando" con barrita — ✅ `errores.spec.ts`
- Cola en proceso: confirmar (Fixed), rechazar (vuelve a la cola), volver a la cola
  (standby), ver/ocultar conclusión — ✅ `errores.spec.ts` (flujo API)

## 11. Preguntas / consultas escaladas (N1 y N2)
- Tabs: Pendientes / Contestadas
- Modo selección: activar/cancelar, seleccionar, eliminar seleccionadas
- Abrir/cerrar detalle
- Contestar (pendiente), borrar (contestada)

## 12. Monitoreo / Servicios (N1)
- Re-chequear todo / individual
- Cambiar frecuencia de chequeo automático
- Guardia semántica de Camila: **interruptor (switch)** on/off — `admin.spec.ts`

## 13. Monitoreo / Tokens (N1)
- Selector cliente/General + definir por defecto
- Recalcular hoy (cliente)
- Drill-down de día (click día), expandir/colapsar conversación
- Widgets (igual que Dashboard)
- Chip de fuente (API Anthropic / OpenClaw) **abajo a la derecha** del widget (no tapa el título)
- Costos internos: hover discriminado por función → "Histórico mensual" (barras
  apiladas, panel con monto por función) y "Participación por función" (donut, panel
  con costo + % de la función)
- **"Costos diarios"** (widget `costoDia`): barras apiladas por día = Mensajes (ámbar)
  + Errores (rojo) + Gastos internos (Anthropic, azul). 3 tildes en el header para
  prender/apagar cada serie; el total y la escala se recalculan con lo visible — ✅ `tokens.spec.ts`

## 14. Monitoreo / Calidad (N1)
- Selector cliente/Etiguel + definir por defecto
- Aprendizajes: consolidar, ver/ocultar bloque, aprobar, descartar
- Tabs: Nuevas / Revisadas
- Por revisión: expandir conversación, agregar nota, marcar bien/mal, borrar
- Por revisión: **"Es error de Camila, pero ya lo resolví"** (resuelto directo) →
  queda 'acierto' (suma a la calibración del especialista) pero NO entra a la cola
  de Aprendizajes (no re-inyecta al prompt de Camila). Test API: `calidad.spec.ts`

## 15. Testing / Visuales (N1)
- Antes "Test visuales"; ahora vive bajo el grupo desplegable **Testing**.
- Historial de corridas Playwright (render, expandir corrida, detalle por test).
- Ruta nueva `/testing/visuales` (la vieja `/test-visuales` redirige). Test: `testing.spec.ts`

## 16. Testing / Motores LLM (N1) — banco de pruebas de motores
- Ver estado: sobre reconstruido de OpenClaw vivo (modelo actual, tamaño del prompt,
  archivos), keys por proveedor, switch del gate.
- **Gate**: habilitar/bloquear "Correr" (OFF por default; correr consume tokens).
- Motores: listar, agregar (nombre/model_id/base_url/provider/rate-card/api_key), borrar.
- Escenarios: ver banco (los casos de uso de Camila), desplegar detalle.
- Nueva comparación: elegir motores + escenarios, **Estimar costo** (no gasta),
  **Correr comparación** (deshabilitado hasta habilitar el gate).
- Resultados (tablero movible): gráfico calidad por motor, gráfico costo por motor,
  tabla escenario×motor, modal de transcript por celda.
- **Comparar**: tildar 2+ motores del ranking → vista lado a lado.
- **Ver veredicto** (conclusión final del juez): tildá motores del ranking (o ninguno = todos)
  → botón "Ver veredicto (N)" marca la corrida en **procesando** (animación) sin gastar tokens;
  la conclusión la genera Claude en sesión con el **plan Pro** (`aplicar_conclusion` por SSH) y
  aparece sola en el recuadro arriba del ranking (qué motor usar y por qué, sobre el subconjunto
  tildado). Solo visible si la corrida está juzgada (estado `lista`). Endpoint `pedir-conclusion`.
- Test: `testing.spec.ts` (carga, submenú, gate: Estimar siempre disponible + el botón
  Correr y el aviso reflejan el estado real del switch global `test_llm_habilitado`; Resultados
  muestran Comparar y —si la corrida está juzgada— "Ver veredicto").
  ⚠️ El test NO corre comparaciones reales ni toca el switch (respeta el gate global).

---

## Notas para el runner
- Tests de escritura → acotarlos al tenant de prueba `qa-test` (aislado) para no
  ensuciar datos reales. N1 (admin) puede impersonar qa-test para ejercer N2.
- Funciones de bot/webhook (`/ingest/*`, marca interesado/no-interesa) NO se
  prueban por UI; se simulan por API si hace falta dejar un prospect en cierto estado.
- Visual regression: una foto por pantalla clave (ya hecho para 4; extender al resto).
