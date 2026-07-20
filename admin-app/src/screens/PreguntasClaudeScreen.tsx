import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Animated, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  OpcionPregunta, PreguntaClaude, PreguntaItem, eliminarPreguntaClaude, getPreguntaClaude, getPreguntasClaude, responderPreguntaClaude,
} from "../api";
import { useAuth } from "../auth";
import { ErrorBox, Loader } from "../components/ui";
import { Icon } from "../components/Icon";
import { SwipeRow } from "../components/SwipeRow";
import { PreguntasClaudeProps } from "../navigation";
import { colors } from "../theme";

function tiempoRelativo(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

type Filtro = "pendiente" | "respondida";

export default function PreguntasClaudeScreen({ navigation, route }: PreguntasClaudeProps) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<PreguntaClaude[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("pendiente");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<PreguntaClaude | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setItems(await getPreguntasClaude(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar las preguntas.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Deep-link: si llegamos desde el push con preguntaId, abrir directo esa tanda.
  useEffect(() => {
    const id = route.params?.preguntaId;
    if (id == null || !token) return;
    (async () => {
      const enLista = items.find((x) => x.id === id);
      if (enLista) { setFiltro(enLista.estado === "respondida" ? "respondida" : "pendiente"); setAbierta(enLista); }
      else {
        try { const p = await getPreguntaClaude(token, id); setAbierta(p); } catch { /* la lista alcanza */ }
      }
    })();
    navigation.setParams({ preguntaId: undefined });
  }, [route.params?.preguntaId, items, token]);

  const onResuelta = (actualizada: PreguntaClaude) => {
    setItems((prev) => {
      const existe = prev.some((x) => x.id === actualizada.id);
      return existe ? prev.map((x) => (x.id === actualizada.id ? actualizada : x)) : [actualizada, ...prev];
    });
    setAbierta(null);
  };

  const borrar = async (p: PreguntaClaude) => {
    if (!token) return;
    const snap = items;
    setItems((prev) => prev.filter((x) => x.id !== p.id));
    if (abierta?.id === p.id) setAbierta(null);
    try {
      await eliminarPreguntaClaude(token, p.id);
    } catch {
      setItems(snap);
    }
  };

  const confirmarBorrar = (p: PreguntaClaude) => {
    Alert.alert("Borrar pregunta", "¿Seguro? No se puede deshacer.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Borrar", style: "destructive", onPress: () => borrar(p) },
    ]);
  };

  if (loading) return <Loader />;

  const visibles = items.filter((p) => p.estado === filtro);
  const n = (s: Filtro) => items.filter((p) => p.estado === s).length;

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.tabs}>
          <Tab label={`Pendientes (${n("pendiente")})`} active={filtro === "pendiente"} onPress={() => setFiltro("pendiente")} />
          <Tab label={`Respondidas (${n("respondida")})`} active={filtro === "respondida"} onPress={() => setFiltro("respondida")} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        {error ? <ErrorBox message={error} onRetry={load} /> : null}

        {visibles.map((p) => {
          const respondida = p.estado === "respondida";
          const borderColor = respondida ? colors.green : colors.amber;
          const qs = p.preguntas?.length ? p.preguntas : [{ pregunta: p.pregunta, opciones: [], header: p.header, multiselect: false }];
          const primera = qs[0];
          const varias = qs.length > 1;
          return (
            <SwipeRow
              key={p.id}
              left={{ icon: "trash", color: colors.red, onTrigger: () => confirmarBorrar(p) }}
              right={{ icon: "trash", color: colors.red, onTrigger: () => confirmarBorrar(p) }}
            >
            <TouchableOpacity style={[styles.card, { borderLeftColor: borderColor }]} onPress={() => setAbierta(p)} activeOpacity={0.7}>
              <View style={styles.row}>
                <View style={styles.emoji}><Icon name="flag" size={18} color={borderColor} /></View>
                <View style={styles.body}>
                  <View style={styles.headerRow}>
                    <Text style={styles.titulo} numberOfLines={1}>
                      #{p.id} · {primera.header || (varias ? `${qs.length} preguntas` : "Claude pregunta")}
                    </Text>
                    <Text style={styles.tiempo}>{tiempoRelativo(p.fecha)}</Text>
                  </View>
                  <Text style={styles.detalle} numberOfLines={3}>
                    {varias ? `${qs.length} preguntas · ` : ""}{primera.pregunta}
                  </Text>
                  {respondida ? (
                    <Text style={styles.badgeFixed} numberOfLines={1}>✓ {p.elegida}</Text>
                  ) : (
                    <Text style={styles.badgePend}>
                      Esperando tu respuesta{varias ? ` · ${qs.length} preguntas` : ` · ${primera.opciones.length} opciones`}
                    </Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
            </SwipeRow>
          );
        })}

        {visibles.length === 0 && !error ? (
          <Text style={styles.empty}>
            {filtro === "pendiente"
              ? "No hay preguntas pendientes.\nCuando el switch \"Preguntas al cel\" está prendido y Claude te pregunta algo, aparece acá."
              : "Todavía no respondiste ninguna."}
          </Text>
        ) : null}
      </ScrollView>

      <DetalleModal pregunta={abierta} token={token} onClose={() => setAbierta(null)} onResuelta={onResuelta} />
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

export function DetalleModal({ pregunta, token, onClose, onResuelta }: {
  pregunta: PreguntaClaude | null;
  token: string | null;
  onClose: () => void;
  onResuelta: (p: PreguntaClaude) => void;
}) {
  const qs: PreguntaItem[] = pregunta?.preguntas?.length
    ? pregunta.preguntas
    : pregunta ? [{ pregunta: pregunta.pregunta, opciones: [], header: pregunta.header, multiselect: false }] : [];

  // Selección por pregunta: single = string; multi = string[]. + texto libre por pregunta.
  const [sel, setSel] = useState<(string | string[])[]>([]);
  const [otra, setOtra] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [verCtx, setVerCtx] = useState(false);
  const [exito, setExito] = useState<string | null>(null);   // muestra el cartel "Respuesta enviada"
  const pulse = useRef(new Animated.Value(1)).current;       // rebote al tocar una opción

  useEffect(() => {
    setSel(qs.map((q) => (q.multiselect ? [] : "")));
    setOtra(qs.map(() => ""));
    setErr(null);
    setEnviando(false);
    setVerCtx(false);
    setExito(null);
  }, [pregunta?.id]);

  if (!pregunta) return null;
  const pendiente = pregunta.estado === "pendiente";
  const unaSingle = qs.length === 1 && !qs[0].multiselect;  // fast-path: tap = enviar

  const respuestaDe = (i: number): string => {
    const libre = (otra[i] || "").trim();
    if (libre) return libre;
    const s = sel[i];
    return Array.isArray(s) ? s.join("\n") : (s || "");
  };
  const todasRespondidas = qs.every((_, i) => respuestaDe(i));

  const setOtraI = (i: number, v: string) => setOtra((p) => p.map((x, j) => (j === i ? v : x)));

  const toggle = (i: number, label: string) => {
    const q = qs[i];
    if (q.multiselect) {
      setSel((p) => p.map((s, j) => {
        if (j !== i) return s;
        const arr = Array.isArray(s) ? s : [];
        return arr.includes(label) ? arr.filter((x) => x !== label) : [...arr, label];
      }));
    } else if (unaSingle) {
      // 1 sola pregunta single-select → marcar (feedback visible) + rebote + enviar directo.
      setSel((p) => p.map((s, j) => (j === i ? label : s)));
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.96, duration: 80, useNativeDriver: true }),
        Animated.spring(pulse, { toValue: 1, friction: 4, useNativeDriver: true }),
      ]).start();
      enviar([label]);
    } else {
      setSel((p) => p.map((s, j) => (j === i ? label : s)));
    }
  };

  const enviar = async (override?: string[]) => {
    if (!token || enviando) return;
    const respuestas = override ?? qs.map((_, i) => respuestaDe(i));
    if (respuestas.some((r) => !r)) { setErr("Respondé todas las preguntas."); return; }
    setEnviando(true);
    setErr(null);
    try {
      const actualizada = await responderPreguntaClaude(token, pregunta.id, respuestas);
      // Cartel de "respuesta enviada" antes de cerrar (que se note que se registró).
      setEnviando(false);
      setExito(respuestas.join(", "));
      setTimeout(() => onResuelta(actualizada), 1100);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo enviar la respuesta.");
      setEnviando(false);
    }
  };

  const selectedEn = (i: number, label: string) => {
    const s = sel[i];
    return Array.isArray(s) ? s.includes(label) : s === label;
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{qs.length > 1 ? `${qs.length} preguntas` : "Pregunta de Claude"}</Text>
            <TouchableOpacity onPress={onClose}><Icon name="x" size={18} color={colors.textDim} /></TouchableOpacity>
          </View>
          {pregunta.contexto ? (
            <TouchableOpacity style={styles.ctxBtn} onPress={() => setVerCtx(true)} activeOpacity={0.7}>
              <Icon name="info" size={14} color={colors.primary} />
              <Text style={styles.ctxBtnText}>Ver detalle / contexto</Text>
            </TouchableOpacity>
          ) : null}

          {exito ? (
            <View style={styles.exitoBox}>
              <View style={styles.exitoCirc}><Icon name="check" size={34} color={colors.green} /></View>
              <Text style={styles.exitoTitle}>Respuesta enviada</Text>
              <Text style={styles.exitoSel} numberOfLines={2}>{exito}</Text>
            </View>
          ) : pendiente ? (
            <>
              <ScrollView style={styles.scroll}>
                {qs.map((q, i) => (
                  <Animated.View key={i} style={[styles.qBlock, i > 0 && styles.qBlockSep, unaSingle ? { transform: [{ scale: pulse }] } : null]}>
                    {q.header ? <Text style={styles.chip}>{q.header}</Text> : null}
                    <Text style={styles.pregunta}>{q.pregunta}</Text>
                    {q.multiselect ? <Text style={styles.hint}>Podés elegir varias</Text> : null}

                    {q.opciones.map((o: OpcionPregunta, k) => {
                      const on = selectedEn(i, o.label);
                      const enviandoEsta = enviando && on;
                      return (
                        <TouchableOpacity
                          key={`${o.label}-${k}`}
                          style={[styles.opt, on && styles.optSel]}
                          onPress={() => toggle(i, o.label)}
                          disabled={enviando}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.optK}>{k + 1}</Text>
                          <View style={styles.optBody}>
                            <Text style={styles.optLabel}>{o.label}</Text>
                            {o.description ? <Text style={styles.optDesc}>{o.description}</Text> : null}
                          </View>
                          {enviandoEsta ? <Text style={styles.optEnviando}>Enviando…</Text> : on ? <Icon name="check" size={16} color={colors.primary} /> : null}
                        </TouchableOpacity>
                      );
                    })}

                    <TextInput
                      style={styles.input}
                      value={otra[i] ?? ""}
                      onChangeText={(v) => setOtraI(i, v)}
                      placeholder={q.opciones.length ? "Otra opción (texto libre)…" : "Escribí tu respuesta…"}
                      placeholderTextColor={colors.textDim}
                      multiline
                    />
                  </Animated.View>
                ))}
              </ScrollView>

              {err ? <Text style={styles.errText}>{err}</Text> : null}
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalBtnGhost} onPress={onClose}>
                  <Text style={styles.modalBtnGhostText}>Cerrar</Text>
                </TouchableOpacity>
                {!unaSingle || todasRespondidas ? (
                  <TouchableOpacity
                    style={[styles.modalBtnPrimary, (enviando || !todasRespondidas) && styles.btnOff]}
                    onPress={() => enviar()}
                    disabled={enviando || !todasRespondidas}
                  >
                    <Icon name="send" size={14} color={colors.bg} />
                    <Text style={styles.modalBtnPrimaryText}>{enviando ? "Enviando…" : "Enviar"}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>Respondiste {pregunta.fecha_respuesta ? `· ${tiempoRelativo(pregunta.fecha_respuesta)}` : ""}</Text>
              <ScrollView style={styles.scroll}>
                {qs.map((q, i) => (
                  <View key={i} style={[styles.qBlock, i > 0 && styles.qBlockSep]}>
                    {q.header ? <Text style={styles.chip}>{q.header}</Text> : null}
                    <Text style={styles.preguntaSm}>{q.pregunta}</Text>
                    <View style={styles.elegidaBox}>
                      <Icon name="check" size={15} color={colors.green} />
                      <Text style={styles.elegidaText}>{(pregunta.respuestas?.[i] ?? pregunta.elegida ?? "").replace(/\n/g, ", ")}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.modalBtnGhost, { flex: 1 }]} onPress={onClose}>
                  <Text style={styles.modalBtnGhostText}>Cerrar</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {pregunta.contexto ? (
          <Modal visible={verCtx} transparent animationType="fade" onRequestClose={() => setVerCtx(false)}>
            <View style={styles.ctxBackdrop}>
              <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setVerCtx(false)} />
              <View style={styles.ctxCard}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Detalle / contexto</Text>
                  <TouchableOpacity onPress={() => setVerCtx(false)}><Icon name="x" size={18} color={colors.textDim} /></TouchableOpacity>
                </View>
                <ScrollView style={styles.ctxScroll} contentContainerStyle={{ paddingBottom: 8 }}>
                  <Text style={styles.ctxText}>{pregunta.contexto}</Text>
                </ScrollView>
                <TouchableOpacity style={[styles.modalBtnGhost, { marginTop: 14 }]} onPress={() => setVerCtx(false)}>
                  <Text style={styles.modalBtnGhostText}>Cerrar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabs: { flexDirection: "row", gap: 6, flex: 1 },
  tab: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.cardAlt, borderColor: colors.primary },
  tabText: { color: colors.textDim, fontSize: 13, fontWeight: "700" },
  tabTextActive: { color: colors.text },
  content: { padding: 12 },
  card: { backgroundColor: colors.card, borderRadius: 14, borderLeftWidth: 4, padding: 14, marginBottom: 10 },
  row: { flexDirection: "row", alignItems: "flex-start" },
  emoji: { marginRight: 12, marginTop: 2 },
  body: { flex: 1 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  titulo: { color: colors.text, fontSize: 15, fontWeight: "700", flex: 1 },
  tiempo: { color: colors.textDim, fontSize: 12 },
  detalle: { color: colors.textDim, fontSize: 13, marginTop: 5, lineHeight: 18 },
  badgePend: { color: colors.amber, fontSize: 11, fontWeight: "700", marginTop: 8 },
  badgeFixed: { color: colors.green, fontSize: 11, fontWeight: "700", marginTop: 8 },
  empty: { color: colors.textDim, textAlign: "center", marginTop: 40, paddingHorizontal: 24, lineHeight: 20 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 22 },
  modalCard: { backgroundColor: colors.card, borderRadius: 18, padding: 18, width: "100%", maxWidth: 440, maxHeight: "88%" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6, minHeight: 22 },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  ctxBtn: { flexDirection: "row", alignItems: "center", gap: 7, alignSelf: "flex-start", backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 13, marginTop: 4, marginBottom: 4 },
  ctxBtnText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  ctxBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 22 },
  ctxCard: { backgroundColor: colors.card, borderRadius: 18, padding: 18, width: "100%", maxWidth: 440, maxHeight: "82%" },
  ctxScroll: { marginTop: 6 },
  ctxText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  scroll: { maxHeight: 440, marginTop: 8 },
  qBlock: { marginBottom: 6 },
  qBlockSep: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 14, paddingTop: 16 },
  chip: { color: colors.bg, backgroundColor: colors.primary, fontSize: 11, fontWeight: "800", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: "hidden", alignSelf: "flex-start", marginBottom: 8 },
  pregunta: { color: colors.text, fontSize: 16, fontWeight: "700", lineHeight: 22, marginBottom: 6 },
  preguntaSm: { color: colors.text, fontSize: 15, fontWeight: "600", lineHeight: 20, marginBottom: 8 },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: 8, fontStyle: "italic" },
  opt: { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  optSel: { borderColor: colors.primary, backgroundColor: colors.card },
  optK: { color: colors.textDim, fontSize: 12, fontWeight: "700", borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 1, overflow: "hidden", marginTop: 1 },
  optBody: { flex: 1 },
  optLabel: { color: colors.text, fontSize: 15, fontWeight: "700", marginBottom: 2 },
  optDesc: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  label: { color: colors.textDim, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8, marginBottom: 6 },
  input: { backgroundColor: colors.cardAlt, borderRadius: 10, padding: 12, color: colors.text, fontSize: 15, minHeight: 48, textAlignVertical: "top", borderWidth: 1, borderColor: colors.border },
  errText: { color: colors.red, fontSize: 13, marginTop: 10 },
  modalActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 16 },
  modalBtnGhost: { paddingVertical: 11, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  modalBtnGhostText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  modalBtnPrimary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.primary, flex: 1 },
  modalBtnPrimaryText: { color: colors.bg, fontSize: 14, fontWeight: "800" },
  btnOff: { opacity: 0.5 },
  optEnviando: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  exitoBox: { alignItems: "center", justifyContent: "center", paddingVertical: 34, paddingHorizontal: 16 },
  exitoCirc: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.green + "22", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  exitoTitle: { color: colors.text, fontSize: 18, fontWeight: "800", marginBottom: 6 },
  exitoSel: { color: colors.textDim, fontSize: 14, fontWeight: "600", textAlign: "center" },
  elegidaBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.cardAlt, borderRadius: 10, padding: 14 },
  elegidaText: { color: colors.text, fontSize: 15, fontWeight: "600", flex: 1 },
});
