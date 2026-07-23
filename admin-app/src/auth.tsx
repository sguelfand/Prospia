import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";

import * as api from "./api";

const TOKEN_KEY = "admin_token";
const BIOMETRIC_KEY = "biometric_enabled";

interface AuthState {
  token: string | null;
  loading: boolean;            // bootstrap inicial (leyendo SecureStore)
  locked: boolean;             // hay sesión pero requiere desbloqueo biométrico
  biometricSupported: boolean; // el aparato tiene hardware + huella/cara registrada
  biometricEnabled: boolean;   // el usuario activó el ingreso biométrico
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  unlock: () => Promise<boolean>;
  enableBiometric: () => Promise<boolean>;
  disableBiometric: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

function confirmAsync(title: string, message: string, okLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Ahora no", style: "cancel", onPress: () => resolve(false) },
      { text: okLabel, onPress: () => resolve(true) },
    ]);
  });
}

async function checkBiometricSupport(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  return hasHardware && isEnrolled;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  // Espejo del token para que el handler de 401 sepa si ya cerramos sesión
  // (evita disparar el aviso N veces cuando varios requests fallan a la vez).
  const tokenRef = useRef<string | null>(null);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // Sesión vencida/inválida (401 en un request autenticado): cerrar sesión y
  // avisar UNA vez. Mantiene la preferencia de biometría para el re-login.
  useEffect(() => {
    api.setAuthErrorHandler(() => {
      if (tokenRef.current == null) return; // ya cerrada
      tokenRef.current = null;
      SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
      setToken(null);
      setLocked(false);
      Alert.alert("Sesión vencida", "Tu sesión expiró. Volvé a iniciar sesión.");
    });
    return () => api.setAuthErrorHandler(null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const supported = await checkBiometricSupport();
        setBiometricSupported(supported);

        const saved = await SecureStore.getItemAsync(TOKEN_KEY);
        const bioFlag = (await SecureStore.getItemAsync(BIOMETRIC_KEY)) === "1";
        setBiometricEnabled(bioFlag);

        if (saved) {
          setToken(saved);
          // Si hay sesión, biometría activa y el aparato la soporta → arrancar bloqueado
          setLocked(bioFlag && supported);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const enableBiometric = async (): Promise<boolean> => {
    if (!(await checkBiometricSupport())) return false;
    await SecureStore.setItemAsync(BIOMETRIC_KEY, "1");
    setBiometricEnabled(true);
    return true;
  };

  const disableBiometric = async () => {
    await SecureStore.deleteItemAsync(BIOMETRIC_KEY);
    setBiometricEnabled(false);
  };

  const signIn = async (email: string, password: string) => {
    const t = await api.login(email.trim(), password);
    await SecureStore.setItemAsync(TOKEN_KEY, t);

    // Ofrecer activar biometría una sola vez (si el aparato la soporta y no está activa)
    if (biometricSupported && !biometricEnabled) {
      const quiere = await confirmAsync(
        "Ingreso biométrico",
        "¿Querés desbloquear la app con tu huella o rostro la próxima vez?",
        "Activar",
      );
      if (quiere) await enableBiometric();
    }

    setLocked(false);
    setToken(t);
  };

  const unlock = async (): Promise<boolean> => {
    // disableDeviceFallback:true → huella/rostro SOLO, sin el "device credential"
    // (PIN del sistema) como respaldo dentro del prompt. Ese camino de device
    // credential crasheaba la app en el APK v3.0 (SDK 54 + New Architecture).
    // El respaldo real sigue siendo "Usar contraseña" en la LockScreen.
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: "Desbloquear Prospia Admin",
        cancelLabel: "Cancelar",
        disableDeviceFallback: true,
      });
      if (res.success) {
        setLocked(false);
        return true;
      }
      return false;
    } catch {
      // Ante cualquier error del módulo nativo, no dejar propagar (evita cerrar
      // la app): la LockScreen muestra el error y ofrece "Usar contraseña".
      return false;
    }
  };

  const signOut = async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(BIOMETRIC_KEY);
    setToken(null);
    setBiometricEnabled(false);
    setLocked(false);
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        loading,
        locked,
        biometricSupported,
        biometricEnabled,
        signIn,
        signOut,
        unlock,
        enableBiometric,
        disableBiometric,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
