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
  TokenAudit,
  TokenSource,
  getTokenAudit,
  getTokenSources,
  recomputeTokens,
} from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import { ErrorBox, Loader } from "../components/ui";
import { colors } from "../theme";

const SEV: Record<string, { color: string; label: string }> = {
  alta: { color: colors.red, label: "Alta" },
  media: { color: colors.amber, label: "Media" },
  baja: { color: colors.textDim, label: "Baja" },
};
const usd = (n: number) => "$" + (n ?? 0).toFixed(2);
const fmt = (n: number) => (n ?? 0).toLocaleString("es-AR");

export default function TokensScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [sources, setSources] = useState<TokenSource[]>([]);
  const [source, setSource] = useState("etiguel");
  const [data, setData] = useState<TokenAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recomputando, setRecomputando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) getTokenSources(token).then(setSources).catch(() => {});
  }, [token]);

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setError(null);
    try {
      setData(await getTokenAudit(token, source, 14));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, source]);

  useEffect(() => { load(); }, [load]);

  const recomputar = async () => {
    if (!token) return;
    setRecomputando(true);
    try {
      await recomputeTokens(token, source);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al recalcular.");
    } finally {
      setRecomputando(false);
    }
  };

  if (loading) return <Loader />;

  const u = data?.ultimo;
  const t = u?.totales;
  const trend = data?.tendencia ?? [];
  const maxCosto = Math.max(0.01, ...trend.map((d) => d.costo_usd));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    >
      {error ? <ErrorBox message={error} onRetry={load} /> : null}

      {/* Selector de cliente + recalcular */}
      <View style={styles.headerRow}>
        <View style={styles.pills}>
          {(sources.length ? sources : [{ id: "etiguel", nombre: "Etiguel (Camila)" }]).map((s) => {
            const on = s.id === source;
            return (
              <TouchableOpacity key={s.id} style={[styles.pill, on && styles.pillOn]} onPress={() => setSource(s.id)}>
                <Text style={[styles.pillText, on && styles.pillTextOn]}>{s.nombre}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity style={styles.recalc} onPress={recomputar} disabled={recomputando}>
          {recomputando ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Icon name="refresh" size={15} color={colors.onPrimary} />}
        </TouchableOpacity>
      </View>

      {!u || !t ? (
        <Text style={styles.empty}>Todavía no hay datos. Tocá recalcular o esperá la corrida diaria.</Text>
      ) : (
        <>
          <Text style={styles.dia}>Día {u.fecha} · costo estimado</Text>

          {/* KPIs */}
          <View style={styles.kpis}>
            <Kpi label="Costo est." value={usd(t.costo_usd)} />
            <Kpi label="Tokens" value={fmt(t.total)} />
            <Kpi label="Llamadas" value={fmt(t.llamadas)} />
            <Kpi label="Errores" value={fmt(t.errores)} alert={t.errores > 0} />
            <Kpi label="Timeouts" value={fmt(t.timeouts)} alert={t.timeouts > 0} />
          </View>

          {/* Oportunidades */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Oportunidades de mejora</Text>
            {u.oportunidades.length === 0 ? (
              <Text style={styles.ok}>Sin oportunidades en este día 👌</Text>
            ) : (
              u.oportunidades.map((o, i) => {
                const sev = SEV[o.severidad] ?? SEV.baja;
                return (
                  <View key={i} style={[styles.op, i > 0 && styles.opBorder]}>
                    <View style={styles.opTop}>
                      <View style={[styles.sevBadge, { borderColor: sev.color + "66", backgroundColor: sev.color + "22" }]}>
                        <Text style={[styles.sevText, { color: sev.color }]}>{sev.label}</Text>
                      </View>
                      <Text style={styles.opTitle}>{o.titulo}</Text>
                    </View>
                    <Text style={styles.opDetail}>{o.detalle}</Text>
                  </View>
                );
              })
            )}
          </View>

          {/* Tendencia */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Costo por día (estimado)</Text>
            <View style={styles.bars}>
              {trend.map((d) => (
                <View key={d.fecha} style={styles.barCol}>
                  <View style={[styles.bar, {
                    height: Math.max(2, (d.costo_usd / maxCosto) * 90),
                    backgroundColor: d.oportunidades > 0 ? colors.amber : colors.cardAlt,
                  }]} />
                  <Text style={styles.barLabel}>{d.fecha.slice(5)}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Top conversaciones */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Conversaciones más caras</Text>
            {u.top_conversaciones.slice(0, 8).map((c, i) => (
              <View key={c.sesion} style={[styles.conv, i > 0 && styles.opBorder]}>
                <View style={styles.convTop}>
                  <Text style={styles.convCost}>{usd(c.costo_usd)}</Text>
                  <Text style={styles.convMeta}>{c.agente} · {c.llamadas} ll · {fmt(c.tokens)} tok</Text>
                </View>
                {c.ejemplo ? <Text style={styles.convEj} numberOfLines={1}>“{c.ejemplo}”</Text> : null}
              </View>
            ))}
          </View>

          {/* Por modelo / agente */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Por modelo</Text>
            {Object.entries(u.por_modelo).map(([m, v]) => (
              <View key={m} style={styles.kv}>
                <Text style={styles.kvK}>{m}</Text>
                <Text style={styles.kvV}>{usd(v.costo_usd)} · {fmt(v.tokens)}</Text>
              </View>
            ))}
            <Text style={[styles.cardTitle, { marginTop: 14 }]}>Por agente</Text>
            {Object.entries(u.por_agente).map(([a, v]) => (
              <View key={a} style={styles.kv}>
                <Text style={styles.kvK}>{a === "main" ? "main (sistema)" : a}</Text>
                <Text style={styles.kvV}>{usd(v.costo_usd)} · {v.llamadas} ll</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Kpi({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <View style={styles.kpi}>
      <Text style={[styles.kpiVal, alert && { color: colors.red }]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, flex: 1 },
  pill: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  pillTextOn: { color: colors.onPrimary },
  recalc: { backgroundColor: colors.primary, borderRadius: 10, padding: 9 },
  empty: { color: colors.textDim, fontSize: 14, textAlign: "center", marginTop: 30 },
  dia: { color: colors.textDim, fontSize: 12, marginTop: 14 },
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  kpi: { backgroundColor: colors.card, borderRadius: 12, padding: 12, minWidth: 90, flexGrow: 1 },
  kpiVal: { color: colors.text, fontSize: 20, fontWeight: "700" },
  kpiLabel: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginTop: 16 },
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: "700", textTransform: "uppercase", marginBottom: 10 },
  ok: { color: colors.green, fontSize: 14 },
  op: { paddingVertical: 10 },
  opBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  opTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  sevBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  sevText: { fontSize: 11, fontWeight: "700" },
  opTitle: { color: colors.text, fontSize: 14, fontWeight: "600", flex: 1 },
  opDetail: { color: colors.textDim, fontSize: 12, marginTop: 5 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 6, height: 110 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  bar: { width: "70%", borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  barLabel: { color: colors.textDim, fontSize: 9, marginTop: 4 },
  conv: { paddingVertical: 9 },
  convTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  convCost: { color: colors.text, fontSize: 14, fontWeight: "700" },
  convMeta: { color: colors.textDim, fontSize: 11 },
  convEj: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  kv: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  kvK: { color: colors.text, fontSize: 14 },
  kvV: { color: colors.textDim, fontSize: 13 },
});
