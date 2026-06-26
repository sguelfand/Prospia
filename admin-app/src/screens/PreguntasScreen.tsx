import React, { useCallback, useEffect, useState } from "react";
import {
  Alert, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Consulta, eliminarConsultas, getConsultas, responderConsulta } from "../api";
import { useAuth } from "../auth";
import { ErrorBox, Loader } from "../components/ui";
import { PreguntasProps } from "../navigation";
import { Icon } from "../components/Icon";
import { colors } from "../theme";

type Filtro = "pendiente" | "contestada";

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

export default function PreguntasScreen({ navigation, route }: PreguntasProps) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Consulta[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("pendiente");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [abierta, setAbierta] = useState<Consulta | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setItems(await getConsultas(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar las consultas.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Deep-link: si llegamos desde una push (tap en la notificación) con consultaId,
  // abrir DIRECTO la ventana de contestar apenas estén cargadas.
  useEffect(() => {
    const id = route.params?.consultaId;
    if (id == null || items.length === 0) return;
    const c = items.find((x) => x.id === id);
    if (c) { setFiltro(c.estado); setAbierta(c); }
    navigation.setParams({ consultaId: undefined });
  }, [route.params?.consultaId, items]);

  const salirSeleccion = () => { setSelectMode(false); setSelected(new Set()); };
  const toggle = (id: number) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const eliminar = async () => {
    if (!token || selected.size === 0) return;
    const ids = [...selected];
    setItems((prev) => prev.filter((c) => !selected.has(c.id)));
    salirSeleccion();
    try { await eliminarConsultas(token, ids); } catch { load(); }
  };

  const eliminarUna = async (c: Consulta) => {
    if (!token) return;
    setItems((prev) => prev.filter((x) => x.id !== c.id));
    setAbierta(null);
    try { await eliminarConsultas(token, [c.id]); } catch { load(); }
  };

  const onCard = (c: Consulta) => {
    if (selectMode) { toggle(c.id); return; }
    setAbierta(c);
  };

  const onContestada = (actualizada: Consulta) => {
    setItems((prev) => prev.map((x) => (x.id === actualizada.id ? actualizada : x)));
    setAbierta(null);
  };

  if (loading) return <Loader />;

  const visibles = items.filter((c) => c.estado === filtro);
  const n = (s: Filtro) => items.filter((c) => c.estado === s).length;

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.tabs}>
          <Tab label={`Pendientes (${n("pendiente")})`} active={filtro === "pendiente"} onPress={() => setFiltro("pendiente")} />
          <Tab label={`Contestadas (${n("contestada")})`} active={filtro === "contestada"} onPress={() => setFiltro("contestada")} />
        </View>
        {selectMode ? (
          <View style={styles.selActions}>
            <Text style={styles.topCount}>{selected.size}</Text>
            <TouchableOpacity onPress={salirSeleccion}><Text style={styles.topAction}>Cancelar</Text></TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setSelectMode(true)} disabled={items.length === 0}>
            <Text style={[styles.topAction, items.length === 0 && styles.topActionOff]}>Seleccionar</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + (selectMode ? 90 : 40) }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        {error ? <ErrorBox message={error} onRetry={load} /> : null}

        {visibles.map((c) => {
          const isSel = selected.has(c.id);
          const borderColor = c.estado === "contestada" ? colors.green : colors.amber;
          return (
            <TouchableOpacity key={c.id} style={[styles.card, { borderLeftColor: borderColor }, isSel && styles.cardSel]} onPress={() => onCard(c)} activeOpacity={0.7}>
              <View style={styles.row}>
                {selectMode ? (
                  <View style={[styles.selBox, isSel && styles.selBoxOn]}>{isSel && <Icon name="check" size={13} color="#fff" />}</View>
                ) : (
                  <View style={styles.emoji}><Icon name="message" size={20} color={borderColor} /></View>
                )}
                <View style={styles.body}>
                  <View style={styles.headerRow}>
                    <Text style={styles.titulo}>#{c.id}{c.telefono ? ` · ${c.telefono}` : ""}</Text>
                    <Text style={styles.tiempo}>{tiempoRelativo(c.fecha)}</Text>
                  </View>
                  <Text style={styles.detalle} numberOfLines={3}>{c.pregunta}</Text>
                  {c.estado === "contestada" ? (
                    <Text style={styles.badgeFixed}>Contestada</Text>
                  ) : (
                    <Text style={styles.badgePend}>Pendiente</Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}

        {visibles.length === 0 && !error ? (
          <Text style={styles.empty}>
            {filtro === "pendiente" ? "No hay preguntas pendientes." : "Todavía no contestaste ninguna."}
          </Text>
        ) : null}
      </ScrollView>

      {selectMode && (
        <View style={[styles.delBar, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            style={[styles.delBtn, selected.size === 0 && styles.delBtnOff]}
            onPress={() => Alert.alert("Eliminar", `¿Eliminar ${selected.size} consulta(s)?`, [
              { text: "Cancelar", style: "cancel" },
              { text: "Eliminar", style: "destructive", onPress: eliminar },
            ])}
            disabled={selected.size === 0}
          >
            <Icon name="x" size={15} color="#fff" />
            <Text style={styles.delBtnText}>Eliminar {selected.size > 0 ? `(${selected.size})` : ""}</Text>
          </TouchableOpacity>
        </View>
      )}

      <DetalleModal
        consulta={abierta}
        token={token}
        onClose={() => setAbierta(null)}
        onBorrar={eliminarUna}
        onContestada={onContestada}
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

function DetalleModal({ consulta, token, onClose, onBorrar, onContestada }: {
  consulta: Consulta | null;
  token: string | null;
  onClose: () => void;
  onBorrar: (c: Consulta) => void;
  onContestada: (c: Consulta) => void;
}) {
  const [respuesta, setRespuesta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Resetear el form cada vez que se abre una consulta distinta.
  useEffect(() => { setRespuesta(""); setErr(null); setEnviando(false); }, [consulta?.id]);

  if (!consulta) return null;
  const pendiente = consulta.estado === "pendiente";

  const contestar = async () => {
    const txt = respuesta.trim();
    if (!txt || !token) return;
    setEnviando(true);
    setErr(null);
    try {
      const actualizada = await responderConsulta(token, consulta.id, txt);
      onContestada(actualizada);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo enviar la respuesta.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Consulta #{consulta.id}</Text>
            <TouchableOpacity onPress={onClose}><Icon name="x" size={18} color={colors.textDim} /></TouchableOpacity>
          </View>
          {consulta.telefono ? (
            <Text style={styles.modalTel}><Icon name="phone" size={12} color={colors.textDim} /> {consulta.telefono}</Text>
          ) : null}

          <Text style={styles.label}>Preguntó el cliente</Text>
          <ScrollView style={styles.preguntaBox}><Text style={styles.preguntaText}>{consulta.pregunta}</Text></ScrollView>

          {pendiente ? (
            <>
              <Text style={styles.label}>Tu respuesta (se la envío a Camila para el cliente)</Text>
              <TextInput
                style={styles.input}
                value={respuesta}
                onChangeText={setRespuesta}
                placeholder="Escribí la respuesta…"
                placeholderTextColor={colors.textDim}
                multiline
                autoFocus
              />
              {err ? <Text style={styles.errText}>{err}</Text> : null}
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalBtnGhost} onPress={onClose}>
                  <Text style={styles.modalBtnGhostText}>Cerrar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtnPrimary, (enviando || !respuesta.trim()) && styles.delBtnOff]}
                  onPress={contestar}
                  disabled={enviando || !respuesta.trim()}
                >
                  <Icon name="send" size={14} color={colors.bg} />
                  <Text style={styles.modalBtnPrimaryText}>{enviando ? "Enviando…" : "Contestar"}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>Contestaste {consulta.fecha_respuesta ? `· ${tiempoRelativo(consulta.fecha_respuesta)}` : ""}</Text>
              <ScrollView style={styles.preguntaBox}><Text style={styles.preguntaText}>{consulta.respuesta}</Text></ScrollView>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalBtnGhost} onPress={onClose}>
                  <Text style={styles.modalBtnGhostText}>Cerrar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalBtnDanger}
                  onPress={() => Alert.alert("Eliminar", "¿Eliminar esta consulta?", [
                    { text: "Cancelar", style: "cancel" },
                    { text: "Eliminar", style: "destructive", onPress: () => onBorrar(consulta) },
                  ])}
                >
                  <Icon name="x" size={14} color="#fff" />
                  <Text style={styles.modalBtnDangerText}>Borrar</Text>
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
  selActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  topAction: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  topActionOff: { color: colors.textDim },
  topCount: { color: colors.text, fontSize: 14, fontWeight: "700" },
  content: { padding: 12 },
  card: { backgroundColor: colors.card, borderRadius: 14, borderLeftWidth: 4, padding: 14, marginBottom: 10 },
  cardSel: { borderWidth: 1, borderColor: colors.primary },
  row: { flexDirection: "row", alignItems: "flex-start" },
  emoji: { marginRight: 12, marginTop: 2 },
  selBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center", marginRight: 12, marginTop: 1 },
  selBoxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  body: { flex: 1 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  titulo: { color: colors.text, fontSize: 15, fontWeight: "700", flex: 1 },
  tiempo: { color: colors.textDim, fontSize: 12 },
  detalle: { color: colors.textDim, fontSize: 13, marginTop: 5, lineHeight: 18 },
  badgePend: { color: colors.amber, fontSize: 11, fontWeight: "700", marginTop: 8 },
  badgeFixed: { color: colors.green, fontSize: 11, fontWeight: "700", marginTop: 8 },
  empty: { color: colors.textDim, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  delBar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.cardAlt, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 16, paddingTop: 12 },
  delBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.red, borderRadius: 10, paddingVertical: 12 },
  delBtnOff: { opacity: 0.5 },
  delBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 22 },
  modalCard: { backgroundColor: colors.card, borderRadius: 18, padding: 18, width: "100%", maxWidth: 440, maxHeight: "85%" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  modalTel: { color: colors.textDim, fontSize: 12, marginBottom: 8 },
  label: { color: colors.textDim, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  preguntaBox: { maxHeight: 140, backgroundColor: colors.cardAlt, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4 },
  preguntaText: { color: colors.text, fontSize: 15, lineHeight: 21, paddingVertical: 6 },
  input: { backgroundColor: colors.cardAlt, borderRadius: 10, padding: 12, color: colors.text, fontSize: 15, minHeight: 96, textAlignVertical: "top" },
  errText: { color: colors.red, fontSize: 13, marginTop: 8 },
  modalActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 16 },
  modalBtnGhost: { paddingVertical: 11, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: colors.border, flex: 1, alignItems: "center" },
  modalBtnGhostText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  modalBtnPrimary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.primary, flex: 1 },
  modalBtnPrimaryText: { color: colors.bg, fontSize: 14, fontWeight: "800" },
  modalBtnDanger: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.red },
  modalBtnDangerText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
