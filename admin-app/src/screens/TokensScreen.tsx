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
  AnthUsage,
  MensajeRow,
  TokenAudit,
  TokenConv,
  TokenDia,
  TokenGeneral,
  TokenMesTrend,
  TokenSource,
  getAnthropicUsage,
  getEtiguelMirrorMensajes,
  getPreferences,
  getTokenAudit,
  getTokenDia,
  getTokenGeneral,
  getTokenSources,
  putPreferences,
  recomputeTokens,
} from "../api";
import { useAuth } from "../auth";
import CostosInternos from "../components/CostosInternos";
import { Icon } from "../components/Icon";
import { ErrorBox, Loader } from "../components/ui";
import { colors } from "../theme";

const GENERAL = "__general__";

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
const hhmm = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "");
// Fecha + hora absolutas, ej "28/06 14:35". Para datar la oportunidad en el
// momento del uso de tokens (no solo "hace X días").
const fechaHora = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString("es-AR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      })
    : "";

export default function TokensScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [sources, setSources] = useState<TokenSource[]>([]);
  const [source, setSource] = useState(GENERAL);
  const [savedDefault, setSavedDefault] = useState(GENERAL);
  const [general, setGeneral] = useState<TokenGeneral | null>(null);
  const [data, setData] = useState<TokenAudit | null>(null);
  const [apiUsage, setApiUsage] = useState<AnthUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recomputando, setRecomputando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mesSel, setMesSel] = useState<number | null>(null);
  const [diaSel, setDiaSel] = useState<string | null>(null);   // fecha del día abierto (null = último)
  const [diaData, setDiaData] = useState<TokenDia | null>(null);
  const [diaLoading, setDiaLoading] = useState(false);
  const [convAbierta, setConvAbierta] = useState<string | null>(null);
  const [convMsgs, setConvMsgs] = useState<Record<string, MensajeRow[]>>({});
  const [convMsgsLoading, setConvMsgsLoading] = useState<string | null>(null);

  const abrirConv = useCallback(async (c: TokenConv) => {
    if (convAbierta === c.telefono) { setConvAbierta(null); return; }
    setConvAbierta(c.telefono);
    if (token && c.mirror_id && !convMsgs[c.telefono]) {
      setConvMsgsLoading(c.telefono);
      try {
        const m = await getEtiguelMirrorMensajes(token, c.mirror_id);
        setConvMsgs((prev) => ({ ...prev, [c.telefono]: m }));
      } catch { /* sin mensajes */ }
      finally { setConvMsgsLoading(null); }
    }
  }, [convAbierta, token, convMsgs]);

  // Sources + default guardado por el usuario (tilde). Default de fábrica: General.
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const [srcs, prefs] = await Promise.all([getTokenSources(token), getPreferences(token, "tokens")]);
        setSources(srcs);
        const def = (prefs.prefs as { default_source?: string })?.default_source;
        if (def && (def === GENERAL || srcs.some((s) => s.id === def))) { setSavedDefault(def); setSource(def); }
      } catch { /* usa el fallback General */ }
    })();
  }, [token]);
  useEffect(() => { if (token) getAnthropicUsage(token, 30).then(setApiUsage).catch(() => {}); }, [token]);
  useEffect(() => { setDiaSel(null); setDiaData(null); setConvAbierta(null); }, [source]);

  const setDefault = async () => {
    if (!token) return;
    const nuevo = savedDefault === source ? GENERAL : source;
    setSavedDefault(nuevo);
    try { await putPreferences(token, "tokens", { default_source: nuevo }); } catch { /* noop */ }
  };

  // Al abrir un día distinto del último, traer su detalle completo.
  useEffect(() => {
    if (!token || !diaSel || diaSel === data?.ultimo?.fecha) { setDiaData(null); return; }
    let vivo = true;
    setDiaLoading(true);
    getTokenDia(token, source, diaSel)
      .then((d) => { if (vivo) setDiaData(d); })
      .catch(() => { if (vivo) setDiaData(null); })
      .finally(() => { if (vivo) setDiaLoading(false); });
    return () => { vivo = false; };
  }, [token, diaSel, source, data?.ultimo?.fecha]);

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setError(null);
    try {
      if (source === GENERAL) setGeneral(await getTokenGeneral(token));
      else setData(await getTokenAudit(token, source, 14));
    }
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
  const dias = data?.tendencia ?? [];
  const meses = data?.serie_mensual ?? [];
  const maxDia = Math.max(0.001, ...dias.map((d) => d.costo_usd));
  const maxMes = Math.max(0.001, ...meses.map((m) => m.costo_usd));
  // Día mostrado: el último por defecto, o el que tocó el usuario en el gráfico.
  const verUltimo = !diaSel || diaSel === u?.fecha;
  const t = verUltimo ? u?.totales : diaData?.totales;
  const detFecha = verUltimo ? u?.fecha : (diaData?.fecha ?? diaSel);
  const nConv = (verUltimo ? u?.n_conversaciones : diaData?.n_conversaciones) ?? 0;
  const convsAll: TokenConv[] = (verUltimo ? (u?.conversaciones ?? u?.top_conversaciones) : diaData?.conversaciones) ?? [];
  const convs = convsAll.filter((c) => !c.es_sistema);
  const sistema = convsAll.find((c) => c.es_sistema);
  const mSel: TokenMesTrend | null = mesSel != null ? meses[mesSel] : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}>
      {error ? <ErrorBox message={error} onRetry={load} /> : null}

      <View style={styles.headerRow}>
        <View style={styles.pills}>
          {[{ id: GENERAL, nombre: "General (todos)" }, ...sources].map((s) => {
            const on = s.id === source;
            return <TouchableOpacity key={s.id} style={[styles.pill, on && styles.pillOn]} onPress={() => setSource(s.id)}>
              <Text style={[styles.pillText, on && styles.pillTextOn]}>{s.nombre}</Text></TouchableOpacity>;
          })}
        </View>
        {source !== GENERAL ? (
          <TouchableOpacity style={styles.recalc} onPress={recomputar} disabled={recomputando}>
            {recomputando ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Icon name="refresh" size={15} color={colors.onPrimary} />}
          </TouchableOpacity>
        ) : null}
      </View>
      <TouchableOpacity style={styles.defaultToggle} onPress={setDefault} activeOpacity={0.7}>
        <Icon name="check" size={13} color={savedDefault === source ? colors.primary : colors.textDim} strokeWidth={2.5} />
        <Text style={[styles.defaultText, savedDefault === source ? { color: colors.primary } : null]}>Definir por defecto</Text>
      </TouchableOpacity>
      <Text style={styles.nota}>Costo real estimado a tarifa MyClaw (10% off oficial). {source === GENERAL ? "Vista de todos los clientes." : "Tocá un día del gráfico para ver sus conversaciones."}</Text>

      {source === GENERAL ? (
        <>
          {/* Vista General: comparativa entre clientes */}
          {!general ? <Text style={styles.empty}>Cargando…</Text> : (
            <>
              <View style={styles.kpis}>
                <Kpi label="Gasto del mes" value={usd(general.totales.gasto_mes_actual)} />
                <Kpi label="Conversac." value={fmt(general.totales.conversaciones_mes)} />
                <Kpi label="Oportunid." value={fmt(general.totales.oportunidades_abiertas)} alert={general.totales.oportunidades_abiertas > 0} />
                <Kpi label="Clientes" value={fmt(general.totales.n_clientes)} />
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Gasto por cliente <Text style={styles.sub}>· este mes</Text></Text>
                {general.clientes.length === 0 ? <Text style={styles.empty}>Sin datos.</Text> : (
                  <View style={{ marginTop: 8, gap: 10 }}>
                    {general.clientes.map((c) => {
                      const max = Math.max(0.0001, ...general.clientes.map((x) => x.gasto_mes_actual));
                      const delta = c.gasto_mes_actual - c.gasto_mes_anterior;
                      return (
                        <View key={c.id}>
                          <View style={styles.hbarTop}>
                            <Text style={styles.hbarLabel} numberOfLines={1}>{c.nombre}</Text>
                            <Text style={styles.hbarVal}>
                              {usd(c.gasto_mes_actual)}
                              {delta !== 0 ? <Text style={{ color: delta > 0 ? colors.red : colors.green }}>{delta > 0 ? " ▲" : " ▼"}{usd(Math.abs(delta))}</Text> : null}
                            </Text>
                          </View>
                          <View style={styles.hbarTrack}>
                            <View style={[styles.hbarFill, { width: `${(c.gasto_mes_actual / max) * 100}%` }]} />
                          </View>
                          <Text style={styles.hbarSub}>{fmt(c.conversaciones_mes)} conv · {usd3(c.costo_por_conversacion)}/conv · {c.oportunidades_abiertas} oport.</Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>

              {apiUsage ? <CostosInternos data={apiUsage} /> : null}
            </>
          )}
        </>
      ) : (
      <>
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
                <Text style={styles.opMeta}>
                  detectada {fechaHora(o.primera_vez)} ({haceDias(o.primera_vez)})
                  {o.ultima_vez && o.ultima_vez !== o.primera_vez ? ` · últ. señal ${fechaHora(o.ultima_vez)}` : ""}
                </Text>
              </View>
            );
          })
        )}
      </View>

      {!u ? <Text style={styles.empty}>Sin datos del día. Tocá recalcular.</Text> : (
        <>
          <View style={styles.diaRow}>
            <Text style={styles.dia}>Día {detFecha}{verUltimo ? " (último)" : ""}</Text>
            {diaLoading ? <ActivityIndicator size="small" color={colors.textDim} /> : null}
            {!verUltimo ? <TouchableOpacity onPress={() => setDiaSel(null)}><Text style={styles.volver}>← volver al último</Text></TouchableOpacity> : null}
          </View>
          <View style={styles.kpis}>
            <Kpi label="Costo del día" value={usd(t?.costo_usd ?? 0)} />
            <Kpi label="Conversac." value={fmt(nConv)} />
            <Kpi label="Errores" value={fmt(t?.errores ?? 0)} alert={(t?.errores ?? 0) > 0} />
            <Kpi label="Timeouts" value={fmt(t?.timeouts ?? 0)} alert={(t?.timeouts ?? 0) > 0} />
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

          {/* Barras por día apiladas */}
          <View style={styles.card}>
            <View style={styles.legendRow}>
              <Text style={styles.cardTitle}>Costo por día</Text>
              <View style={styles.legend}>
                <Text style={styles.legItem}><Text style={{ color: colors.primary }}>■</Text> mensajes  <Text style={{ color: colors.red }}>■</Text> errores</Text>
              </View>
            </View>
            <Text style={styles.sub}>Tocá un día para ver sus conversaciones.</Text>
            <View style={[styles.bars, { marginTop: 10 }]}>
              {dias.map((d) => {
                const totalH = (d.costo_usd / maxDia) * 84;
                const errH = d.costo_usd > 0 ? (d.costo_errores / d.costo_usd) * totalH : 0;
                const selBar = detFecha === d.fecha;
                return (
                  <TouchableOpacity key={d.fecha} style={styles.barCol} activeOpacity={0.7}
                    onPress={() => { setDiaSel(d.fecha === diaSel || (verUltimo && d.fecha === u?.fecha) ? null : d.fecha); setConvAbierta(null); }}>
                    {selBar && d.costo_usd > 0 ? <Text style={styles.barVal}>{usd(d.costo_usd)}</Text> : null}
                    <View style={{ height: totalH, width: "72%", justifyContent: "flex-end", opacity: selBar || !diaSel ? 1 : 0.5 }}>
                      {errH > 0 && <View style={{ height: errH, backgroundColor: colors.red, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />}
                      <View style={{ flex: 1, backgroundColor: colors.primary }} />
                    </View>
                    <Text style={[styles.barLabel, selBar && { color: colors.primary, fontWeight: "700" }]}>{d.fecha.slice(5)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Conversaciones del día (tap = ver la conversación entera) */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Conversaciones del día <Text style={styles.sub}>· {convs.length} · tocá una</Text></Text>
            {convs.length === 0 ? <Text style={styles.empty}>{diaLoading ? "Cargando…" : "Sin conversaciones."}</Text> : convs.map((c, i) => {
              const abierta = convAbierta === c.telefono;
              const modelos = Object.entries(c.por_modelo ?? {}).sort((a, b) => b[1].costo_usd - a[1].costo_usd);
              const msgs = convMsgs[c.telefono];
              return (
                <TouchableOpacity key={c.telefono} activeOpacity={0.8}
                  style={[styles.convBox, { backgroundColor: i % 2 === 0 ? "#101D38" : "#1B2A47" }, abierta && styles.convBoxOpen]}
                  onPress={() => abrirConv(c)}>
                  <View style={styles.convTop}>
                    <Text style={styles.convTel}>{c.telefono}</Text>
                    <Text style={styles.convCost}>{usd3(c.costo_usd)}</Text>
                  </View>
                  {c.nombre ? <Text style={styles.convNombre}>{c.nombre}</Text> : null}
                  <Text style={styles.convMeta}>
                    {modelos.length > 0 ? modelos.map(([m]) => m.replace("claude-", "")).join(", ") : ""}
                    {c.timeouts > 0 ? ` · ${c.timeouts} timeout` : ""}{c.errores > 0 ? ` · ${c.errores} error` : ""}
                  </Text>
                  {!abierta && c.ejemplo ? <Text style={styles.convEj} numberOfLines={1}>“{c.ejemplo}”</Text> : null}
                  {abierta ? (
                    <View style={styles.convDet}>
                      {/* La conversación entera */}
                      {convMsgsLoading === c.telefono ? <ActivityIndicator size="small" color={colors.textDim} /> :
                        msgs && msgs.length > 0 ? (
                          <View style={styles.chat}>
                            {msgs.map((m) => <Burbuja key={m.id} m={m} />)}
                          </View>
                        ) : c.mirror_id ? <Text style={styles.empty}>Sin mensajes espejados.</Text> :
                          <Text style={styles.empty}>Conversación no encontrada en el espejo.</Text>}
                      {/* Detalle de costo (compacto): split por modelo + horario */}
                      <View style={styles.costoSep}>
                        {modelos.map(([m, v]) => (
                          <View key={m} style={styles.kv}><Text style={styles.detK}>{m}</Text><Text style={styles.detV}>{usd3(v.costo_usd)}</Text></View>
                        ))}
                        {(c.primer_ts || (c.compactaciones ?? 0) > 0) ? (
                          <View style={styles.detGrid}>
                            {c.primer_ts ? <Text style={styles.detItem}>Horario: <Text style={styles.detVal}>{hhmm(c.primer_ts)}–{hhmm(c.ultimo_ts)}</Text></Text> : null}
                            {(c.compactaciones ?? 0) > 0 ? <Text style={styles.detItem}>Compact.: <Text style={[styles.detVal, { color: colors.amber }]}>{c.compactaciones}</Text></Text> : null}
                          </View>
                        ) : null}
                      </View>
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
            {sistema ? <Text style={styles.sysLine}>+ sistema (crons/mantenimiento): {usd3(sistema.costo_usd)}</Text> : null}
          </View>

          {/* Por modelo — mes */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Por modelo · mes {data!.mes_actual}</Text>
            {Object.keys(data!.por_modelo_mes).length === 0 ? <Text style={styles.empty}>Sin datos del mes.</Text> :
              Object.entries(data!.por_modelo_mes).sort((a, b) => b[1].costo_usd - a[1].costo_usd).map(([m, v]) => (
                <View key={m} style={styles.kv}><Text style={styles.kvK}>{m}</Text><Text style={styles.kvV}>{usd(v.costo_usd)}</Text></View>
              ))}
          </View>
        </>
      )}
      </>
      )}
    </ScrollView>
  );
}

function Kpi({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return <View style={styles.kpi}><Text style={[styles.kpiVal, alert && { color: colors.red }]}>{value}</Text><Text style={styles.kpiLabel}>{label}</Text></View>;
}

function Burbuja({ m }: { m: MensajeRow }) {
  const out = m.direccion === "out";
  return (
    <View style={[styles.bubRow, { justifyContent: out ? "flex-end" : "flex-start" }]}>
      <View style={[styles.bub, out ? styles.bubOut : styles.bubIn]}>
        <Text style={styles.bubText}>{m.texto}</Text>
      </View>
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
  defaultToggle: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8, alignSelf: "flex-start" },
  defaultText: { color: colors.textDim, fontSize: 11, fontWeight: "700" },
  hbarTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  hbarLabel: { color: colors.text, fontSize: 13, fontWeight: "600", flex: 1, marginRight: 8 },
  hbarVal: { color: colors.textDim, fontSize: 12, fontWeight: "600" },
  hbarTrack: { height: 9, borderRadius: 999, backgroundColor: colors.bg, overflow: "hidden" },
  hbarFill: { height: "100%", borderRadius: 999, backgroundColor: colors.primary },
  hbarSub: { color: colors.textDim, fontSize: 10, marginTop: 3 },
  nota: { color: colors.textDim, fontSize: 11, marginTop: 8 },
  empty: { color: colors.textDim, fontSize: 13, marginTop: 6 },
  diaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  dia: { color: colors.textDim, fontSize: 12 },
  volver: { color: colors.primary, fontSize: 12, fontWeight: "600" },
  barVal: { color: colors.primary, fontSize: 9, fontWeight: "700", marginBottom: 2 },
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
  apiHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  apiTotal: { color: colors.text, fontSize: 14, fontWeight: "700" },
  apiRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  apiFn: { color: colors.text, fontSize: 13 },
  apiMeta: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  apiCost: { color: colors.text, fontSize: 13, fontWeight: "600" },
  apiNota: { color: colors.textDim, fontSize: 10, marginTop: 8 },
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
  convBox: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8 },
  convBoxOpen: { borderWidth: 1, borderColor: colors.primary + "55" },
  convTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  convTel: { color: colors.text, fontSize: 15, fontWeight: "700" },
  convNombre: { color: colors.text, fontSize: 13, fontWeight: "500", marginTop: 1 },
  convCost: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  convMeta: { color: colors.textDim, fontSize: 11, marginTop: 3 },
  chat: { gap: 4 },
  bubRow: { flexDirection: "row" },
  bub: { maxWidth: "85%", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  bubOut: { backgroundColor: colors.primary + "22", borderColor: colors.primary + "44", borderWidth: 1 },
  bubIn: { backgroundColor: "#0C1730" },
  bubText: { color: colors.text, fontSize: 13 },
  costoSep: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border, gap: 3 },
  convEj: { color: colors.textDim, fontSize: 12, marginTop: 3, fontStyle: "italic" },
  convDet: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border, gap: 3 },
  detK: { color: colors.text, fontSize: 12 },
  detV: { color: colors.textDim, fontSize: 12 },
  detGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 4 },
  detItem: { color: colors.textDim, fontSize: 11, width: "50%", marginTop: 2 },
  detVal: { color: colors.text, fontWeight: "600" },
  sysLine: { color: colors.textDim, fontSize: 12, marginTop: 8 },
  kv: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  kvK: { color: colors.text, fontSize: 14 },
  kvV: { color: colors.textDim, fontSize: 13 },
});
