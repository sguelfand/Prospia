// Versión del OTA. Se bumpea +1 en cada `eas update` para verificar a simple
// vista si la app ya está corriendo la última versión (se muestra a la derecha
// de "Salir" en el menú). Si el número no coincide con el que avisé en el push,
// hay que cerrar y volver a abrir la app para que baje el OTA nuevo.
export const APP_VERSION = "v13";
