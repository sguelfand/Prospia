# Pendientes de BUILD (no salieron por OTA)

Acá se **acumulan** los cambios que tocan lo nativo y por lo tanto NO pueden
publicarse por `eas update` (OTA): necesitan `eas build` + reinstalar el APK.
Claude NO buildea solo: junta acá y espera el "dale" de Sebi para hacer
**un solo build** con todo lo acumulado.

## Qué cae acá (requiere build, no OTA)
- Dependencia con código nativo (instalar / cambiar / sacar). Ej: `react-native-svg`,
  `reanimated`, `gesture-handler`.
- Cambios en `app.json` / `eas.json`: nombre, ícono, splash, permisos, `scheme`, plugins.
- Subir versión del SDK de Expo.
- Cambios de push / FCM (`google-services.json`).
- Permisos del sistema nuevos.
- Fuentes nuevas vía plugin nativo / cualquier cosa que el binario instalado no tenga.

Regla: si cambia el **binario nativo** → va acá. Si es solo JS/TS/estilos/lógica → OTA directo.

---

## Cola actual (pendiente de build)

### [2026-07-19] modo-voz-sesiones
- **Qué:** Modo voz de la pantalla Sesiones (Etapa 2): STT + TTS para hablar con
  la asistente que maneja las sesiones de Claude. La UI ya viajó por OTA v2.15
  con guard: hasta este build muestra "necesita el próximo APK".
- **Por qué necesita build:** deps nativas `@react-native-voice/voice` (micrófono,
  + config plugin en app.json → permiso RECORD_AUDIO) y `expo-speech ~14.0.8`.
- **Al buildear:** bumpear `app.json version` (runtimeVersion) + APK_VERSION=3 /
  OTA_VERSION=0 en src/version.ts + avisar el apk_version al backend.
- **Sesión:** branch app/2026-07-19-voz

<!--
Formato de cada item:

### [AAAA-MM-DD] slug-corto
- **Qué:** descripción
- **Por qué necesita build:** (dep nativa / app.json / etc.)
- **Commit(s):** abc1234
- **Sesión:** branch app/AAAA-MM-DD-slug
-->

---

## Historial de builds hechos
_(cuando se hace un build, mover acá los items con la fecha y la URL del APK)_

### [2026-06-30] calidad-subir-imagen (app v24 · appVersion 1.1.0)
- Adjuntar imagen de la conversación en Nuevo registro de calidad + los 2 "Reportar"
  (EtiguelMirrorDetail y ProspectDetail). `expo-image-picker ~17.0.11` + plugin en app.json.
- Bumpeado `app.json version` 1.0.0 → **1.1.0** (runtimeVersion=appVersion) para que los OTA
  con el picker NO le lleguen al APK viejo (1.0.0) y lo crasheen.
- ⚠️ Tras instalar este APK, los próximos `eas update` van al runtime **1.1.0**.
