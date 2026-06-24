import React, { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AgentError, EstadoError, deleteError, getErrores, setEstadoError } from "../api";
import { useAuth } from "../auth";
import { Icon, IconText } from "../components/Icon";
import { SwipeRow } from "../components/SwipeRow";
import { ErrorBox, Loader } from "../components/ui";
import { ErroresProps } from "../navigation";
import { colors } from "../theme";

type Filtro = EstadoError;

export default function ErroresScreen(_props: ErroresProps) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [errores, setErrores] = useState<AgentError[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("nuevo");
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

  const cambiarEstado = async (err: AgentError, estado: EstadoError) => {
    if (!token) return;
    const prevEstado = err.estado;
    setErrores((prev) => prev.map((e) => (e.id === err.id ? { ...e, estado } : e)));
    try {
      await setEstadoError(token, err.id, estado);
    } catch {
      setErrores((prev) => prev.map((e) => (e.id === err.id ? { ...e, estado: prevEstado } : e)));
    }
  };

  const borrar = async (err: AgentError) => {
    if (!token) return;
    const snapshot = errores;
    setErrores((prev) => prev.filter((e) => e.id !== err.id));
    try {
      await deleteError(token, err.id);
    } catch {
      setErrores(snapshot); // revertir si falla
    }
  };

  const confirmarBorrar = (err: AgentError) => {
    Alert.alert("Borrar error", `¿Seguro que querés borrar el error #${err.id}? No se puede deshacer.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Borrar", style: "destructive", onPress: () => borrar(err) },
    ]);
  };

  if (loading) return <Loader />;

  const visibles = errores.filter((e) => e.estado === filtro);
  const n = (s: EstadoError) => errores.filter((e) => e.estado === s).length;

  const tabs: [EstadoError, string][] = [
    ["nuevo", `Nuevos (${n("nuevo")})`],
    ["reportado", `Reportados (${n("reportado")})`],
    ["fixed", `Fixed (${n("fixed")})`],
  ];

  return (
    <View style={styles.container}>
      {/* ── Filtro por estado ────────────────────────────────────── */}
      <View style={styles.tabs}>
        {tabs.map(([k, l]) => (
          <Tab key={k} label={l} active={filtro === k} onPress={() => setFiltro(k)} />
        ))}
      </View>

      <FlatList
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        data={visibles}
        keyExtractor={(e) => String(e.id)}
        ListHeaderComponent={error ? <ErrorBox message={error} onRetry={load} /> : null}
        ListEmptyComponent={<Text style={styles.empty}>{vacioMsg(filtro)}</Text>}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
        renderItem={({ item }) => (
          <SwipeRow
            left={
              item.estado === "nuevo"
                ? { icon: "flag", color: colors.red, onTrigger: () => cambiarEstado(item, "reportado") }
                : { icon: "undo", color: colors.amber, onTrigger: () => cambiarEstado(item, "nuevo") }
            }
            right={{ icon: "x", color: colors.red, onTrigger: () => confirmarBorrar(item) }}
          >
            <ErrorCard err={item} onEstado={cambiarEstado} />
          </SwipeRow>
        )}
      />
    </View>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.tab, active ? styles.tabActive : null]} onPress={onPress}>
      <Text style={[styles.tabText, active ? styles.tabTextActive : null]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

function ErrorCard({ err, onEstado }: { err: AgentError; onEstado: (e: AgentError, s: EstadoError) => void }) {
  const borderColor = err.estado === "fixed" ? colors.green : err.estado === "reportado" ? colors.red : colors.amber;
  return (
    <View style={[styles.card, { borderLeftColor: borderColor }, err.estado === "fixed" ? styles.cardFixed : null]}>
      <View style={styles.headerRow}>
        <Text style={styles.numero}>#{err.id}</Text>
        <View style={styles.headerRight}>
          <Text style={styles.fuente}>{err.fuente}</Text>
          <Text style={styles.fecha}>{fmt(err.fecha)}</Text>
        </View>
        {err.estado === "reportado" ? <Text style={styles.badgeReportado}>Reportado</Text> : null}
        {err.estado === "fixed" ? <Text style={styles.badgeFixed}>Fixed</Text> : null}
      </View>
      <Text style={styles.contenido}>{err.contenido}</Text>
      <View style={styles.metaRow}>
        {err.telefono ? <IconText name="phone" text={err.telefono} /> : null}
        {err.patron ? <IconText name="search" text={err.patron} /> : null}
      </View>

      {/* ── Acción según estado ──────────────────────────────────── */}
      <View style={styles.actionsRow}>
        {err.estado === "nuevo" ? (
          <ActionBtn icon="flag" label="Reportar" color={colors.red} onPress={() => onEstado(err, "reportado")} />
        ) : null}
        {err.estado === "reportado" ? (
          <ActionBtn icon="undo" label="Quitar reporte" color={colors.textDim} onPress={() => onEstado(err, "nuevo")} />
        ) : null}
        {err.estado === "fixed" ? (
          <ActionBtn icon="undo" label="Reabrir" color={colors.textDim} onPress={() => onEstado(err, "nuevo")} />
        ) : null}
      </View>
    </View>
  );
}

function ActionBtn({ icon, label, color, onPress }: { icon: "flag" | "undo"; label: string; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.actionBtn, { borderColor: color }]} onPress={onPress} activeOpacity={0.7}>
      <Icon name={icon} size={14} color={color} strokeWidth={2} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function vacioMsg(f: Filtro): string {
  if (f === "nuevo") return "Sin errores nuevos 🎉";
  if (f === "reportado") return "No hay errores reportados.";
  return "No hay errores solucionados.";
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

  tabs: { flexDirection: "row", padding: 8, gap: 8 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  tabActive: { backgroundColor: colors.cardAlt, borderColor: colors.primary },
  tabText: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  tabTextActive: { color: colors.text },

  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, borderLeftColor: colors.red, borderLeftWidth: 3 },
  cardFixed: { opacity: 0.55 },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  numero: { color: colors.text, fontSize: 16, fontWeight: "800" },
  headerRight: { flex: 1, marginLeft: 10 },
  fuente: { color: colors.amber, fontSize: 12, fontWeight: "700" },
  fecha: { color: colors.textDim, fontSize: 11 },
  badgeReportado: { color: colors.red, fontSize: 11, fontWeight: "700", borderColor: colors.red, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeFixed: { color: colors.green, fontSize: 11, fontWeight: "700", borderColor: colors.green, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  contenido: { color: colors.text, fontSize: 14 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },

  actionsRow: { flexDirection: "row", gap: 8, marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  actionLabel: { fontSize: 12, fontWeight: "700" },
});
