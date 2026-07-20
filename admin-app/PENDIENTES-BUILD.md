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

_(vacío — no hay cambios nativos sin buildear)_

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

### [2026-07-20] modo-voz-sesiones (app v3.0 · appVersion 1.2.0 · apk_latest=3)
- Modo voz de Sesiones: dictado (STT) + lectura (TTS) para hablarle a las sesiones.
- **STT: `expo-speech-recognition ^56.0.1`** (se DESCARTÓ `@react-native-voice/voice`
  porque NO compila con la arquitectura nueva de RN en SDK 54 → Gradle error).
  TTS: `expo-speech ~14.0.8`. Permisos por config plugin (mic + speech).
- app.json version 1.1.0→**1.2.0** (runtimeVersion=appVersion) → los OTA nuevos
  van al runtime 1.2.0. APK_VERSION=3, OTA_VERSION=0 (v3.0). apk_latest=3 seteado
  en el backend (PUT /admin/monitoring/app-version).
- APK: https://expo.dev/artifacts/eas/ycnqWbjaiYHWMF6HUz_WdQIlkZ92NGV0jTjwwB8brLk.apk

### [2026-06-30] calidad-subir-imagen (app v24 · appVersion 1.1.0)
- Adjuntar imagen de la conversación en Nuevo registro de calidad + los 2 "Reportar"
  (EtiguelMirrorDetail y ProspectDetail). `expo-image-picker ~17.0.11` + plugin en app.json.
- Bumpeado `app.json version` 1.0.0 → **1.1.0** (runtimeVersion=appVersion) para que los OTA
  con el picker NO le lleguen al APK viejo (1.0.0) y lo crasheen.
- ⚠️ Tras instalar este APK, los próximos `eas update` van al runtime **1.1.0**.
