import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  DashboardStats,
  ETIGUEL_TENANT_ID,
  EtiguelLead,
  getClienteStats,
  getEtiguelLeads,
} from "../api";
import { useAuth } from "../auth";
import { Bar, ErrorBox, KpiCard, Loader, Section } from "../components/ui";
import { ClienteDetailProps } from "../navigation";
import { colors, estadoColor, estadoLabel } from "../theme";

export default function ClienteDetailScreen({ route, navigation }: ClienteDetailProps) {
  const { tenantId, nombre } = route.params;
  const esEtiguel = tenantId === ETIGUEL_TENANT_ID;
  const { token } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [leads, setLeads] = useState<EtiguelLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: nombre });
  }, [navigation, nombre]);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [s, l] = await Promise.all([
        getClienteStats(token, tenantId),
        esEtiguel ? getEtiguelLeads(token) : Promise.resolve([] as EtiguelLead[]),
      ]);
      setStats(s);
      setLeads(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar estadísticas.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, tenantId, esEtiguel]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loader />;
  if (error && !stats) return <ErrorBox message={error} onRetry={load} />;
  if (!stats) return null;

  const maxEstado = Math.max(1, ...stats.por_estado.map((e) => e.count));
  const maxTermino = Math.max(1, ...stats.por_termino.map((t) => t.encontrados));
  const maxMes = Math.max(1, ...stats.por_mes.map((m) => m.encontrados));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={colors.primary}
        />
      }
    >
      {/* ── Mes actual ──────────────────────────────────────────── */}
      <Section title="Este mes">
        <View style={styles.kpiGrid}>
          <KpiCard label="Prospects" value={stats.mes_actual.prospects} />
          <KpiCard label="En conversación" value={stats.mes_actual.en_conversacion} accent={colors.primary} />
          <KpiCard label="Interesados" value={stats.mes_actual.interesados} accent={colors.green} />
        </View>
        <View style={styles.kpiGrid}>
          <KpiCard label="Tasa respuesta" value={`${stats.mes_actual.tasa_respuesta}%`} accent={colors.primary} />
          <KpiCard label="Tasa conversión" value={`${stats.mes_actual.tasa_conversion}%`} accent={colors.green} />
          <KpiCard label="Total histórico" value={stats.total_prospects} />
        </View>
      </Section>

      {/* ── Por estado ──────────────────────────────────────────── */}
      <Section title="Por estado">
        {stats.por_estado
          .slice()
          .sort((a, b) => b.count - a.count)
          .map((e) => (
            <Bar
              key={e.estado}
              label={estadoLabel[e.estado] ?? e.estado}
              value={e.count}
              max={maxEstado}
              color={estadoColor[e.estado] ?? colors.textDim}
            />
          ))}
      </Section>

      {/* ── Por término ─────────────────────────────────────────── */}
      <Section title="Por término (top 10)">
        {stats.por_termino.map((t) => (
          <Bar
            key={t.termino}
            label={t.termino}
            value={t.encontrados}
            max={maxTermino}
            color={colors.blue}
            right={`${t.encontrados} · ${t.interesados} int.`}
          />
        ))}
        {stats.por_termino.length === 0 ? <Text style={styles.empty}>Sin términos.</Text> : null}
      </Section>

      {/* ── Evolución mensual ───────────────────────────────────── */}
      <Section title="Evolución mensual">
        {stats.por_mes.map((m) => (
          <Bar
            key={m.mes}
            label={m.mes}
            value={m.encontrados}
            max={maxMes}
            color={colors.primary}
            right={`${m.encontrados} · ${m.interesados} int.`}
          />
        ))}
        {stats.por_mes.length === 0 ? <Text style={styles.empty}>Sin datos.</Text> : null}
      </Section>

      {/* ── Leads (solo Etiguel) ────────────────────────────────── */}
      {esEtiguel ? (
        <Section title={`Leads (${leads.length})`}>
          {leads.map((l, i) => (
            <LeadCard key={`${i}-${l.descripcion}`} lead={l} />
          ))}
          {leads.length === 0 ? <Text style={styles.empty}>Sin leads en el período.</Text> : null}
        </Section>
      ) : null}
    </ScrollView>
  );
}

function LeadCard({ lead }: { lead: EtiguelLead }) {
  return (
    <View style={styles.leadCard}>
      <View style={styles.leadHeader}>
        <Text style={styles.leadDesc} numberOfLines={2}>
          {lead.descripcion}
        </Text>
        <Text style={styles.leadEstado}>{lead.estado}</Text>
      </View>
      {lead.nombre ? <Text style={styles.leadNombre}>{lead.nombre}</Text> : null}
      <View style={styles.leadMetaRow}>
        {lead.origen ? <Text style={styles.leadMeta}>📍 {lead.origen}</Text> : null}
        {lead.fecha_creacion ? <Text style={styles.leadMeta}>🗓 {lead.fecha_creacion}</Text> : null}
      </View>
      {lead.telefono ? <Text style={styles.leadContacto}>📞 {lead.telefono}</Text> : null}
      {lead.email ? <Text style={styles.leadContacto}>✉️ {lead.email}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 12, paddingBottom: 40 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap" },
  empty: { color: colors.textDim },
  leadCard: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10 },
  leadHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  leadDesc: { color: colors.text, fontSize: 14, fontWeight: "600", flex: 1, marginRight: 8 },
  leadEstado: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "700",
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
  leadNombre: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  leadMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 6 },
  leadMeta: { color: colors.textDim, fontSize: 12 },
  leadContacto: { color: colors.text, fontSize: 13, marginTop: 4 },
});
