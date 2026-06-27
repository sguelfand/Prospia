import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NotifEvento, getClienteNotifPrefs, setClienteNotifPref } from "../api";
import { useAuth } from "../auth";
import { getCachedExpoToken } from "../push";
import { ErrorBox, InfoDot, Loader } from "../components/ui";
import { ClienteNotificacionesProps } from "../navigation";
import { colors } from "../theme";

// Config de notificaciones POR CLIENTE (#44): toggles de interesado / primera
// respuesta / cada mensaje entrante para este cliente y dispositivo.
export default function ClienteNotificacionesScreen({ route, navigation }: ClienteNotificacionesProps) {
  const { tenantId, nombre } = route.params;
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const expoToken = getCachedExpoToken();
  const [eventos, setEventos] = useState<NotifEvento[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: nombre });
  }, [navigation, nombre]);

  const load = useCallback(async () => {
    if (!token || !expoToken) { setLoading(false); return; }
    setError(null);
    try {
      const prefs = await getClienteNotifPrefs(token, tenantId, expoToken);
      setEventos(prefs.eventos);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
    }
  }, [token, expoToken, tenantId]);

  useEffect(() => { load(); }, [load]);

  const onToggle = async (evento: string, value: boolean) => {
    if (!token || !expoToken) return;
    setEventos((prev) => prev.map((e) => (e.evento === evento ? { ...e, enabled: value } : e)));
    try {
      await setClienteNotifPref(token, tenantId, expoToken, evento, value);
    } catch {
      setEventos((prev) => prev.map((e) => (e.evento === evento ? { ...e, enabled: !value } : e)));
    }
  };

  if (loading) return <Loader />;

  if (!expoToken) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>Este dispositivo todavía no está registrado para notificaciones.</Text>
      </View>
    );
  }

  const activos = eventos.filter((e) => e.enabled).length;
  const resumen =
    activos === eventos.length ? "Todas las notificaciones activadas"
    : activos === 0 ? "Todas las notificaciones desactivadas"
    : `${activos} de ${eventos.length} activadas`;

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
      {error ? <ErrorBox message={error} onRetry={load} /> : null}
      <Text style={styles.resumen}>{resumen}</Text>
      <View style={styles.divider} />
      <View style={styles.card}>
        {eventos.map((e, i) => (
          <View key={e.evento} style={[styles.row, i > 0 && styles.rowBorder]}>
            {e.descripcion ? <InfoDot titulo={e.label} descripcion={e.descripcion} /> : null}
            <Text style={styles.label}>{e.label}</Text>
            <Switch
              value={e.enabled}
              onValueChange={(v) => onToggle(e.evento, v)}
              trackColor={{ false: colors.cardAlt, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
        ))}
      </View>
      <Text style={styles.hint}>Estas preferencias son para este cliente en este dispositivo. «Cada mensaje entrante» arranca apagado.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  resumen: { color: colors.text, fontSize: 15, fontWeight: "700", marginBottom: 12 },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: 16 },
  card: { backgroundColor: colors.card, borderRadius: 14, paddingHorizontal: 16 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  label: { color: colors.text, fontSize: 15, flex: 1, marginLeft: 10, marginRight: 12 },
  hint: { color: colors.textDim, fontSize: 12, marginTop: 14, lineHeight: 17 },
  empty: { color: colors.textDim, fontSize: 14, textAlign: "center", margin: 24 },
});
