import React, { useCallback, useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { AdminOverview, ClienteResumen, getClientes, getOverview } from "../api";
import { useAuth } from "../auth";
import { ErrorBox, KpiCard, Loader } from "../components/ui";
import { ClientesProps } from "../navigation";
import { colors } from "../theme";

export default function ClientesScreen({ navigation }: ClientesProps) {
  const { token, signOut } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [ov, cl] = await Promise.all([getOverview(token), getClientes(token)]);
      setOverview(ov);
      setClientes(cl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar datos.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity onPress={() => navigation.navigate("Avisos")}>
          <Text style={styles.avisos}>🔔 Avisos</Text>
        </TouchableOpacity>
      ),
      headerRight: () => (
        <TouchableOpacity onPress={signOut}>
          <Text style={styles.logout}>Salir</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, signOut]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading) return <Loader />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {error ? <ErrorBox message={error} onRetry={load} /> : null}

      {overview ? (
        <View style={styles.kpiGrid}>
          <KpiCard label="Clientes" value={overview.total_clientes} />
          <KpiCard label="Prospects" value={overview.total_prospects} />
          <KpiCard label="En conversación" value={overview.en_conversacion} accent={colors.primary} />
          <KpiCard label="Interesados" value={overview.interesados} accent={colors.green} />
        </View>
      ) : null}

      <Text style={styles.heading}>Clientes</Text>
      {clientes.map((c) => (
        <TouchableOpacity
          key={`${c.fuente}-${c.tenant_id}`}
          style={styles.card}
          onPress={() => navigation.navigate("ClienteDetail", { tenantId: c.tenant_id, nombre: c.nombre })}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{c.nombre}</Text>
            {c.fuente === "etiguel" ? <Text style={styles.tag}>Etiguel</Text> : null}
          </View>
          <View style={styles.cardStats}>
            <Stat label="Prospects" value={c.total_prospects} />
            <Stat label="En conv." value={c.en_conversacion} color={colors.primary} />
            <Stat label="Interesados" value={c.interesados} color={colors.green} />
            <Stat label="Interes./mes" value={c.interesados_mes} color={colors.green} />
          </View>
        </TouchableOpacity>
      ))}
      {clientes.length === 0 && !error ? (
        <Text style={styles.empty}>No hay clientes todavía.</Text>
      ) : null}
    </ScrollView>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 12, paddingBottom: 40 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap" },
  heading: { color: colors.text, fontSize: 18, fontWeight: "700", marginTop: 20, marginBottom: 10, marginLeft: 4 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: "700", flex: 1 },
  tag: {
    color: colors.amber,
    fontSize: 11,
    fontWeight: "700",
    borderColor: colors.amber,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  cardStats: { flexDirection: "row", justifyContent: "space-between" },
  stat: { alignItems: "center", flex: 1 },
  statValue: { color: colors.text, fontSize: 20, fontWeight: "700" },
  statLabel: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  empty: { color: colors.textDim, textAlign: "center", marginTop: 20 },
  logout: { color: colors.primary, fontSize: 15, fontWeight: "700" },
  avisos: { color: colors.primary, fontSize: 15, fontWeight: "700" },
});
