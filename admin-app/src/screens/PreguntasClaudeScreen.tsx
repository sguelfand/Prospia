import React, { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  OpcionPregunta, PreguntaClaude, getPreguntaClaude, getPreguntasClaude, responderPreguntaClaude,
} from "../api";
import { useAuth } from "../auth";
import { ErrorBox, Loader } from "../components/ui";
import { Icon } from "../components/Icon";
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

  // Deep-link: si llegamos desde el push con preguntaId, abrir directo esa pregunta.
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
          return (
            <TouchableOpacity key={p.id} style={[styles.card, { borderLeftColor: borderColor }]} onPress={() => setAbierta(p)} activeOpacity={0.7}>
              <View style={styles.row}>
                <View style={styles.emoji}><Icon name="flag" size={18} color={borderColor} /></View>
                <View style={styles.body}>
                  <View style={styles.headerRow}>
                    <Text style={styles.titulo} numberOfLines={1}>{p.header || "Claude pregunta"}</Text>
                    <Text style={styles.tiempo}>{tiempoRelativo(p.fecha)}</Text>
                  </View>
                  <Text style={styles.detalle} numberOfLines={3}>{p.pregunta}</Text>
                  {respondida ? (
                    <Text style={styles.badgeFixed} numberOfLines={1}>✓ {p.elegida}</Text>
                  ) : (
                    <Text style={styles.badgePend}>Esperando tu respuesta · {p.opciones.length} opciones</Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
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

function DetalleModal({ pregunta, token, onClose, onResuelta }: {
  pregunta: PreguntaClaude | null;
  token: string | null;
  onClose: () => void;
  onResuelta: (p: PreguntaClaude) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [otra, setOtra] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setSel(new Set()); setOtra(""); setErr(null); setEnviando(false); }, [pregunta?.id]);

  if (!pregunta) return null;
  const pendiente = pregunta.estado === "pendiente";
  const multi = pregunta.multiselect;

  const toggle = (label: string) => {
    if (multi) setSel((prev) => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n; });
    else enviar(label);  // single-select: tocar la opción = enviar directo
  };

  const enviar = async (override?: string) => {
    if (!token || enviando) return;
    const elegida = override ?? (otra.trim() || [...sel].join("\n"));
    if (!elegida) { setErr("Elegí una opción o escribí la tuya."); return; }
    setEnviando(true);
    setErr(null);
    try {
      const actualizada = await responderPreguntaClaude(token, pregunta.id, elegida);
      onResuelta(actualizada);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo enviar la respuesta.");
      setEnviando(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            {pregunta.header ? <Text style={styles.chip}>{pregunta.header}</Text> : <View />}
            <TouchableOpacity onPress={onClose}><Icon name="x" size={18} color={colors.textDim} /></TouchableOpacity>
          </View>

          <Text style={styles.pregunta}>{pregunta.pregunta}</Text>
          {pregunta.contexto ? <Text style={styles.contexto}>{pregunta.contexto}</Text> : null}

          {pendiente ? (
            <>
              {multi ? <Text style={styles.hint}>Podés elegir varias</Text> : null}
              <ScrollView style={styles.opcionesScroll}>
                {pregunta.opciones.map((o: OpcionPregunta, i) => {
                  const on = sel.has(o.label);
                  return (
                    <TouchableOpacity
                      key={`${o.label}-${i}`}
                      style={[styles.opt, on && styles.optSel]}
                      onPress={() => toggle(o.label)}
                      disabled={enviando}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.optK}>{i + 1}</Text>
                      <View style={styles.optBody}>
                        <Text style={styles.optLabel}>{o.label}</Text>
                        {o.description ? <Text style={styles.optDesc}>{o.description}</Text> : null}
                      </View>
                      {multi && on ? <Icon name="check" size={16} color={colors.primary} /> : null}
                    </TouchableOpacity>
                  );
                })}

                <Text style={styles.label}>Otra opción</Text>
                <TextInput
                  style={styles.input}
                  value={otra}
                  onChangeText={setOtra}
                  placeholder="Escribí tu propia respuesta…"
                  placeholderTextColor={colors.textDim}
                  multiline
                />
              </ScrollView>

              {err ? <Text style={styles.errText}>{err}</Text> : null}
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalBtnGhost} onPress={onClose}>
                  <Text style={styles.modalBtnGhostText}>Cerrar</Text>
                </TouchableOpacity>
                {(multi || otra.trim()) ? (
                  <TouchableOpacity
                    style={[styles.modalBtnPrimary, enviando && styles.btnOff]}
                    onPress={() => enviar()}
                    disabled={enviando}
                  >
                    <Icon name="send" size={14} color={colors.bg} />
                    <Text style={styles.modalBtnPrimaryText}>{enviando ? "Enviando…" : "Enviar"}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>Elegiste {pregunta.fecha_respuesta ? `· ${tiempoRelativo(pregunta.fecha_respuesta)}` : ""}</Text>
              <View style={styles.elegidaBox}>
                <Icon name="check" size={15} color={colors.green} />
                <Text style={styles.elegidaText}>{pregunta.elegida}</Text>
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.modalBtnGhost, { flex: 1 }]} onPress={onClose}>
                  <Text style={styles.modalBtnGhostText}>Cerrar</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
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
  modalCard: { backgroundColor: colors.card, borderRadius: 18, padding: 18, width: "100%", maxWidth: 440, maxHeight: "85%" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, minHeight: 22 },
  chip: { color: colors.bg, backgroundColor: colors.primary, fontSize: 11, fontWeight: "800", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: "hidden" },
  pregunta: { color: colors.text, fontSize: 17, fontWeight: "700", lineHeight: 23 },
  contexto: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginTop: 6 },
  hint: { color: colors.textDim, fontSize: 12, marginTop: 12, fontStyle: "italic" },
  opcionesScroll: { maxHeight: 340, marginTop: 12 },
  opt: { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  optSel: { borderColor: colors.primary, backgroundColor: colors.card },
  optK: { color: colors.textDim, fontSize: 12, fontWeight: "700", borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 1, overflow: "hidden", marginTop: 1 },
  optBody: { flex: 1 },
  optLabel: { color: colors.text, fontSize: 15, fontWeight: "700", marginBottom: 2 },
  optDesc: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  label: { color: colors.textDim, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 8, marginBottom: 6 },
  input: { backgroundColor: colors.cardAlt, borderRadius: 10, padding: 12, color: colors.text, fontSize: 15, minHeight: 52, textAlignVertical: "top", borderWidth: 1, borderColor: colors.border },
  errText: { color: colors.red, fontSize: 13, marginTop: 10 },
  modalActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 16 },
  modalBtnGhost: { paddingVertical: 11, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  modalBtnGhostText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  modalBtnPrimary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.primary, flex: 1 },
  modalBtnPrimaryText: { color: colors.bg, fontSize: 14, fontWeight: "800" },
  btnOff: { opacity: 0.5 },
  elegidaBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.cardAlt, borderRadius: 10, padding: 14, marginTop: 8 },
  elegidaText: { color: colors.text, fontSize: 15, fontWeight: "600", flex: 1 },
});
