import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { DashboardComparativa, getComparativa } from "../api";
import { useAuth } from "../auth";
import { Bar, ErrorBox, KpiCard, Loader, Section } from "../components/ui";
import { DashboardProps } from "../navigation";
import { colors } from "../theme";

export default function DashboardScreen({ navigation }: DashboardProps) {
  const { token } = useAuth();
  const [data, setData] = useState<DashboardComparativa | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setData(await getComparativa(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar el dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loader />;
  if (error && !data) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return null;

  const clientes = data.clientes;
  const maxProspects = Math.max(1, ...clientes.map((c) => c.total_prospects));
  const maxInteresados = Math.max(1, ...clientes.map((c) => c.interesados));
  // Para tasas comparo solo clientes con datos reales (Etiguel viene en 0).
  const conTasa = clientes.filter((c) => c.contactados > 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
      }
    >
      {error ? <ErrorBox message={error} onRetry={load} /> : null}

      <View style={styles.kpiGrid}>
        <KpiCard label="Clientes" value={data.total_clientes} />
        <KpiCard label="Prospects" value={data.total_prospects} />
      </View>
      <View style={styles.kpiGrid}>
        <KpiCard label="En conversación" value={data.en_conversacion} accent={colors.primary} />
        <KpiCard label="Interesados" value={data.interesados} accent={colors.green} />
        <KpiCard label="Interes./mes" value={data.interesados_mes} accent={colors.green} />
      </View>

      <Section title="Prospects por cliente">
        {clientes.map((c) => (
          <Bar key={`p-${c.fuente}-${c.tenant_id}`} label={c.nombre} value={c.total_prospects} max={maxProspects} color={colors.blue} />
        ))}
      </Section>

      <Section title="Interesados por cliente">
        {clientes.map((c) => (
          <Bar key={`i-${c.fuente}-${c.tenant_id}`} label={c.nombre} value={c.interesados} max={maxInteresados} color={colors.green} />
        ))}
      </Section>

      {conTasa.length > 0 ? (
        <Section title="Tasa de respuesta por cliente">
          {conTasa.map((c) => (
            <Bar key={`tr-${c.tenant_id}`} label={c.nombre} value={c.tasa_respuesta} max={100} color={colors.primary} right={`${c.tasa_respuesta}%`} />
          ))}
        </Section>
      ) : null}

      {conTasa.length > 0 ? (
        <Section title="Tasa de conversión por cliente">
          {conTasa.map((c) => (
            <Bar key={`tc-${c.tenant_id}`} label={c.nombre} value={c.tasa_conversion} max={100} color={colors.amber} right={`${c.tasa_conversion}%`} />
          ))}
        </Section>
      ) : null}

      <Section title="Clientes">
        {clientes.map((c) => (
          <TouchableOpacity
            key={`c-${c.fuente}-${c.tenant_id}`}
            style={styles.card}
            onPress={() => navigation.navigate("ClienteView", { tenantId: c.tenant_id, nombre: c.nombre, fuente: c.fuente })}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{c.nombre}</Text>
              {c.fuente === "etiguel" ? <Text style={styles.tag}>Etiguel</Text> : null}
            </View>
            <View style={styles.cardStats}>
              <Stat label="Prospects" value={c.total_prospects} />
              <Stat label="En conv." value={c.en_conversacion} color={colors.primary} />
              <Stat label="Interes." value={c.interesados} color={colors.green} />
              <Stat label="Int./mes" value={c.interesados_mes} color={colors.green} />
            </View>
          </TouchableOpacity>
        ))}
      </Section>
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
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: "700", flex: 1 },
  tag: { color: colors.amber, fontSize: 11, fontWeight: "700", borderColor: colors.amber, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  cardStats: { flexDirection: "row", justifyContent: "space-between" },
  stat: { alignItems: "center", flex: 1 },
  statValue: { color: colors.text, fontSize: 20, fontWeight: "700" },
  statLabel: { color: colors.textDim, fontSize: 11, marginTop: 2 },
});
