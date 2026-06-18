import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useAuth } from "../auth";
import { colors } from "../theme";

export default function LockScreen() {
  const { unlock, signOut } = useAuth();
  const [error, setError] = useState(false);

  const intentar = async () => {
    setError(false);
    const ok = await unlock();
    if (!ok) setError(true);
  };

  // Dispara el prompt biométrico apenas se muestra la pantalla.
  useEffect(() => {
    intentar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.lock}>🔒</Text>
      <Text style={styles.title}>Prospia Admin</Text>
      <Text style={styles.subtitle}>Sesión bloqueada</Text>

      <TouchableOpacity style={styles.button} onPress={intentar}>
        <Text style={styles.buttonText}>Desbloquear con huella / rostro</Text>
      </TouchableOpacity>

      {error ? <Text style={styles.error}>No se pudo verificar. Probá de nuevo.</Text> : null}

      <TouchableOpacity onPress={signOut} style={styles.linkButton}>
        <Text style={styles.link}>Usar contraseña</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 },
  lock: { fontSize: 56, marginBottom: 16 },
  title: { color: colors.text, fontSize: 26, fontWeight: "800" },
  subtitle: { color: colors.textDim, fontSize: 15, marginTop: 4, marginBottom: 32 },
  button: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 24, alignItems: "center" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  error: { color: colors.red, fontSize: 14, marginTop: 16, textAlign: "center" },
  linkButton: { marginTop: 24 },
  link: { color: colors.textDim, fontSize: 15, fontWeight: "600" },
});
