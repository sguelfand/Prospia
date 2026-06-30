import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { MensajeRow, TokenConvCosto, bloquearEtiguelMirror, desbloquearEtiguelMirror, getConversacionCosto, getEtiguelMirrorMensajes, reportarCalidadManual } from "../api";
import { useAuth } from "../auth";
import { CollapsibleSection, Loader } from "../components/ui";
import { EtiguelMirrorDetailProps } from "../navigation";
import { Icon, IconText } from "../components/Icon";
import { colors } from "../theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function EtiguelMirrorDetailScreen({ route, navigation }: EtiguelMirrorDetailProps) {
  const insets = useSafeAreaInsets();
  const { item } = route.params;
  const { token } = useAuth();
  const [mensajes, setMensajes] = useState<MensajeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bloqueado, setBloqueado] = useState(!!item.bloqueado);
  const [bloqueando, setBloqueando] = useState(false);
  const [costo, setCosto] = useState<TokenConvCosto | null>(null);
  const [reporteOpen, setReporteOpen] = useState(false);
  const [reporteTexto, setReporteTexto] = useState("");
  const [reportando, setReportando] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: item.nombre ?? "Conversación" });
  }, [navigation, item.nombre]);

  // El detalle vive en un Drawer navigator → reusa UNA sola instancia del screen
  // (al navegar a otro lead solo cambian los params, no se remonta). Sin esto, el
  // estado `bloqueado` se quedaba con el valor del lead anterior y mostraba
  // "Desbloquear" en contactos que no estaban bloqueados. Re-sincronizamos por item.
  useEffect(() => {
    setBloqueado(!!item.bloqueado);
    setBloqueando(false);
    setCosto(null);
  }, [item.id, item.bloqueado]);

  const toggleBloqueo = useCallback(() => {
    if (!token || bloqueando) return;
    const nombre = item.nombre ?? item.telefono ?? "este contacto";
    const accion = bloqueado ? "Desbloquear" : "Bloquear";
    const mensaje = bloqueado
      ? `Camila va a volver a atender a ${nombre}.`
      : `Camila no va a escuchar ni responder más a ${nombre}, y no se lo va a contactar.`;
    Alert.alert(`${accion} contacto`, mensaje, [
      { text: "Cancelar", style: "cancel" },
      {
        text: accion,
        style: bloqueado ? "default" : "destructive",
        onPress: async () => {
          setBloqueando(true);
          try {
            const res = bloqueado
              ? await desbloquearEtiguelMirror(token, item.id)
              : await bloquearEtiguelMirror(token, item.id);
            setBloqueado(res.bloqueado);
            Alert.alert(
              res.bloqueado ? "Bloqueado ✓" : "Desbloqueado ✓",
              res.bloqueado
                ? "El número entró a la lista negra. Camila ya no lo escucha ni le responde."
                : "El número salió de la lista negra. Camila vuelve a atenderlo."
            );
          } catch (e: any) {
            Alert.alert("No se pudo", String(e?.message ?? e));
          } finally {
            setBloqueando(false);
          }
        },
      },
    ]);
  }, [token, bloqueando, bloqueado, item.id, item.nombre, item.telefono]);

  const enviarReporte = useCallback(async () => {
    const texto = reporteTexto.trim();
    if (!token || reportando || !texto) return;
    setReportando(true);
    try {
      await reportarCalidadManual(token, "etiguel", texto, item.telefono ?? undefined);
      setReporteOpen(false);
      setReporteTexto("");
      Alert.alert("Reportado ✓", "Lo sumé a la lista de Calidad de Camila (cuenta para las 5 lecciones).");
    } catch (e: any) {
      Alert.alert("No se pudo", String(e?.message ?? e));
    } finally {
      setReportando(false);
    }
  }, [token, reportando, reporteTexto, item.telefono]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setMensajes(await getEtiguelMirrorMensajes(token, item.id));
    } catch {
      // sin mensajes / error aislado
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // Costo de esta conversación (mismo dato del monitor, en vivo, best-effort).
    if (item.telefono) {
      try { setCosto(await getConversacionCosto(token, item.telefono)); } catch { /* sin costo */ }
    }
  }, [token, item.id, item.telefono]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
      }
    >
      <View style={styles.headerCard}>
        <View style={styles.accionesRow}>
          <TouchableOpacity
            style={[styles.accionBtn, styles.reporteBtn]}
            onPress={() => setReporteOpen(true)}
            activeOpacity={0.8}
          >
            <Icon name="flag" size={15} color={colors.amber} />
            <Text style={[styles.blockBtnText, { color: colors.amber }]}>Reportar calidad</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.accionBtn, bloqueado ? styles.blockBtnOn : styles.blockBtnOff]}
            onPress={toggleBloqueo}
            disabled={bloqueando}
            activeOpacity={0.8}
          >
            {bloqueando ? (
              <ActivityIndicator size="small" color={bloqueado ? colors.primary : colors.red} />
            ) : (
              <>
                <Icon name="lock" size={15} color={bloqueado ? colors.primary : colors.red} />
                <Text style={[styles.blockBtnText, { color: bloqueado ? colors.primary : colors.red }]}>
                  {bloqueado ? "Desbloquear" : "Bloquear"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.headerRow}>
          <Text style={styles.nombre}>{item.nombre ?? "(sin nombre)"}</Text>
          <Text style={styles.tag}>{item.tipo === "lead" ? "Lead" : "Prospect"}</Text>
        </View>
        {bloqueado ? (
          <View style={styles.bloqueadoBadge}>
            <Icon name="lock" size={12} color={colors.red} />
            <Text style={styles.bloqueadoBadgeText}>Bloqueado — Camila no lo atiende</Text>
          </View>
        ) : null}
        {item.estado ? <Text style={styles.meta}>Estado: {item.estado}</Text> : null}
        {item.telefono ? <IconText name="phone" text={item.telefono} size={14} textStyle={{ fontSize: 13, marginTop: 4 }} /> : null}
        {item.email ? <IconText name="mail" text={item.email} size={14} textStyle={{ fontSize: 13, marginTop: 4 }} /> : null}
        <IconText
          name="calendar"
          text={item.prox_contacto ? `Próximo contacto: ${item.prox_contacto}` : "Próximo contacto: sin agendar"}
          size={14}
          color={item.prox_contacto ? colors.primary : colors.textDim}
          textStyle={{ fontSize: 13, marginTop: 4 }}
        />
        {item.telefono ? (
          <IconText
            name="tag"
            text={
              costo?.resumen
                ? `Costo conversación: $${costo.resumen.costo.toFixed(3)} · ${costo.resumen.turnos} resp`
                : "Costo conversación: calculando…"
            }
            size={14}
            color={costo?.resumen ? colors.amber : colors.textDim}
            textStyle={{ fontSize: 13, marginTop: 4 }}
          />
        ) : null}
      </View>

      <CollapsibleSection title="Conversación con Camila" count={mensajes.length}>
        {loading ? (
          <Loader />
        ) : mensajes.length === 0 ? (
          <Text style={styles.empty}>Todavía no hay mensajes espejados.</Text>
        ) : (
          mensajes.map((m) => <Burbuja key={m.id} mensaje={m} />)
        )}
      </CollapsibleSection>

      {/* Modal: Reportar calidad de Camila */}
      <Modal visible={reporteOpen} transparent animationType="slide" onRequestClose={() => setReporteOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 18 }]}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Reportar calidad</Text>
              <Text style={styles.modalSub}>
                Contá qué estuvo mal en lo que respondió Camila. Entra a la lista de Calidad ya
                confirmado y suma para las 5 lecciones que la corrigen.
              </Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Ej: le pasó un precio equivocado / cortó al cliente / no derivó a Delfina…"
                placeholderTextColor={colors.textDim}
                value={reporteTexto}
                onChangeText={setReporteTexto}
                multiline
                autoFocus
                textAlignVertical="top"
              />
              <View style={styles.modalBtns}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setReporteOpen(false)} disabled={reportando}>
                  <Text style={styles.modalCancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalEnviar, (!reporteTexto.trim() || reportando) && styles.modalEnviarOff]}
                  onPress={enviarReporte}
                  disabled={!reporteTexto.trim() || reportando}
                >
                  {reportando ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.modalEnviarText}>Reportar</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

function Burbuja({ mensaje }: { mensaje: MensajeRow }) {
  const out = mensaje.direccion === "out";
  return (
    <View style={[styles.burbujaRow, out ? styles.burbujaRowOut : styles.burbujaRowIn]}>
      <View style={[styles.burbuja, out ? styles.burbujaOut : styles.burbujaIn]}>
        <Text style={styles.burbujaTexto}>{mensaje.texto}</Text>
        <Text style={styles.burbujaFecha}>{fmtHora(mensaje.fecha)}</Text>
      </View>
    </View>
  );
}

function fmtHora(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 12, paddingBottom: 40 },
  headerCard: { backgroundColor: colors.card, borderRadius: 12, padding: 14 },
  accionesRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginBottom: 10, flexWrap: "wrap" },
  accionBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 7, minHeight: 34,
  },
  reporteBtn: { borderColor: colors.amber },
  blockBtnOff: { borderColor: colors.red },
  blockBtnOn: { borderColor: colors.primary, backgroundColor: colors.primary + "1A" },
  blockBtnText: { fontSize: 13, fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, borderWidth: 1, borderColor: colors.border, maxHeight: "90%" },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: "800", marginBottom: 6 },
  modalSub: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  modalInput: { backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 14, padding: 12, minHeight: 110, marginBottom: 14 },
  modalBtns: { flexDirection: "row", justifyContent: "flex-end", gap: 10, alignItems: "center" },
  modalCancel: { paddingHorizontal: 14, paddingVertical: 9 },
  modalCancelText: { color: colors.textDim, fontSize: 14, fontWeight: "700" },
  modalEnviar: { backgroundColor: colors.primary, borderRadius: 9, paddingHorizontal: 18, paddingVertical: 9, minWidth: 96, alignItems: "center" },
  modalEnviarOff: { opacity: 0.5 },
  modalEnviarText: { color: colors.onPrimary, fontSize: 14, fontWeight: "800" },
  bloqueadoBadge: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6,
    alignSelf: "flex-start", borderRadius: 6, backgroundColor: colors.red + "1A",
    paddingHorizontal: 8, paddingVertical: 4,
  },
  bloqueadoBadgeText: { color: colors.red, fontSize: 12, fontWeight: "700" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  nombre: { color: colors.text, fontSize: 18, fontWeight: "800", flex: 1, marginRight: 8 },
  tag: { color: colors.amber, fontSize: 11, fontWeight: "700", borderColor: colors.amber, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  meta: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  empty: { color: colors.textDim },

  burbujaRow: { flexDirection: "row", marginBottom: 8 },
  burbujaRowIn: { justifyContent: "flex-start" },
  burbujaRowOut: { justifyContent: "flex-end" },
  burbuja: { maxWidth: "82%", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  burbujaIn: { backgroundColor: colors.card, borderTopLeftRadius: 4 },
  burbujaOut: { backgroundColor: colors.primary, borderTopRightRadius: 4 },
  burbujaTexto: { color: colors.text, fontSize: 14 },
  burbujaFecha: { color: colors.textDim, fontSize: 10, marginTop: 4, alignSelf: "flex-end" },
});
