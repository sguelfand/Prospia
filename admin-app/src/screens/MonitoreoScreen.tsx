import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  EstadoServicio,
  MonitoreoStatus,
  ServicioSalud,
  getMonitoreo,
  rechequearServicio,
  rechequearTodo,
  setMonitoreoIntervalo,
} from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import { CollapsibleSection, ErrorBox, Loader } from "../components/ui";
import { colors } from "../theme";

const ESTADO: Record<EstadoServicio, { label: string; color: string }> = {
  up: { label: "Activo", color: colors.green },
  down: { label: "Caído", color: colors.red },
  warn: { label: "Lento", color: colors.amber },
  unknown: { label: "Sin datos", color: colors.textDim },
};

const FRECUENCIAS = [
  { v: 60, label: "1m" },
  { v: 120, label: "2m" },
  { v: 180, label: "3m" },
  { v: 300, label: "5m" },
  { v: 600, label: "10m" },
  { v: 900, label: "15m" },
  { v: 1800, label: "30m" },
];

function hace(iso: string | null): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `hace ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

// Monitoreo de servicios (Configuración → Monitoreo). Semáforo verde/rojo,
// última verificación, re-chequeo (todo o individual) y frecuencia.
export default function MonitoreoScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<MonitoreoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rechequeando, setRechequeando] = useState<string | null>(null); // slug | "__all__"

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      setData(await getMonitoreo(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar el monitoreo.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const todo = async () => {
    if (!token) return;
    setRechequeando("__all__");
    try {
      setData(await rechequearTodo(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al re-chequear.");
    } finally {
      setRechequeando(null);
    }
  };

  const uno = async (slug: string) => {
    if (!token) return;
    setRechequeando(slug);
    try {
      const actualizado = await rechequearServicio(token, slug);
      setData((prev) =>
        prev
          ? { ...prev, servicios: prev.servicios.map((s) => (s.slug === slug ? actualizado : s)) }
          : prev,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al re-chequear el servicio.");
    } finally {
      setRechequeando(null);
    }
  };

  const cambiarFrecuencia = async (seconds: number) => {
    if (!token) return;
    try {
      setData(await setMonitoreoIntervalo(token, seconds));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cambiar la frecuencia.");
    }
  };

  if (loading) return <Loader />;

  const servicios = data?.servicios ?? [];
  const grupos = Array.from(new Set(servicios.map((s) => s.grupo)));
  const r = data?.resumen;
  const hayCaidos = (r?.down ?? 0) > 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
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
      {error ? <ErrorBox message={error} onRetry={load} /> : null}

      {/* Resumen + re-chequear todo */}
      <View style={styles.headerCard}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.resumen, { color: hayCaidos ? colors.red : colors.green }]}>
            {r ? (hayCaidos ? `${r.down} caído${r.down > 1 ? "s" : ""} de ${r.total}` : `Todo OK · ${r.up}/${r.total}`) : "—"}
          </Text>
          {data?.last_run ? <Text style={styles.sub}>Último chequeo {hace(data.last_run)}</Text> : null}
        </View>
        <TouchableOpacity style={styles.btnTodo} onPress={todo} disabled={rechequeando === "__all__"} activeOpacity={0.7}>
          {rechequeando === "__all__" ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Icon name="refresh" size={16} color={colors.onPrimary} />
          )}
          <Text style={styles.btnTodoText}>Re-chequear</Text>
        </TouchableOpacity>
      </View>

      {/* Frecuencia del chequeo automático */}
      <Text style={styles.freqTitle}>Chequeo automático cada</Text>
      <View style={styles.freqRow}>
        {FRECUENCIAS.map((f) => {
          const activo = (data?.interval_seconds ?? 300) === f.v;
          return (
            <TouchableOpacity
              key={f.v}
              style={[styles.freqPill, activo && styles.freqPillOn]}
              onPress={() => cambiarFrecuencia(f.v)}
              activeOpacity={0.7}
            >
              <Text style={[styles.freqPillText, activo && styles.freqPillTextOn]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {grupos.map((grupo) => {
        const items = servicios.filter((s) => s.grupo === grupo);
        const caidos = items.filter((s) => s.estado === "down").length;
        return (
          <CollapsibleSection key={grupo} title={grupo} count={caidos > 0 ? caidos : undefined}>
            <View style={styles.card}>
              {items.map((s, i) => (
                <ServicioRow
                  key={s.slug}
                  s={s}
                  border={i > 0}
                  cargando={rechequeando === s.slug}
                  onRecheck={() => uno(s.slug)}
                />
              ))}
            </View>
          </CollapsibleSection>
        );
      })}
    </ScrollView>
  );
}

function ServicioRow({
  s,
  border,
  cargando,
  onRecheck,
}: {
  s: ServicioSalud;
  border?: boolean;
  cargando: boolean;
  onRecheck: () => void;
}) {
  const info = ESTADO[s.estado];
  return (
    <View style={[styles.row, border && styles.rowBorder]}>
      <View style={[styles.dot, { backgroundColor: info.color }]} />
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={styles.nombre} numberOfLines={1}>
            {s.nombre}
          </Text>
          {s.descripcion ? (
            <Text style={styles.desc} numberOfLines={1}>
              {s.descripcion}
            </Text>
          ) : null}
          <View style={[styles.badge, { borderColor: info.color + "66", backgroundColor: info.color + "22" }]}>
            <Text style={[styles.badgeText, { color: info.color }]}>{info.label}</Text>
          </View>
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {hace(s.last_check)}
          {s.latency_ms != null ? ` · ${s.latency_ms}ms` : ""}
          {s.estado === "down" && s.since ? ` · caído ${hace(s.since)}` : ""}
        </Text>
        {s.detalle && s.estado !== "up" ? (
          <Text style={[styles.meta, { color: colors.red }]} numberOfLines={2}>
            {s.detalle}
          </Text>
        ) : null}
      </View>
      <TouchableOpacity style={styles.recheck} onPress={onRecheck} disabled={cargando} activeOpacity={0.7}>
        {cargando ? <ActivityIndicator size="small" color={colors.textDim} /> : <Icon name="refresh" size={16} color={colors.textDim} />}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  headerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  resumen: { fontSize: 16, fontWeight: "700" },
  sub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  btnTodo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  btnTodoText: { color: colors.onPrimary, fontSize: 13, fontWeight: "700" },
  freqTitle: { color: colors.textDim, fontSize: 12, marginTop: 18, marginBottom: 8 },
  freqRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  freqPill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  freqPillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  freqPillText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  freqPillTextOn: { color: colors.onPrimary },
  card: { backgroundColor: colors.card, borderRadius: 14, paddingHorizontal: 16 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 14, gap: 12 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  nombre: { color: colors.text, fontSize: 15, fontWeight: "700", flexShrink: 0 },
  desc: { color: colors.textDim, fontSize: 12, flexShrink: 1 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  meta: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  recheck: { padding: 6 },
});
