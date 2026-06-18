import React, { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { AgentError, getErrores, resolverError } from "../api";
import { useAuth } from "../auth";
import { ErrorBox, Loader } from "../components/ui";
import { ErroresProps } from "../navigation";
import { colors } from "../theme";

export default function ErroresScreen(_props: ErroresProps) {
  const { token } = useAuth();
  const [errores, setErrores] = useState<AgentError[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setErrores(await getErrores(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (err: AgentError) => {
    if (!token) return;
    const nuevo = !err.resuelto;
    setErrores((prev) => prev.map((e) => (e.id === err.id ? { ...e, resuelto: nuevo } : e)));
    try {
      await resolverError(token, err.id, nuevo);
    } catch {
      setErrores((prev) => prev.map((e) => (e.id === err.id ? { ...e, resuelto: err.resuelto } : e)));
    }
  };

  if (loading) return <Loader />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={errores}
      keyExtractor={(e) => String(e.id)}
      ListHeaderComponent={error ? <ErrorBox message={error} onRetry={load} /> : null}
      ListEmptyComponent={<Text style={styles.empty}>Sin errores 🎉</Text>}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
      }
      renderItem={({ item }) => <ErrorCard err={item} onToggle={() => toggle(item)} />}
    />
  );
}

function ErrorCard({ err, onToggle }: { err: AgentError; onToggle: () => void }) {
  return (
    <View style={[styles.card, err.resuelto ? styles.cardResuelto : null]}>
      <View style={styles.headerRow}>
        <Text style={styles.numero}>#{err.id}</Text>
        <View style={styles.headerRight}>
          <Text style={styles.fuente}>{err.fuente}</Text>
          <Text style={styles.fecha}>{fmt(err.fecha)}</Text>
        </View>
        <TouchableOpacity
          style={[styles.tilde, err.resuelto ? styles.tildeOn : null]}
          onPress={onToggle}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.tildeText, err.resuelto ? styles.tildeTextOn : null]}>✓</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.contenido}>{err.contenido}</Text>
      <View style={styles.metaRow}>
        {err.telefono ? <Text style={styles.meta}>📞 {err.telefono}</Text> : null}
        {err.patron ? <Text style={styles.meta} numberOfLines={1}>🔎 {err.patron}</Text> : null}
      </View>
    </View>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 12, paddingBottom: 40 },
  empty: { color: colors.textDim, textAlign: "center", marginTop: 40 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, borderLeftColor: colors.red, borderLeftWidth: 3 },
  cardResuelto: { opacity: 0.55, borderLeftColor: colors.green },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  numero: { color: colors.text, fontSize: 16, fontWeight: "800" },
  headerRight: { flex: 1, marginLeft: 10 },
  fuente: { color: colors.amber, fontSize: 12, fontWeight: "700" },
  fecha: { color: colors.textDim, fontSize: 11 },
  tilde: { width: 32, height: 32, borderRadius: 16, borderColor: colors.border, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  tildeOn: { backgroundColor: colors.green, borderColor: colors.green },
  tildeText: { color: colors.textDim, fontSize: 16, fontWeight: "800" },
  tildeTextOn: { color: "#fff" },
  contenido: { color: colors.text, fontSize: 14 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  meta: { color: colors.textDim, fontSize: 12 },
});
