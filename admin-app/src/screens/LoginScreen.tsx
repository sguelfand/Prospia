import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { ApiError } from "../api";
import { useAuth } from "../auth";
import { colors } from "../theme";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setError("Email o contraseña incorrectos.");
      else if (e instanceof ApiError && e.status === 403) setError("Este usuario no es super-admin.");
      else setError(e instanceof Error ? e.message : "Error al iniciar sesión.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Prospia Admin</Text>
        <Text style={styles.subtitle}>Panel de administración</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
          value={email}
          onChangeText={setEmail}
        />
        <View style={styles.passwordWrap}>
          <TextInput
            style={[styles.input, styles.passwordInput]}
            placeholder="Contraseña"
            placeholderTextColor={colors.textDim}
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={onSubmit}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowPassword((v) => !v)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <EyeIcon off={showPassword} />
          </TouchableOpacity>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={loading}
        >
          <Text style={styles.buttonText}>{loading ? "Ingresando…" : "Ingresar"}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// Ojo dibujado con Views (sin librería de íconos → OTA-safe).
// Tono apagado parecido al fondo; lo único que cambia entre estados es la
// línea diagonal sobre el ojo (ojo / ojo tachado).
const EYE_COLOR = "#475569";

function EyeIcon({ off }: { off: boolean }) {
  return (
    <View style={eye.box}>
      <View style={eye.eye}>
        <View style={eye.pupil} />
      </View>
      {off ? <View style={eye.slash} /> : null}
    </View>
  );
}

const eye = StyleSheet.create({
  box: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  eye: {
    width: 22,
    height: 13,
    borderWidth: 1.8,
    borderColor: EYE_COLOR,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  pupil: { width: 5.5, height: 5.5, borderRadius: 3, backgroundColor: EYE_COLOR },
  slash: {
    position: "absolute",
    width: 27,
    height: 1.8,
    borderRadius: 1,
    backgroundColor: EYE_COLOR,
    transform: [{ rotate: "45deg" }],
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, justifyContent: "center", padding: 24 },
  title: { color: colors.text, fontSize: 28, fontWeight: "800", textAlign: "center" },
  subtitle: { color: colors.textDim, fontSize: 15, textAlign: "center", marginBottom: 32 },
  input: {
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 16,
    marginBottom: 12,
  },
  passwordWrap: { position: "relative", justifyContent: "center" },
  passwordInput: { paddingRight: 48 },
  eyeButton: { position: "absolute", right: 14, height: "100%", justifyContent: "center", paddingBottom: 12 },
  error: { color: colors.red, fontSize: 14, marginBottom: 12, textAlign: "center" },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
