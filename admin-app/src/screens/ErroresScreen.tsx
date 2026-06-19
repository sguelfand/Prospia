import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AgentError, deleteError, getErrores, resolverError } from "../api";
import { useAuth } from "../auth";
import { ErrorBox, Loader } from "../components/ui";
import { ErroresProps } from "../navigation";
import { IconText } from "../components/Icon";
import { colors } from "../theme";

type Filtro = "activos" | "solucionados";

export default function ErroresScreen(_props: ErroresProps) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [errores, setErrores] = useState<AgentError[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("activos");
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

  const setResuelto = async (err: AgentError, resuelto: boolean) => {
    if (!token) return;
    setErrores((prev) => prev.map((e) => (e.id === err.id ? { ...e, resuelto } : e)));
    try {
      await resolverError(token, err.id, resuelto);
    } catch {
      setErrores((prev) => prev.map((e) => (e.id === err.id ? { ...e, resuelto: err.resuelto } : e)));
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

  if (loading) return <Loader />;

  const visibles = errores.filter((e) => (filtro === "activos" ? !e.resuelto : e.resuelto));
  const nActivos = errores.filter((e) => !e.resuelto).length;
  const nResueltos = errores.length - nActivos;

  return (
    <View style={styles.container}>
      {/* ── Filtro de estado ─────────────────────────────────────── */}
      <View style={styles.tabs}>
        <Tab label={`Activos (${nActivos})`} active={filtro === "activos"} onPress={() => setFiltro("activos")} />
        <Tab label={`Solucionados (${nResueltos})`} active={filtro === "solucionados"} onPress={() => setFiltro("solucionados")} />
      </View>

      <FlatList
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        data={visibles}
        keyExtractor={(e) => String(e.id)}
        ListHeaderComponent={error ? <ErrorBox message={error} onRetry={load} /> : null}
        ListEmptyComponent={
          <Text style={styles.empty}>{filtro === "activos" ? "Sin errores activos 🎉" : "No hay errores solucionados."}</Text>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
        renderItem={({ item }) => (
          <SwipeableError
            err={item}
            onResolve={() => setResuelto(item, !item.resuelto)}
            onDelete={() => borrar(item)}
          />
        )}
      />
    </View>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.tab, active ? styles.tabActive : null]} onPress={onPress}>
      <Text style={[styles.tabText, active ? styles.tabTextActive : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

function SwipeableError({ err, onResolve, onDelete }: { err: AgentError; onResolve: () => void; onDelete: () => void }) {
  const ref = useRef<Swipeable>(null);

  const leftAction = () => (
    <View style={[styles.action, styles.actionResolve]}>
      <Text style={styles.actionIcon}>✓</Text>
    </View>
  );
  const rightAction = () => (
    <View style={[styles.action, styles.actionDelete, { alignItems: "flex-end" }]}>
      <Text style={styles.actionIcon}>✕</Text>
    </View>
  );

  return (
    <Swipeable
      ref={ref}
      renderLeftActions={leftAction}
      renderRightActions={rightAction}
      leftThreshold={70}
      rightThreshold={70}
      onSwipeableOpen={(direction) => {
        if (direction === "right") {
          // deslizó hacia la derecha → acción verde → resolver/reactivar
          onResolve();
          ref.current?.close();
        } else {
          // deslizó hacia la izquierda → acción roja → borrar
          onDelete();
        }
      }}
    >
      <ErrorCard err={err} />
    </Swipeable>
  );
}

function ErrorCard({ err }: { err: AgentError }) {
  return (
    <View style={[styles.card, err.resuelto ? styles.cardResuelto : null]}>
      <View style={styles.headerRow}>
        <Text style={styles.numero}>#{err.id}</Text>
        <View style={styles.headerRight}>
          <Text style={styles.fuente}>{err.fuente}</Text>
          <Text style={styles.fecha}>{fmt(err.fecha)}</Text>
        </View>
        {err.resuelto ? <Text style={styles.badgeOk}>resuelto</Text> : null}
      </View>
      <Text style={styles.contenido}>{err.contenido}</Text>
      <View style={styles.metaRow}>
        {err.telefono ? <IconText name="phone" text={err.telefono} /> : null}
        {err.patron ? <IconText name="search" text={err.patron} /> : null}
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

  tabs: { flexDirection: "row", padding: 8, gap: 8 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  tabActive: { backgroundColor: colors.cardAlt, borderColor: colors.primary },
  tabText: { color: colors.textDim, fontSize: 13, fontWeight: "700" },
  tabTextActive: { color: colors.text },

  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, borderLeftColor: colors.red, borderLeftWidth: 3 },
  cardResuelto: { opacity: 0.55, borderLeftColor: colors.green },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  numero: { color: colors.text, fontSize: 16, fontWeight: "800" },
  headerRight: { flex: 1, marginLeft: 10 },
  fuente: { color: colors.amber, fontSize: 12, fontWeight: "700" },
  fecha: { color: colors.textDim, fontSize: 11 },
  badgeOk: { color: colors.green, fontSize: 11, fontWeight: "700", borderColor: colors.green, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  contenido: { color: colors.text, fontSize: 14 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  meta: { color: colors.textDim, fontSize: 12 },

  action: { flex: 1, justifyContent: "center", paddingHorizontal: 24, borderRadius: 12, marginBottom: 10 },
  actionResolve: { backgroundColor: colors.green, alignItems: "flex-start" },
  actionDelete: { backgroundColor: colors.red },
  actionIcon: { color: "#fff", fontSize: 24, fontWeight: "800" },
});
