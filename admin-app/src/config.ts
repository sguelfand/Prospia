import Constants from "expo-constants";

/**
 * URL del backend FastAPI de Prospia.
 *
 * En dev el backend corre en tu Mac en el puerto 8000, pero el celular NO puede
 * usar "localhost" (eso apunta al propio teléfono). Hay que poner la IP de tu Mac
 * en la red local, ej. http://192.168.1.42:8000
 *
 * Se configura en app.json -> expo.extra.apiUrl (así no se toca código).
 * Para sacar la IP de la Mac: System Settings > Wi-Fi > Details, o `ipconfig getifaddr en0`.
 */
const fromExtra = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;

export const API_URL = fromExtra ?? "http://localhost:8000";
