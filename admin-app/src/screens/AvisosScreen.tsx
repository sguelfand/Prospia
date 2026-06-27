import React, { useCallback, useEffect, useState } from "react";
import { Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Aviso, eliminarAvisos, getAvisos, setNotifPref } from "../api";
import { useAuth } from "../auth";
import { ErrorBox, Loader } from "../components/ui";
import { AvisosProps } from "../navigation";
import { Icon, IconName } from "../components/Icon";
import { getCachedExpoToken, getExpoTokenAsync } from "../push";
import { colors } from "../theme";

function tiempoRelativo(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const dias = Math.floor(h / 24);
  return `hace ${dias} d`;
}

// Ícono + color por tipo de aviso.
function iconoPara(tipo: string): { name: IconName; color: string } {
  if (tipo === "interesado") return { name: "flame", color: colors.amber };
  if (tipo === "en_conversacion" || tipo === "respuesta") return { name: "message", color: colors.primary };
  if (tipo === "mensaje_entrante") return { name: "message", color: colors.blue };
  if (tipo === "error_camila") return { name: "alert", color: colors.red };
  if (tipo === "claude_termino" || tipo === "cola_terminada") return { name: "check", color: colors.green };
  return { name: "bell", color: colors.textDim };
}

export default function AvisosScreen({ navigation, route }: AvisosProps) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [detalle, setDetalle] = useState<Aviso | null>(null);
  const [expandido, setExpandido] = useState(false); // "Detalle" abierto (conclusión completa)

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setAvisos(await getAvisos(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar avisos.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Deep-link: si llegamos desde una push con avisoId, abrir ese aviso apenas
  // estén cargados. Después limpiamos el param para no reabrirlo.
  useEffect(() => {
    const id = route.params?.avisoId;
    if (id == null || avisos.length === 0) return;
    const a = avisos.find((x) => x.id === id);
    if (a) { setExpandido(false); setDetalle(a); }
    navigation.setParams({ avisoId: undefined });
  }, [route.params?.avisoId, avisos]);

  const salirSeleccion = () => { setSelectMode(false); setSelected(new Set()); };
  const toggle = (id: number) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const seleccionarTodos = () => setSelected(new Set(avisos.map((a) => a.id)));

  const eliminar = async () => {
    if (!token || selected.size === 0) return;
    const ids = [...selected];
    setAvisos((prev) => prev.filter((a) => !selected.has(a.id)));
    salirSeleccion();
    try { await eliminarAvisos(token, ids); } catch { load(); }
  };

  const onCard = (a: Aviso) => {
    if (selectMode) { toggle(a.id); return; }
    setExpandido(false);
    setDetalle(a); // abrir el aviso (resumen corto + acciones; "Detalle" expande)
  };

  // Apaga el evento claude_termino para este device (lo mismo que el toggle
  // "Claude terminó una tarea (Prospia)" en Configuración › Notificaciones).
  const desactivarAvisosTarea = async () => {
    if (!token) return;
    let expoToken = getCachedExpoToken();
    if (!expoToken) expoToken = await getExpoTokenAsync();
    if (!expoToken) {
      Alert.alert("No se pudo", "Este dispositivo no está registrado para notificaciones.");
      return;
    }
    try {
      await setNotifPref(token, expoToken, "claude_termino", false);
      setDetalle(null);
      Alert.alert("Avisos desactivados", "No te van a llegar más avisos de “Claude terminó una tarea”. Los podés reactivar desde Configuración › Notificaciones.");
    } catch {
      Alert.alert("Error", "No se pudo desactivar. Probá de nuevo.");
    }
  };

  const eliminarUno = async (a: Aviso) => {
    if (!token) return;
    setAvisos((prev) => prev.filter((x) => x.id !== a.id));
    setDetalle(null);
    try { await eliminarAvisos(token, [a.id]); } catch { load(); }
  };

  const irACliente = (a: Aviso) => {
    setDetalle(null);
    if (a.tenant_id != null) {
      navigation.navigate("ClienteView", { tenantId: a.tenant_id, nombre: a.cliente ?? "Cliente", fuente: "plataforma" });
    }
  };

  if (loading) return <Loader />;

  const ico = detalle ? iconoPara(detalle.tipo) : { name: "bell" as IconName, color: colors.textDim };
  const tieneDetalle = !!(detalle?.detalle && detalle.detalle.trim());
  const esClaudeTermino = detalle?.tipo === "claude_termino";

  return (
    <View style={styles.container}>
      {/* Barra de acciones */}
      <View style={styles.topBar}>
        {selectMode ? (
          <>
            <TouchableOpacity onPress={seleccionarTodos}><Text style={styles.topAction}>Todos</Text></TouchableOpacity>
            <Text style={styles.topCount}>{selected.size}</Text>
            <TouchableOpacity onPress={salirSeleccion}><Text style={styles.topAction}>Cancelar</Text></TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity onPress={() => setSelectMode(true)} disabled={avisos.length === 0}>
            <Text style={[styles.topAction, avisos.length === 0 && styles.topActionOff]}>Seleccionar</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + (selectMode ? 90 : 40) }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        {error ? <ErrorBox message={error} onRetry={load} /> : null}

        {avisos.map((a) => {
          const ico = iconoPara(a.tipo);
          const isSel = selected.has(a.id);
          return (
            <TouchableOpacity key={a.id} style={[styles.card, isSel && styles.cardSel]} onPress={() => onCard(a)} activeOpacity={0.7}>
              <View style={styles.row}>
                {selectMode ? (
                  <View style={[styles.selBox, isSel && styles.selBoxOn]}>{isSel && <Icon name="check" size={13} color="#fff" />}</View>
                ) : (
                  <View style={styles.emoji}><Icon name={ico.name} size={22} color={ico.color} /></View>
                )}
                <View style={styles.body}>
                  <View style={styles.headerRow}>
                    <Text style={styles.titulo} numberOfLines={1}>{a.title}</Text>
                    <Text style={styles.tiempo}>{tiempoRelativo(a.fecha)}</Text>
                  </View>
                  {a.body ? <Text style={styles.detalle} numberOfLines={3}>{a.body}</Text> : null}
                </View>
              </View>
            </TouchableOpacity>
          );
        })}

        {avisos.length === 0 && !error ? (
          <Text style={styles.empty}>No hay avisos. Las notificaciones que te lleguen van a aparecer acá.</Text>
        ) : null}
      </ScrollView>

      {selectMode && (
        <View style={[styles.delBar, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            style={[styles.delBtn, selected.size === 0 && styles.delBtnOff]}
            onPress={() => Alert.alert("Eliminar", `¿Eliminar ${selected.size} aviso(s)?`, [
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

      {/* Detalle del aviso: resumen corto + "Detalle" expande la conclusión completa */}
      <Modal visible={detalle != null} transparent animationType="fade" onRequestClose={() => setDetalle(null)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setDetalle(null)}>
          <TouchableOpacity style={[styles.modalCard, expandido && styles.modalCardExpanded]} activeOpacity={1} onPress={() => {}}>
            {detalle && (
              <>
                <View style={[styles.modalHeader, { backgroundColor: ico.color + "1A" }]}>
                  <View style={[styles.modalIcon, { backgroundColor: ico.color + "26" }]}>
                    <Icon name={ico.name} size={20} color={ico.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle}>{detalle.title}</Text>
                    <Text style={styles.modalTiempo}>
                      {tiempoRelativo(detalle.fecha)}{detalle.cliente ? ` · ${detalle.cliente}` : ""}
                    </Text>
                  </View>
                </View>

                <View style={[styles.modalBodyWrap, expandido && styles.modalBodyWrapExp]}>
                  <Text style={styles.resumen}>{detalle.body || "(sin descripción)"}</Text>
                  {expandido && tieneDetalle && (
                    <>
                      <View style={styles.detalleBox}>
                        <Text style={styles.detLabel}>CONCLUSIÓN COMPLETA</Text>
                        <ScrollView style={styles.detalleScroll} contentContainerStyle={{ paddingBottom: 4 }}>
                          <Text style={styles.detalleText}>{detalle.detalle}</Text>
                        </ScrollView>
                      </View>
                      {esClaudeTermino && (
                        <TouchableOpacity style={styles.desactivar} onPress={desactivarAvisosTarea}>
                          <Icon name="bell" size={14} color={colors.textDim} />
                          <Text style={styles.desactivarText}>Desactivar avisos de “Claude terminó”</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                </View>

                <View style={styles.modalActions}>
                  {detalle.tenant_id != null && (
                    <TouchableOpacity style={styles.modalBtnGhost} onPress={() => irACliente(detalle)}>
                      <Text style={styles.modalBtnGhostText}>Ver cliente</Text>
                    </TouchableOpacity>
                  )}
                  {!expandido && tieneDetalle && (
                    <TouchableOpacity style={styles.modalBtnGhost} onPress={() => setExpandido(true)}>
                      <Text style={styles.modalBtnGhostText}>Detalle</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.modalBtnDanger}
                    onPress={() => Alert.alert("Eliminar", "¿Eliminar este aviso?", [
                      { text: "Cancelar", style: "cancel" },
                      { text: "Eliminar", style: "destructive", onPress: () => eliminarUno(detalle) },
                    ])}
                  >
                    <Icon name="x" size={14} color="#fff" />
                    <Text style={styles.modalBtnDangerText}>Eliminar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalBtnPrimary} onPress={() => setDetalle(null)}>
                    <Text style={styles.modalBtnPrimaryText}>Cerrar</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 16, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  topAction: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  topActionOff: { color: colors.textDim },
  topCount: { color: colors.text, fontSize: 14, fontWeight: "700", marginRight: "auto", marginLeft: 4 },
  content: { padding: 12 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 10 },
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
  empty: { color: colors.textDim, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  delBar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.cardAlt, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 16, paddingTop: 12 },
  delBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.red, borderRadius: 10, paddingVertical: 12 },
  delBtnOff: { opacity: 0.5 },
  delBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 18 },
  modalCard: { backgroundColor: colors.card, borderRadius: 20, width: "100%", maxWidth: 460, maxHeight: "86%", borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  modalCardExpanded: { height: "82%" },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14 },
  modalIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: "800", lineHeight: 20 },
  modalTiempo: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  modalBodyWrap: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4 },
  modalBodyWrapExp: { flex: 1, minHeight: 0 }, // solo expandido: acota el ScrollView para que scrollee
  resumen: { color: colors.text, fontSize: 15, lineHeight: 22 },
  detalleBox: { flex: 1, minHeight: 0, marginTop: 14, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 },
  detLabel: { color: colors.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1, marginBottom: 8 },
  detalleScroll: { flex: 1 },
  detalleText: { color: "#D7E0F0", fontSize: 14, lineHeight: 21 },
  desactivar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  desactivarText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  modalActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16, flexWrap: "wrap" },
  modalBtnGhost: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, marginRight: "auto" },
  modalBtnGhostText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  modalBtnDanger: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.red },
  modalBtnDangerText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  modalBtnPrimary: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, backgroundColor: colors.primary },
  modalBtnPrimaryText: { color: colors.bg, fontSize: 14, fontWeight: "800" },
});
