import * as Updates from "expo-updates";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "../theme";
import { Icon } from "./Icon";

/**
 * Aviso flotante (abajo) cuando hay una versión OTA nueva publicada distinta de
 * la que está corriendo. El botón "Actualizar ahora" baja el update y recarga la
 * app en el acto (fetch + reload), así no hay que cerrar/reabrir varias veces.
 * Solo aparece en builds reales (Updates.isEnabled); en dev/Expo Go no hace nada.
 */
export default function UpdateBanner() {
  const insets = useSafeAreaInsets();
  const { isUpdatePending } = Updates.useUpdates();
  const [disponible, setDisponible] = useState(false);
  const [oculto, setOculto] = useState(false);
  const [actualizando, setActualizando] = useState(false);

  // Chequear con el servidor si hay un OTA nuevo al abrir.
  useEffect(() => {
    if (!Updates.isEnabled) return;
    let cancelado = false;
    (async () => {
      try {
        const res = await Updates.checkForUpdateAsync();
        if (!cancelado && res.isAvailable) setDisponible(true);
      } catch {
        /* sin red / error: no molestar */
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  // Si el update ya se bajó solo en background, también corresponde avisar.
  useEffect(() => {
    if (isUpdatePending) setDisponible(true);
  }, [isUpdatePending]);

  const actualizar = async () => {
    setActualizando(true);
    try {
      if (!isUpdatePending) await Updates.fetchUpdateAsync();
      await Updates.reloadAsync(); // recarga con el update aplicado (no vuelve de acá)
    } catch {
      setActualizando(false);
      Alert.alert(
        "No se pudo actualizar",
        "Probá cerrando y volviendo a abrir la app un par de veces.",
      );
    }
  };

  if (!disponible || oculto) return null;

  return (
    <View style={[styles.wrap, { bottom: insets.bottom + 12 }]} pointerEvents="box-none">
      <View style={styles.banner}>
        <Icon name="refresh" size={18} color={colors.primary} />
        <Text style={styles.texto}>Hay una versión nueva de la app.</Text>
        <TouchableOpacity
          style={styles.cta}
          onPress={actualizar}
          disabled={actualizando}
          accessibilityLabel="Actualizar la app ahora"
        >
          {actualizando ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Text style={styles.ctaText}>Actualizar ahora</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.cerrar}
          onPress={() => setOculto(true)}
          disabled={actualizando}
          accessibilityLabel="Ocultar aviso de versión"
        >
          <Text style={styles.cerrarText}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  texto: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "600" },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minWidth: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { color: colors.onPrimary, fontSize: 14, fontWeight: "700" },
  cerrar: { paddingHorizontal: 4, paddingVertical: 4 },
  cerrarText: { color: colors.textDim, fontSize: 16, fontWeight: "700" },
});
