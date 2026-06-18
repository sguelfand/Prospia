import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import React, { createContext, useContext, useEffect, useState } from "react";
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
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: "Desbloquear Prospia Admin",
      cancelLabel: "Cancelar",
      disableDeviceFallback: false,
    });
    if (res.success) {
      setLocked(false);
      return true;
    }
    return false;
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
