import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { colors } from "../theme";

export function KpiCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={[styles.kpiValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

/** Barra horizontal proporcional (para distribuciones por estado / término). */
export function Bar({
  label,
  value,
  max,
  color,
  right,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  right?: string;
}) {
  const pct = max > 0 ? Math.max(0.02, value / max) : 0;
  return (
    <View style={styles.barRow}>
      <View style={styles.barHeader}>
        <Text style={styles.barLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.barValue}>{right ?? value}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function Loader() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry ? (
        <Text style={styles.retry} onPress={onRetry}>
          Reintentar
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  kpi: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    margin: 4,
    minWidth: 90,
  },
  kpiValue: { color: colors.text, fontSize: 24, fontWeight: "700" },
  kpiLabel: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  barRow: { marginBottom: 12 },
  barHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  barLabel: { color: colors.text, fontSize: 14, flex: 1, marginRight: 8 },
  barValue: { color: colors.textDim, fontSize: 14, fontWeight: "600" },
  barTrack: { height: 8, backgroundColor: colors.cardAlt, borderRadius: 4, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },
  section: { marginTop: 20 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  errorBox: { backgroundColor: colors.card, borderRadius: 12, padding: 16, margin: 16 },
  errorText: { color: colors.red, fontSize: 14 },
  retry: { color: colors.primary, fontSize: 14, fontWeight: "700", marginTop: 10 },
});
