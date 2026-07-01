// Versión de la app con semántica vAPK.OTA (se muestra a la derecha de "Salir"):
//   - APK_VERSION: el build NATIVO (APK). Sube +1 SOLO cuando se hace un APK nuevo
//     (dep nativa, app.json, etc.). En ese build hay que bumpear TAMBIÉN app.json
//     `version` (runtime gating) y el apk_version del backend
//     (PUT /admin/monitoring/app-version) para que la app avise "hay APK nuevo".
//   - OTA_VERSION: el update over-the-air. Sube +1 en cada `eas update` y se
//     RESETEA a 0 cuando sale un APK nuevo.
// Así, mirando el número: el 1er número dice qué APK tenés (si no es el último,
// hay que reinstalar), el 2º dice si bajaste el último OTA (si no coincide con el
// que avisé, cerrá y reabrí la app).
export const APK_VERSION = 2;
export const OTA_VERSION = 4;
export const APP_VERSION = `v${APK_VERSION}.${OTA_VERSION}`;
