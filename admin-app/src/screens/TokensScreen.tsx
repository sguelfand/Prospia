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
  TokenMesTrend,
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
const usd3 = (n: number) => "$" + (n ?? 0).toFixed(3);
const fmt = (n: number) => (n ?? 0).toLocaleString("es-AR");
function haceDias(iso: string | null): string {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "hoy" : d === 1 ? "hace 1 día" : `hace ${d} días`;
}

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
  const [mesSel, setMesSel] = useState<number | null>(null);

  useEffect(() => { if (token) getTokenSources(token).then(setSources).catch(() => {}); }, [token]);

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setError(null);
    try { setData(await getTokenAudit(token, source, 14)); }
    catch (e) { setError(e instanceof Error ? e.message : "Error al cargar."); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, source]);
  useEffect(() => { load(); }, [load]);

  const recomputar = async () => {
    if (!token) return;
    setRecomputando(true);
    try { await recomputeTokens(token, source); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Error."); }
    finally { setRecomputando(false); }
  };

  if (loading) return <Loader />;

  const u = data?.ultimo;
  const t = u?.totales;
  const dias = data?.tendencia ?? [];
  const meses = data?.serie_mensual ?? [];
  const maxDia = Math.max(0.001, ...dias.map((d) => d.costo_usd));
  const maxMes = Math.max(0.001, ...meses.map((m) => m.costo_usd));
  const convs = (u?.top_conversaciones ?? []).filter((c) => !c.es_sistema);
  const sistema = (u?.top_conversaciones ?? []).find((c) => c.es_sistema);
  const mSel: TokenMesTrend | null = mesSel != null ? meses[mesSel] : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}>
      {error ? <ErrorBox message={error} onRetry={load} /> : null}

      <View style={styles.headerRow}>
        <View style={styles.pills}>
          {(sources.length ? sources : [{ id: "etiguel", nombre: "Etiguel (Camila)" }]).map((s) => {
            const on = s.id === source;
            return <TouchableOpacity key={s.id} style={[styles.pill, on && styles.pillOn]} onPress={() => setSource(s.id)}>
              <Text style={[styles.pillText, on && styles.pillTextOn]}>{s.nombre}</Text></TouchableOpacity>;
          })}
        </View>
        <TouchableOpacity style={styles.recalc} onPress={recomputar} disabled={recomputando}>
          {recomputando ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Icon name="refresh" size={15} color={colors.onPrimary} />}
        </TouchableOpacity>
      </View>
      <Text style={styles.nota}>Costo estimado (tokens reales × precios de referencia; myclaw no expone su precio).</Text>

      {/* Oportunidades FIJAS */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Oportunidades de mejora <Text style={styles.sub}>(fijas hasta resolver)</Text></Text>
        {(data?.oportunidades ?? []).length === 0 ? <Text style={styles.ok}>Sin oportunidades abiertas 👌</Text> : (
          data!.oportunidades.map((o, i) => {
            const sev = SEV[o.severidad] ?? SEV.baja;
            return (
              <View key={o.id} style={[styles.op, i > 0 && styles.border]}>
                <View style={styles.opTop}>
                  <View style={[styles.badge, { borderColor: sev.color + "66", backgroundColor: sev.color + "22" }]}><Text style={[styles.badgeText, { color: sev.color }]}>{sev.label}</Text></View>
                  <Text style={styles.opTitle}>{o.titulo}</Text>
                </View>
                <Text style={styles.opDetail}>{o.detalle}</Text>
                <Text style={styles.opMeta}>detectada {haceDias(o.primera_vez)}</Text>
              </View>
            );
          })
        )}
      </View>

      {!u || !t ? <Text style={styles.empty}>Sin datos del día. Tocá recalcular.</Text> : (
        <>
          <Text style={styles.dia}>Día {u.fecha}</Text>
          <View style={styles.kpis}>
            <Kpi label="Costo est." value={usd(t.costo_usd)} />
            <Kpi label="Conversac." value={fmt(u.n_conversaciones)} />
            <Kpi label="Llamadas" value={fmt(t.llamadas)} />
            <Kpi label="Errores" value={fmt(t.errores)} alert={t.errores > 0} />
            <Kpi label="Timeouts" value={fmt(t.timeouts)} alert={t.timeouts > 0} />
          </View>

          {/* Barras por día apiladas */}
          <View style={styles.card}>
            <View style={styles.legendRow}>
              <Text style={styles.cardTitle}>Costo por día</Text>
              <View style={styles.legend}>
                <Text style={styles.legItem}><Text style={{ color: colors.blue }}>■</Text> mensajes  <Text style={{ color: colors.red }}>■</Text> errores</Text>
              </View>
            </View>
            <View style={styles.bars}>
              {dias.map((d) => {
                const totalH = (d.costo_usd / maxDia) * 90;
                const errH = d.costo_usd > 0 ? (d.costo_errores / d.costo_usd) * totalH : 0;
                return (
                  <View key={d.fecha} style={styles.barCol}>
                    <View style={{ height: totalH, width: "70%", justifyContent: "flex-end" }}>
                      {errH > 0 && <View style={{ height: errH, backgroundColor: colors.red, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />}
                      <View style={{ flex: 1, backgroundColor: "#2F4068" }} />
                    </View>
                    <Text style={styles.barLabel}>{d.fecha.slice(5)}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Histórico mensual: tap en un mes muestra detalle */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Histórico mensual</Text>
            <Text style={styles.sub}>Tocá un mes para ver el detalle.</Text>
            {meses.length === 0 ? <Text style={styles.empty}>Sin histórico.</Text> : (
              <>
                {mSel && (
                  <View style={styles.mesBox}>
                    <Text style={styles.mesBoxTitle}>{mSel.mes}</Text>
                    <Text style={styles.mesBoxKv}>Total: <Text style={styles.mesBoxV}>{usd(mSel.costo_usd)}</Text></Text>
                    <Text style={styles.mesBoxKv}>Conversaciones: <Text style={styles.mesBoxV}>{fmt(mSel.conversaciones)}</Text></Text>
                    <Text style={styles.mesBoxKv}>Prom. $/conversación: <Text style={styles.mesBoxV}>{usd3(mSel.costo_por_conversacion)}</Text></Text>
                  </View>
                )}
                <View style={[styles.bars, { marginTop: 10 }]}>
                  {meses.map((m, i) => (
                    <TouchableOpacity key={m.mes} style={styles.barCol} onPress={() => setMesSel(i === mesSel ? null : i)}>
                      <View style={{ height: Math.max(2, (m.costo_usd / maxMes) * 90), width: "70%", backgroundColor: i === mesSel ? colors.primary : colors.cardAlt, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
                      <Text style={styles.barLabel}>{m.mes.slice(2)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
          </View>

          {/* Conversaciones más caras (teléfono) */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Conversaciones más caras (día)</Text>
            {convs.length === 0 ? <Text style={styles.empty}>Sin conversaciones.</Text> : convs.slice(0, 10).map((c, i) => (
              <View key={c.telefono} style={[styles.conv, i > 0 && styles.border]}>
                <View style={styles.convTop}>
                  <Text style={styles.convTel}>{c.telefono}</Text>
                  <Text style={styles.convCost}>{usd3(c.costo_usd)}</Text>
                </View>
                <Text style={styles.convMeta}>{c.llamadas} llamadas · {fmt(c.tokens)} tok{c.timeouts > 0 ? ` · ${c.timeouts} timeout` : ""}{c.errores > 0 ? ` · ${c.errores} error` : ""}</Text>
                {c.ejemplo ? <Text style={styles.convEj} numberOfLines={1}>“{c.ejemplo}”</Text> : null}
              </View>
            ))}
            {sistema ? <Text style={styles.sysLine}>+ sistema (crons/mantenimiento): {usd3(sistema.costo_usd)}</Text> : null}
          </View>

          {/* Por modelo — mes */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Por modelo · mes {data!.mes_actual}</Text>
            {Object.keys(data!.por_modelo_mes).length === 0 ? <Text style={styles.empty}>Sin datos del mes.</Text> :
              Object.entries(data!.por_modelo_mes).sort((a, b) => b[1].costo_usd - a[1].costo_usd).map(([m, v]) => (
                <View key={m} style={styles.kv}><Text style={styles.kvK}>{m}</Text><Text style={styles.kvV}>{usd(v.costo_usd)} · {fmt(v.tokens)}</Text></View>
              ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Kpi({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return <View style={styles.kpi}><Text style={[styles.kpiVal, alert && { color: colors.red }]}>{value}</Text><Text style={styles.kpiLabel}>{label}</Text></View>;
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
  nota: { color: colors.textDim, fontSize: 11, marginTop: 8 },
  empty: { color: colors.textDim, fontSize: 13, marginTop: 6 },
  dia: { color: colors.textDim, fontSize: 12, marginTop: 14 },
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  kpi: { backgroundColor: colors.card, borderRadius: 12, padding: 12, minWidth: 88, flexGrow: 1 },
  kpiVal: { color: colors.text, fontSize: 19, fontWeight: "700" },
  kpiLabel: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginTop: 16 },
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: "700", textTransform: "uppercase" },
  sub: { color: colors.textDim, fontSize: 11, fontWeight: "400", textTransform: "none" },
  ok: { color: colors.green, fontSize: 14, marginTop: 8 },
  op: { paddingVertical: 10 },
  border: { borderTopWidth: 1, borderTopColor: colors.border },
  opTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  opTitle: { color: colors.text, fontSize: 14, fontWeight: "600", flex: 1 },
  opDetail: { color: colors.textDim, fontSize: 12, marginTop: 5 },
  opMeta: { color: colors.textDim, fontSize: 11, marginTop: 4, fontStyle: "italic" },
  legendRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  legend: {},
  legItem: { color: colors.textDim, fontSize: 11 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 5, height: 115, marginTop: 10 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  barLabel: { color: colors.textDim, fontSize: 9, marginTop: 4 },
  mesBox: { backgroundColor: colors.cardAlt, borderRadius: 10, padding: 12, marginTop: 10 },
  mesBoxTitle: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 4 },
  mesBoxKv: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  mesBoxV: { color: colors.text, fontWeight: "700" },
  conv: { paddingVertical: 9 },
  convTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  convTel: { color: colors.text, fontSize: 14, fontWeight: "600" },
  convCost: { color: colors.text, fontSize: 14, fontWeight: "700" },
  convMeta: { color: colors.textDim, fontSize: 11, marginTop: 3 },
  convEj: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  sysLine: { color: colors.textDim, fontSize: 12, marginTop: 8 },
  kv: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  kvK: { color: colors.text, fontSize: 14 },
  kvV: { color: colors.textDim, fontSize: 13 },
});
