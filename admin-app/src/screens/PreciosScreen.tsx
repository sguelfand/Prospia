import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  PrecioServicio,
  PreciosClientePatch,
  PreciosResumen,
  TokenSource,
  getPreciosResumen,
  getTokenSources,
  postPreciosServicioCliente,
  putPreciosCliente,
} from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import { ErrorBox, Loader } from "../components/ui";
import { PreciosProps } from "../navigation";
import { colors } from "../theme";

// ── Formato ──────────────────────────────────────────────────────────────────
const usd = (n: number | null | undefined, dec = 2) =>
  n === null || n === undefined ? "—" : "$" + n.toFixed(dec);
// Precio por token → $/millón de tokens.
const perM = (n: number) => "$" + (n * 1e6).toFixed(2);
const numToStr = (n: number | null | undefined, dec: number) =>
  n === null || n === undefined ? "" : String(Number(n.toFixed(dec)));

// Chip del origen del $/conv: de dónde sale el número.
const ORIGEN: Record<string, { color: string; label: string }> = {
  medido: { color: colors.green, label: "medido" },
  simulado: { color: colors.blue, label: "simulado" },
  manual: { color: colors.textDim, label: "manual" },
  estimado_etiguel: { color: colors.amber, label: "estimado Etiguel" },
};

// Las dos líneas de tokens vienen aparte (tokens_bot_mes / anthropic_mes):
// salteamos sus servicios "variables" para no mostrarlas dos veces.
const esLineaTokens = (s: PrecioServicio) =>
  /token|anthropic/i.test(String(s.id)) || /token/i.test(s.nombre);

// ── Inputs editables (tap = editar, guarda al salir del campo) ───────────────
function NumInput({
  value,
  dec = 2,
  placeholder = "—",
  onCommit,
  width = 96,
}: {
  value: number | null | undefined;
  dec?: number;
  placeholder?: string;
  onCommit: (n: number) => void;
  width?: number;
}) {
  const [txt, setTxt] = useState(numToStr(value, dec));
  useEffect(() => {
    setTxt(numToStr(value, dec));
  }, [value, dec]);
  const commit = () => {
    const v = parseFloat(txt.trim().replace(",", "."));
    if (!Number.isFinite(v)) {
      setTxt(numToStr(value, dec)); // inválido → volver al valor real
      return;
    }
    if (value === null || value === undefined || Math.abs(v - value) > 1e-9) onCommit(v);
  };
  return (
    <TextInput
      style={[styles.numInput, { width }]}
      value={txt}
      onChangeText={setTxt}
      onEndEditing={commit}
      keyboardType="decimal-pad"
      placeholder={placeholder}
      placeholderTextColor={placeholder === "falta cargar" ? colors.amber : colors.textDim}
      selectTextOnFocus
    />
  );
}

function TxtInput({
  value,
  placeholder,
  onCommit,
  multiline,
}: {
  value: string | null | undefined;
  placeholder: string;
  onCommit: (s: string | null) => void;
  multiline?: boolean;
}) {
  const [txt, setTxt] = useState(value ?? "");
  useEffect(() => {
    setTxt(value ?? "");
  }, [value]);
  const commit = () => {
    const v = txt.trim();
    if (v !== (value ?? "")) onCommit(v.length > 0 ? v : null);
  };
  return (
    <TextInput
      style={[styles.txtInput, multiline && styles.txtInputMulti]}
      value={txt}
      onChangeText={setTxt}
      onEndEditing={commit}
      placeholder={placeholder}
      placeholderTextColor={colors.textDim}
      multiline={multiline}
    />
  );
}

// ── Pantalla ─────────────────────────────────────────────────────────────────
export default function PreciosScreen(_props: PreciosProps) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [sources, setSources] = useState<TokenSource[]>([]);
  const [source, setSource] = useState("etiguel");
  const [data, setData] = useState<PreciosResumen | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clientes para el selector (mismos sources que Tokens).
  useEffect(() => {
    if (!token) return;
    getTokenSources(token)
      .then((s) => {
        setSources(s);
        if (s.length > 0 && !s.some((x) => x.id === "etiguel")) setSource(s[0].id);
      })
      .catch(() => setSources([{ id: "etiguel", nombre: "Etiguel (Camila)" }]));
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      setData(await getPreciosResumen(token, source));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el pricing.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, source]);
  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Guardar un campo del pricing y recargar (el backend recalcula margen/faltantes).
  const savePricing = async (campos: PreciosClientePatch) => {
    if (!token) return;
    setSaving(true);
    try {
      await putPreciosCliente(token, source, campos);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  // Override del costo de un servicio para este cliente.
  const saveServicio = async (s: PrecioServicio, n: number) => {
    if (!token) return;
    setSaving(true);
    try {
      await postPreciosServicioCliente(token, source, {
        nombre: s.nombre,
        costo_mensual_usd: n,
        tipo: s.tipo,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el costo.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loader />;

  const p = data?.pricing;
  const origen = p ? ORIGEN[p.costo_conv_origen] ?? ORIGEN.manual : null;
  const variables = (data?.costos.variables ?? []).filter((s) => !esLineaTokens(s));
  const fijos = data?.costos.fijos_cliente ?? [];
  const m = data?.margen ?? null;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
      >
        {/* Selector de cliente */}
        <View style={styles.pills}>
          {sources.map((s) => {
            const on = s.id === source;
            return (
              <TouchableOpacity key={s.id} style={[styles.pill, on && styles.pillOn]} onPress={() => setSource(s.id)}>
                <Text style={[styles.pillText, on && styles.pillTextOn]}>{s.nombre}</Text>
              </TouchableOpacity>
            );
          })}
          {saving ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </View>
        <Text style={styles.intro}>
          Qué le cobrás a este cliente, qué te cuesta y el margen. Tocá un valor para editarlo.
        </Text>

        {error ? <ErrorBox message={error} onRetry={load} /> : null}

        {data && p ? (
          <>
            {/* ── Parámetros comerciales ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Parámetros comerciales</Text>

              <View style={styles.row}>
                <Text style={styles.rowLabel}>Abono mensual (USD)</Text>
                <NumInput value={p.abono_mensual_usd} placeholder="falta cargar"
                  onCommit={(n) => savePricing({ abono_mensual_usd: n })} />
              </View>

              <View style={styles.row}>
                <Text style={styles.rowLabel}>Conversaciones por día</Text>
                <NumInput value={p.conversaciones_dia} dec={1} placeholder="falta cargar"
                  onCommit={(n) => savePricing({ conversaciones_dia: n })} />
              </View>

              <View style={styles.row}>
                <View style={styles.rowLabelBox}>
                  <Text style={styles.rowLabel}>Costo por conversación (USD)</Text>
                  {origen ? (
                    <View style={[styles.chip, { borderColor: origen.color }]}>
                      <Text style={[styles.chipText, { color: origen.color }]}>{origen.label}</Text>
                    </View>
                  ) : null}
                </View>
                <NumInput value={p.costo_conv_usd} dec={4} placeholder="falta cargar"
                  onCommit={(n) => savePricing({ costo_conv_usd: n })} />
              </View>

              {p.costo_conv_origen === "estimado_etiguel" ? (
                <Text style={styles.leyendaAmbar}>
                  Estimación con valores de Etiguel — correr simulación en la web para valores reales.
                </Text>
              ) : null}

              {data.medido ? (
                <Text style={styles.medido}>
                  Medido: <Text style={styles.medidoVal}>{usd(data.medido.valor, 4)}</Text>/conv en {data.medido.mes} ·{" "}
                  {data.medido.conversaciones} conv · {usd(data.medido.costo_mes)} el mes
                </Text>
              ) : null}
              <Text style={styles.nota}>El monitor avisa si el costo real se desvía ±{data.desvio_alerta_pct}%.</Text>

              <Text style={styles.rowLabelSolo}>Notas</Text>
              <TxtInput value={p.notas} placeholder="Notas del acuerdo…" multiline
                onCommit={(s) => savePricing({ notas: s })} />
            </View>

            {/* ── Motores LLM ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Motores LLM</Text>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Primario</Text>
                <TxtInput value={p.motor_primario} placeholder="motor primario"
                  onCommit={(s) => savePricing({ motor_primario: s })} />
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Fallback</Text>
                <TxtInput value={p.motor_fallback} placeholder="motor fallback"
                  onCommit={(s) => savePricing({ motor_fallback: s })} />
              </View>

              {data.motores_registrados.length > 0 ? (
                <View style={styles.motores}>
                  {data.motores_registrados.map((mo, i) => (
                    <View key={mo.id} style={[styles.motor, i > 0 && styles.borderTop]}>
                      <View style={styles.motorTop}>
                        <Text style={styles.motorNombre}>{mo.nombre}</Text>
                        {mo.es_actual ? (
                          <View style={[styles.chip, { borderColor: colors.green }]}>
                            <Text style={[styles.chipText, { color: colors.green }]}>actual</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.motorMeta}>{mo.provider} · {mo.model_id}</Text>
                      <Text style={styles.motorPrecios}>
                        in {perM(mo.precio_in)} · out {perM(mo.precio_out)} · cache R {perM(mo.precio_cache_read)} · cache W {perM(mo.precio_cache_write)}
                        <Text style={styles.motorPerM}>  ($/M tokens)</Text>
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.empty}>Sin motores registrados.</Text>
              )}
            </View>

            {/* ── Costos mensuales ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Costos mensuales</Text>

              <View style={styles.row}>
                <View style={styles.rowLabelBox}>
                  <Text style={styles.rowLabel}>Tokens del bot</Text>
                  <Text style={styles.rowTag}>calculado</Text>
                </View>
                <Text style={styles.rowVal}>{usd(data.costos.tokens_bot_mes)}</Text>
              </View>
              <View style={styles.row}>
                <View style={styles.rowLabelBox}>
                  <Text style={styles.rowLabel}>Tokens internos Anthropic</Text>
                  <Text style={styles.rowTag}>real del mes</Text>
                </View>
                <Text style={styles.rowVal}>{usd(data.costos.anthropic_mes)}</Text>
              </View>

              {[...variables, ...fijos].map((s) => (
                <View key={`${s.tipo}-${s.id}`} style={styles.rowServicio}>
                  <View style={styles.rowLabelBox}>
                    <Text style={styles.rowLabel}>{s.nombre}</Text>
                    {s.detalle ? <Text style={styles.detalle}>{s.detalle}</Text> : null}
                  </View>
                  <NumInput value={s.costo_mensual_usd} placeholder="falta cargar" width={90}
                    onCommit={(n) => saveServicio(s, n)} />
                </View>
              ))}

              <View style={[styles.row, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalVal}>{usd(data.costos.total)}</Text>
              </View>
            </View>

            {/* ── Margen ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Margen</Text>
              {m ? (
                <>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Abono</Text>
                    <Text style={styles.rowVal}>{usd(m.abono)}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Costos</Text>
                    <Text style={styles.rowVal}>−{usd(m.costo_total)}</Text>
                  </View>
                  <View style={[styles.row, styles.totalRow]}>
                    <Text style={styles.totalLabel}>Ganancia</Text>
                    <Text style={[styles.totalVal, { color: m.ganancia >= 0 ? colors.green : colors.red }]}>
                      {usd(m.ganancia)} · {m.pct.toFixed(0)}%
                    </Text>
                  </View>
                  {/* Proporción costo vs ganancia sobre el abono */}
                  <View style={styles.barTrack}>
                    {m.ganancia >= 0 ? (
                      <>
                        <View style={{ flex: Math.max(m.costo_total, 0.0001), backgroundColor: "#3E5378" }} />
                        <View style={{ flex: Math.max(m.ganancia, 0.0001), backgroundColor: colors.green }} />
                      </>
                    ) : (
                      <View style={{ flex: 1, backgroundColor: colors.red }} />
                    )}
                  </View>
                  <Text style={styles.nota}>Gris: costos · Verde: ganancia{m.ganancia < 0 ? " · Rojo: margen negativo" : ""}</Text>
                </>
              ) : (
                <Text style={styles.empty}>Cargá el abono mensual para ver el margen.</Text>
              )}
            </View>

            {/* ── Datos faltantes ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Datos faltantes</Text>
              {data.datos_faltantes.length === 0 ? (
                <View style={styles.faltanteRow}>
                  <Icon name="check" size={15} color={colors.green} strokeWidth={2.5} />
                  <Text style={[styles.faltanteText, { color: colors.green }]}>No falta ningún dato</Text>
                </View>
              ) : (
                data.datos_faltantes.map((d, i) => (
                  <View key={i} style={styles.faltanteRow}>
                    <Icon name="alert" size={15} color={colors.amber} />
                    <Text style={styles.faltanteText}>{d}</Text>
                  </View>
                ))
              )}
            </View>

            {/* ── Estructura compartida ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                Estructura <Text style={styles.sub}>· compartida entre clientes</Text>
              </Text>
              {data.estructura.servicios.length === 0 ? (
                <Text style={styles.empty}>Sin servicios compartidos.</Text>
              ) : (
                data.estructura.servicios.map((s) => (
                  <View key={`${s.tipo}-${s.id}`} style={styles.rowServicio}>
                    <View style={styles.rowLabelBox}>
                      <Text style={styles.rowLabel}>{s.nombre}</Text>
                      {s.detalle ? <Text style={styles.detalle}>{s.detalle}</Text> : null}
                    </View>
                    <Text style={styles.rowVal}>
                      {s.costo_mensual_usd === null ? <Text style={{ color: colors.amber }}>falta cargar</Text> : usd(s.costo_mensual_usd)}
                    </Text>
                  </View>
                ))
              )}
              <View style={[styles.row, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalVal}>{usd(data.estructura.total)}</Text>
              </View>
              <Text style={styles.nota}>
                Prorrateo: {usd(data.estructura.prorrateo_por_cliente)} por cliente ({data.estructura.n_clientes}{" "}
                {data.estructura.n_clientes === 1 ? "cliente" : "clientes"}) — no entra al margen por cliente.
              </Text>
            </View>
          </>
        ) : !error ? (
          <Text style={styles.empty}>Sin datos de pricing para este cliente.</Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  pill: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  pillTextOn: { color: colors.onPrimary },
  intro: { color: colors.textDim, fontSize: 12, marginTop: 10, marginBottom: 4, lineHeight: 17 },

  card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginTop: 14, borderColor: colors.border, borderWidth: 1 },
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: "700", textTransform: "uppercase", marginBottom: 6 },
  sub: { color: colors.textDim, fontSize: 11, fontWeight: "400", textTransform: "none" },

  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 7, gap: 10 },
  rowServicio: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 7, gap: 10, borderTopWidth: 1, borderTopColor: colors.border },
  rowLabelBox: { flex: 1, flexDirection: "column", alignItems: "flex-start", gap: 3 },
  rowLabel: { color: colors.text, fontSize: 14 },
  rowLabelSolo: { color: colors.text, fontSize: 14, marginTop: 10, marginBottom: 6 },
  rowVal: { color: colors.text, fontSize: 14, fontWeight: "600" },
  rowTag: { color: colors.textDim, fontSize: 10, fontStyle: "italic" },
  detalle: { color: colors.textDim, fontSize: 11, lineHeight: 15 },

  numInput: {
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: 8,
    color: colors.text, fontSize: 14, fontWeight: "600", paddingHorizontal: 10, paddingVertical: 6,
    textAlign: "right",
  },
  txtInput: {
    backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: 8,
    color: colors.text, fontSize: 13, paddingHorizontal: 10, paddingVertical: 6, minWidth: 150,
    flexShrink: 1,
  },
  txtInputMulti: { minHeight: 60, textAlignVertical: "top", alignSelf: "stretch" },

  chip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" },
  chipText: { fontSize: 10, fontWeight: "700" },
  leyendaAmbar: { color: colors.amber, fontSize: 11, lineHeight: 16, marginTop: 4 },
  medido: { color: colors.textDim, fontSize: 12, marginTop: 8 },
  medidoVal: { color: colors.green, fontWeight: "700" },
  nota: { color: colors.textDim, fontSize: 11, marginTop: 6 },

  motores: { marginTop: 8 },
  motor: { paddingVertical: 8 },
  borderTop: { borderTopWidth: 1, borderTopColor: colors.border },
  motorTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  motorNombre: { color: colors.text, fontSize: 13, fontWeight: "600", flex: 1 },
  motorMeta: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  motorPrecios: { color: colors.textDim, fontSize: 11, marginTop: 3 },
  motorPerM: { fontStyle: "italic" },

  totalRow: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4 },
  totalLabel: { color: colors.text, fontSize: 14, fontWeight: "800" },
  totalVal: { color: colors.text, fontSize: 15, fontWeight: "800" },

  barTrack: { flexDirection: "row", height: 10, borderRadius: 999, overflow: "hidden", backgroundColor: colors.bg, marginTop: 10 },

  faltanteRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  faltanteText: { color: colors.text, fontSize: 13, flex: 1 },

  empty: { color: colors.textDim, fontSize: 13, marginTop: 6 },
});
