import React, { useCallback, useEffect, useState } from "react";
import { Alert, Dimensions, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Aviso, eliminarAvisos, getAvisos, setNotifPref } from "../api";
import { useAuth } from "../auth";
import { ErrorBox, Loader } from "../components/ui";
import { AvisosProps } from "../navigation";
import { Icon, IconName } from "../components/Icon";
import { ReagendarSheet, formatWhen } from "../components/ReagendarSheet";
import { getCachedExpoToken, getExpoTokenAsync, programarReaviso } from "../push";
import { colors } from "../theme";

// Alto concreto para el scroll del detalle (no depender de la cadena de flex).
const DETALLE_MAX_H = Math.round(Dimensions.get("window").height * 0.42);

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

// Botón de acción solo-ícono (logo + micro-etiqueta) para la barra del aviso.
function Accion({
  icon,
  label,
  onPress,
  primary,
  danger,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  const tint = primary ? colors.onPrimary : danger ? colors.red : colors.textDim;
  return (
    <TouchableOpacity style={styles.accion} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.accionBtn, primary && styles.accionPrimary, danger && styles.accionDanger]}>
        <Icon name={icon} size={primary ? 23 : 21} color={tint} />
      </View>
      <Text style={[styles.accionCap, primary && styles.accionCapPrimary, danger && styles.accionCapDanger]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
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
  const [reagendar, setReagendar] = useState<Aviso | null>(null); // sheet de reagendado

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

  // Refrescar la lista cada vez que la pantalla toma foco (volver desde el menú,
  // tap en un push, etc.) para no mostrar avisos viejos.
  useEffect(() => navigation.addListener("focus", () => { load(); }), [navigation, load]);

  // Deep-link: si llegamos desde una push con avisoId, RECARGAR la lista fresca
  // (el aviso recién llegado puede no estar en la cacheada) y abrir ese aviso.
  // Limpiamos el param de una para no reabrirlo.
  useEffect(() => {
    const id = route.params?.avisoId;
    if (id == null || !token) return;
    navigation.setParams({ avisoId: undefined });
    (async () => {
      let lista: Aviso[];
      try {
        lista = await getAvisos(token);
        setAvisos(lista);
      } catch {
        return;
      }
      const a = lista.find((x) => x.id === id);
      if (a) { setExpandido(false); setDetalle(a); }
    })();
  }, [route.params?.avisoId, token]);

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

  // Reagendar: agenda el MISMO aviso como notificación local para `when`.
  const onReagendar = async (when: Date) => {
    const a = reagendar;
    setReagendar(null);
    if (!a) return;
    const id = await programarReaviso(a, when);
    setDetalle(null);
    if (id) {
      Alert.alert("Reagendado", `Te vuelvo a avisar ${formatWhen(when)}.`);
    } else {
      Alert.alert("No se pudo", "Activá las notificaciones del sistema para reagendar avisos.");
    }
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
        <View style={styles.modalBackdrop}>
          {/* Capa de cierre DETRÁS de la tarjeta: tocar afuera cierra. La tarjeta
              es un View normal (no Touchable) para no robarle el gesto al ScrollView. */}
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDetalle(null)} />
          <View style={styles.modalCard}>
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

                <View style={styles.modalBodyWrap}>
                  <Text style={styles.resumen}>{detalle.body || "(sin descripción)"}</Text>
                  {expandido && tieneDetalle && (
                    <>
                      <View style={styles.detalleBox}>
                        <Text style={styles.detLabel}>CONCLUSIÓN COMPLETA</Text>
                        <ScrollView
                          style={styles.detalleScroll}
                          contentContainerStyle={{ paddingBottom: 4 }}
                          nestedScrollEnabled
                          showsVerticalScrollIndicator
                        >
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

                {/* Acciones solo-íconos, centradas y repartidas parejo según cuántas haya */}
                <View style={styles.modalActions}>
                  {detalle.tenant_id != null && (
                    <Accion icon="user" label="Cliente" onPress={() => irACliente(detalle)} />
                  )}
                  {!expandido && tieneDetalle && (
                    <Accion icon="list" label="Detalle" onPress={() => setExpandido(true)} />
                  )}
                  <Accion icon="clock" label="Reagendar" primary onPress={() => setReagendar(detalle)} />
                  <Accion
                    icon="trash"
                    label="Eliminar"
                    danger
                    onPress={() => Alert.alert("Eliminar", "¿Eliminar este aviso?", [
                      { text: "Cancelar", style: "cancel" },
                      { text: "Eliminar", style: "destructive", onPress: () => eliminarUno(detalle) },
                    ])}
                  />
                  <Accion icon="x" label="Cerrar" onPress={() => setDetalle(null)} />
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Reagendar: re-disparar el aviso (+30 min, +1 h, o personalizado) */}
      <ReagendarSheet
        visible={reagendar != null}
        titulo={reagendar?.title ?? ""}
        onClose={() => setReagendar(null)}
        onConfirm={onReagendar}
      />
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
  modalCard: { backgroundColor: colors.card, borderRadius: 20, width: "100%", maxWidth: 460, maxHeight: "88%", borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14 },
  modalIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  modalTitle: { color: colors.text, fontSize: 16, fontWeight: "800", lineHeight: 20 },
  modalTiempo: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  modalBodyWrap: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4 },
  resumen: { color: colors.text, fontSize: 15, lineHeight: 22 },
  detalleBox: { marginTop: 14, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 },
  detLabel: { color: colors.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1, marginBottom: 8 },
  detalleScroll: { maxHeight: DETALLE_MAX_H },
  detalleText: { color: "#D7E0F0", fontSize: 14, lineHeight: 21 },
  desactivar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  desactivarText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  modalActions: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-evenly", paddingHorizontal: 12, paddingTop: 14, paddingBottom: 18 },
  accion: { alignItems: "center", gap: 6, flex: 1 },
  accionBtn: { width: 52, height: 52, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardAlt, alignItems: "center", justifyContent: "center" },
  accionPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  accionDanger: { borderColor: "rgba(239,68,68,0.45)" },
  accionCap: { fontSize: 10.5, fontWeight: "700", color: colors.textDim },
  accionCapPrimary: { color: colors.primary },
  accionCapDanger: { color: colors.red },
});
