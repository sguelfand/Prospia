import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { registerDevice } from "./api";

// Cómo se comporta una notificación cuando la app está EN PRIMER PLANO.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function getProjectId(): string | undefined {
  // El projectId (de Expo/EAS) es necesario para obtener el push token.
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

// Último expo token obtenido. Lo necesita el interruptor de push por cliente
// (APP.4) para identificar este device ante el backend.
let cachedExpoToken: string | null = null;

export function getCachedExpoToken(): string | null {
  return cachedExpoToken;
}

/** Devuelve el expo token de este device (cacheado o pidiéndolo). null si no se
 *  puede (emulador / sin projectId). No rompe la app. */
export async function getExpoTokenAsync(): Promise<string | null> {
  if (cachedExpoToken) return cachedExpoToken;
  try {
    if (!Device.isDevice) return null;
    const projectId = getProjectId();
    const resp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    cachedExpoToken = resp.data;
    return cachedExpoToken;
  } catch {
    return null;
  }
}

/**
 * Pide permiso, obtiene el push token de Expo y lo registra en el backend.
 * Es tolerante a fallos: si algo no está (emulador, sin permiso, sin projectId)
 * NO rompe la app, solo loguea. El resto de la app funciona igual.
 */
export async function registerForPush(authToken: string): Promise<void> {
  try {
    if (!Device.isDevice) {
      console.log("[push] las notificaciones push necesitan un dispositivo físico");
      return;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Avisos",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") {
      console.log("[push] permiso de notificaciones no otorgado");
      return;
    }

    const projectId = getProjectId();
    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const expoToken = tokenResp.data;
    cachedExpoToken = expoToken;
    console.log("[push] expo token:", expoToken);

    await registerDevice(authToken, expoToken, Platform.OS);
    console.log("[push] device registrado en el backend");
  } catch (e) {
    console.log("[push] no se pudo registrar para push:", e instanceof Error ? e.message : e);
  }
}
