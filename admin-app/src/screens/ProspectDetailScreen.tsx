import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import {
  HistorialRow,
  MensajeRow,
  TokenConvCosto,
  bloquearProspectCliente,
  desbloquearProspectCliente,
  getConversacionCosto,
  getHistorialProspect,
  getMensajesProspect,
  reportarCalidadProspect,
} from "../api";
import { useAuth } from "../auth";
import { CollapsibleSection, Loader } from "../components/ui";
import { Icon } from "../components/Icon";
import { ProspectDetailProps } from "../navigation";
import { colors, estadoColor, estadoLabel } from "../theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ProspectDetailScreen({ route, navigation }: ProspectDetailProps) {
  const insets = useSafeAreaInsets();
  const { tenantId, prospect } = route.params;
  const { token } = useAuth();
  const [mensajes, setMensajes] = useState<MensajeRow[]>([]);
  const [historial, setHistorial] = useState<HistorialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bloqueado, setBloqueado] = useState(!!prospect.bloqueado);
  const [bloqueando, setBloqueando] = useState(false);
  const [costo, setCosto] = useState<TokenConvCosto | null>(null);
  const [reporteOpen, setReporteOpen] = useState(false);
  const [reporteTexto, setReporteTexto] = useState("");
  const [reportando, setReportando] = useState(false);
  const tel = prospect.whatsapp ?? prospect.telefono;

  useEffect(() => {
    navigation.setOptions({ title: prospect.nombre });
  }, [navigation, prospect.nombre]);

  // El detalle vive en un Drawer navigator → reusa UNA instancia del screen (al
  // abrir otro prospect cambian los params, no se remonta). Sin esto, el estado
  // bloqueado quedaba pegado del prospect anterior. Re-sincronizamos por prospect.
  useEffect(() => {
    setBloqueado(!!prospect.bloqueado);
    setBloqueando(false);
  }, [prospect.id, prospect.bloqueado]);

  const toggleBloqueo = useCallback(() => {
    if (!token || bloqueando) return;
    const accion = bloqueado ? "Desbloquear" : "Bloquear";
    const mensaje = bloqueado
      ? `${prospect.nombre} vuelve a la cadencia normal.`
      : `No se va a contactar más a ${prospect.nombre} y el bot deja de escucharlo/responderle.`;
    Alert.alert(`${accion} prospect`, mensaje, [
      { text: "Cancelar", style: "cancel" },
      {
        text: accion,
        style: bloqueado ? "default" : "destructive",
        onPress: async () => {
          setBloqueando(true);
          try {
            const res = bloqueado
              ? await desbloquearProspectCliente(token, tenantId, prospect.id)
              : await bloquearProspectCliente(token, tenantId, prospect.id);
            setBloqueado(res.bloqueado);
            const botInfo =
              res.webhook_estado === "ok" ? "El bot dejó de atenderlo."
              : res.webhook_estado === "no_conectado" ? "El bot todavía no está conectado (cuando lo esté, deja de atenderlo)."
              : "Aviso al bot falló, pero quedó bloqueado en la plataforma.";
            Alert.alert(
              res.bloqueado ? "Bloqueado ✓" : "Desbloqueado ✓",
              res.bloqueado ? botInfo : "Vuelve a la cadencia normal."
            );
          } catch (e: any) {
            Alert.alert("No se pudo", String(e?.message ?? e));
          } finally {
            setBloqueando(false);
          }
        },
      },
    ]);
  }, [token, bloqueando, bloqueado, tenantId, prospect.id, prospect.nombre]);

  const enviarReporte = useCallback(async () => {
    const texto = reporteTexto.trim();
    if (!token || reportando || !texto) return;
    setReportando(true);
    try {
      await reportarCalidadProspect(token, tenantId, prospect.id, texto);
      setReporteOpen(false);
      setReporteTexto("");
      Alert.alert("Reportado ✓", "Lo sumé a la lista de Calidad de Camila (cuenta para las 5 lecciones).");
    } catch (e: any) {
      Alert.alert("No se pudo", String(e?.message ?? e));
    } finally {
      setReportando(false);
    }
  }, [token, reportando, reporteTexto, tenantId, prospect.id]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [m, h] = await Promise.all([
        getMensajesProspect(token, tenantId, prospect.id),
        getHistorialProspect(token, tenantId, prospect.id),
      ]);
      setMensajes(m);
      setHistorial(h);
    } catch {
      // los datos base del prospect ya vienen por params; el chat puede fallar aislado
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // Costo de la conversación (en vivo, best-effort — no bloquea el chat).
    if (tel) {
      try { setCosto(await getConversacionCosto(token, tel)); } catch { /* sin costo */ }
    }
  }, [token, tenantId, prospect.id, tel]);

  useEffect(() => {
    load();
  }, [load]);

  const color = estadoColor[prospect.estado] ?? colors.textDim;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
      }
    >
      {/* ── Acciones (solo admin): Reportar calidad + Bloquear/Desbloquear ───────── */}
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

      {/* ── Modal: Reportar calidad de Camila ───────────────────────── */}
      <Modal visible={reporteOpen} transparent animationType="slide" onRequestClose={() => setReporteOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
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

      {/* ── Datos del prospect ───────────────────────────────────── */}
      <View style={styles.headerCard}>
        <Text style={styles.nombre}>{prospect.nombre}</Text>
        <View style={styles.badgeRow}>
          {bloqueado ? (
            <Text style={styles.bloqueadoBadge}>Bloqueado</Text>
          ) : (
            <Text style={[styles.estadoBadge, { color, borderColor: color }]}>
              {estadoLabel[prospect.estado] ?? prospect.estado}
            </Text>
          )}
          {prospect.envio_no_confirmado && (
            <Text style={styles.envioBadge}>⚠️ Envío sin confirmar</Text>
          )}
        </View>
      </View>

      <View style={styles.datos}>
        <Dato label="Término" value={prospect.termino_texto} />
        <Dato label="Rubro" value={prospect.rubro_nombre} />
        <Dato label="Clasificación" value={prospect.clasificacion} />
        <Dato label="Detalle clasif." value={prospect.clasificacion_detalle} />
        <Dato label="WhatsApp" value={prospect.whatsapp} />
        <Dato label="Teléfono" value={prospect.telefono} />
        <Dato label="Email" value={prospect.email} />
        <Dato label="URL" value={prospect.url} />
        <Dato label="Contactos" value={String(prospect.cant_contactos)} />
        <Dato label="Último contacto" value={fmt(prospect.ult_contacto)} />
        <Dato label="Próximo contacto" value={fmt(prospect.prox_contacto)} />
        {/* Costo de esta conversación (en vivo, hasta el momento) */}
        <View style={styles.datoRow}>
          <Text style={styles.datoLabel}>Costo conversación</Text>
          <Text style={[styles.datoValue, { color: colors.primary }]}>
            {costo?.resumen ? `$${costo.resumen.costo.toFixed(3)}` : "—"}
            {costo?.resumen ? <Text style={styles.costoSubInline}>{`  · ${costo.resumen.turnos} resp`}</Text> : null}
          </Text>
        </View>
        <Dato label="Creado" value={fmt(prospect.created_at)} />
      </View>

      {/* ── Conversación con Camila ──────────────────────────────── */}
      <CollapsibleSection title="Conversación con Camila" count={mensajes.length}>
        {loading ? (
          <Loader />
        ) : mensajes.length === 0 ? (
          <Text style={styles.empty}>Sin mensajes espejados todavía.</Text>
        ) : (
          mensajes.map((m) => <Burbuja key={m.id} mensaje={m} />)
        )}
      </CollapsibleSection>

      {/* ── Historial de estados ─────────────────────────────────── */}
      {historial.length > 0 ? (
        <CollapsibleSection title="Historial de estados" count={historial.length} defaultExpanded={false}>
          {historial.map((h) => (
            <View key={h.id} style={styles.histRow}>
              <Text style={styles.histTipo}>{estadoLabel[h.tipo] ?? h.tipo}</Text>
              <Text style={styles.histFecha}>{fmt(h.fecha)}</Text>
              {h.detalle ? <Text style={styles.histDetalle}>{h.detalle}</Text> : null}
            </View>
          ))}
        </CollapsibleSection>
      ) : null}
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

function Dato({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.datoRow}>
      <Text style={styles.datoLabel}>{label}</Text>
      <Text style={styles.datoValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function fmt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtHora(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 12, paddingBottom: 40 },
  headerCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  nombre: { color: colors.text, fontSize: 20, fontWeight: "800", flex: 1, marginRight: 8 },
  estadoBadge: { fontSize: 11, fontWeight: "700", borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
  accionesRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginBottom: 12, flexWrap: "wrap" },
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
  modalInput: {
    backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    color: colors.text, fontSize: 14, padding: 12, minHeight: 110, marginBottom: 14,
  },
  modalBtns: { flexDirection: "row", justifyContent: "flex-end", gap: 10, alignItems: "center" },
  modalCancel: { paddingHorizontal: 14, paddingVertical: 9 },
  modalCancelText: { color: colors.textDim, fontSize: 14, fontWeight: "700" },
  modalEnviar: { backgroundColor: colors.primary, borderRadius: 9, paddingHorizontal: 18, paddingVertical: 9, minWidth: 96, alignItems: "center" },
  modalEnviarOff: { opacity: 0.5 },
  modalEnviarText: { color: colors.onPrimary, fontSize: 14, fontWeight: "800" },
  bloqueadoBadge: { fontSize: 11, fontWeight: "800", color: colors.red, borderColor: colors.red, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden", backgroundColor: colors.red + "1A" },
  badgeRow: { alignItems: "flex-end", gap: 4 },
  envioBadge: { fontSize: 10, fontWeight: "700", color: "#b45309", backgroundColor: "#fef3c7", borderColor: "#fcd34d", borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
  datos: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 14 },
  datoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  datoLabel: { color: colors.textDim, fontSize: 13, marginRight: 12 },
  datoValue: { color: colors.text, fontSize: 13, fontWeight: "600", flex: 1, textAlign: "right" },
  costoCard: { backgroundColor: colors.card, borderRadius: 14, padding: 14, marginTop: 14, borderWidth: 1, borderColor: colors.primary + "44" },
  costoTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  costoLabel: { color: colors.textDim, fontSize: 12, fontWeight: "700", textTransform: "uppercase", flex: 1 },
  costoVal: { color: colors.primary, fontSize: 22, fontWeight: "800" },
  costoMeta: { color: colors.textDim, fontSize: 12, marginTop: 4 },
  costoLive: { color: colors.textDim, fontSize: 10, marginTop: 4, fontStyle: "italic" },
  costoSubInline: { color: colors.textDim, fontSize: 11, fontWeight: "400" },
  empty: { color: colors.textDim },

  burbujaRow: { flexDirection: "row", marginBottom: 8 },
  burbujaRowIn: { justifyContent: "flex-start" },
  burbujaRowOut: { justifyContent: "flex-end" },
  burbuja: { maxWidth: "82%", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  burbujaIn: { backgroundColor: colors.card, borderTopLeftRadius: 4 },
  burbujaOut: { backgroundColor: colors.primary, borderTopRightRadius: 4 },
  burbujaTexto: { color: colors.text, fontSize: 14 },
  burbujaFecha: { color: colors.textDim, fontSize: 10, marginTop: 4, alignSelf: "flex-end" },

  histRow: { borderLeftColor: colors.border, borderLeftWidth: 2, paddingLeft: 10, marginBottom: 10 },
  histTipo: { color: colors.text, fontSize: 14, fontWeight: "600" },
  histFecha: { color: colors.textDim, fontSize: 12 },
  histDetalle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
});
