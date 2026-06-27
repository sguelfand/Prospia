import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NotifEvento, getNotifPrefs, setNotifPref } from "../api";
import { useAuth } from "../auth";
import { getCachedExpoToken } from "../push";
import { ErrorBox, InfoDot, Loader } from "../components/ui";
import { colors } from "../theme";

// Notificaciones push por evento, para ESTE dispositivo (#38). Se llega desde
// Configuración → Notificaciones.
export default function NotificacionesScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const expoToken = getCachedExpoToken();
  const [eventos, setEventos] = useState<NotifEvento[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !expoToken) { setLoading(false); return; }
    setError(null);
    try {
      const prefs = await getNotifPrefs(token, expoToken);
      setEventos(prefs.eventos);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, expoToken]);

  useEffect(() => { load(); }, [load]);

  const onToggle = async (evento: string, value: boolean) => {
    if (!token || !expoToken) return;
    setEventos((prev) => prev.map((e) => (e.evento === evento ? { ...e, enabled: value } : e)));
    try {
      await setNotifPref(token, expoToken, evento, value);
    } catch {
      setEventos((prev) => prev.map((e) => (e.evento === evento ? { ...e, enabled: !value } : e)));
    }
  };

  if (loading) return <Loader />;

  if (!expoToken) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>
          Este dispositivo todavía no está registrado para notificaciones. Reabrí la app con sesión
          iniciada y dale permiso de notificaciones.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
      }
    >
      {error ? <ErrorBox message={error} onRetry={load} /> : null}
      <Text style={styles.intro}>Elegí qué avisos te llegan a este dispositivo.</Text>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  intro: { color: colors.textDim, fontSize: 13, marginBottom: 14 },
  card: { backgroundColor: colors.card, borderRadius: 14, paddingHorizontal: 16 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  label: { color: colors.text, fontSize: 15, flex: 1, marginLeft: 10, marginRight: 12 },
  empty: { color: colors.textDim, fontSize: 14, textAlign: "center", margin: 24 },
});
