import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
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
import { useFocusEffect, useIsFocused } from "@react-navigation/native";

import {
  AgentError,
  ColaEstado,
  EstadoError,
  crearErrorManual,
  deleteError,
  editarError,
  encolarErrores,
  getErrores,
  setEstadoError,
} from "../api";
import { useAuth } from "../auth";
import { Icon, IconText } from "../components/Icon";
import { SwipeRow } from "../components/SwipeRow";
import { ErrorBox, Loader } from "../components/ui";
import { ErroresProps } from "../navigation";
import { pickImageBase64 } from "../imagePicker";
import { colors } from "../theme";

type Filtro = EstadoError;
const YELLOW = "#EBC944"; // standby = en espera de info

export default function ErroresScreen(_props: ErroresProps) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [errores, setErrores] = useState<AgentError[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("nuevo");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [procesando, setProcesando] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setErrores(await getErrores(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Auto-refresh cada 10s mientras haya algo activo en la cola (Claude procesando).
  const hayActivo = errores.some((e) => e.cola_estado === "pendiente" || e.cola_estado === "standby");
  const isFocused = useIsFocused();
  useEffect(() => {
    if (!hayActivo || selectMode || !token || !isFocused) return;
    const t = setInterval(() => { getErrores(token).then(setErrores).catch(() => {}); }, 10000);
    return () => clearInterval(t);
  }, [hayActivo, selectMode, token, isFocused]);

  const cambiarEstado = async (err: AgentError, estado: EstadoError) => {
    if (!token) return;
    const prev = err.estado;
    setErrores((p) => p.map((e) => (e.id === err.id ? { ...e, estado } : e)));
    try {
      const upd = await setEstadoError(token, err.id, estado);
      setErrores((p) => p.map((e) => (e.id === upd.id ? upd : e)));
    } catch {
      setErrores((p) => p.map((e) => (e.id === err.id ? { ...e, estado: prev } : e)));
    }
  };

  const setCola = async (err: AgentError, cola_estado: NonNullable<ColaEstado> | "") => {
    if (!token) return;
    try {
      const upd = await editarError(token, err.id, { cola_estado });
      setErrores((p) => p.map((e) => (e.id === upd.id ? upd : e)));
    } catch {
      load();
    }
  };

  const confirmarFixed = (err: AgentError) => cambiarEstado(err, "fixed"); // sale de la cola (backend limpia)
  const rechazar = (err: AgentError) => setCola(err, "pendiente"); // vuelve a la cola
  const reactivar = (err: AgentError) => setCola(err, "pendiente");

  const borrar = async (err: AgentError) => {
    if (!token) return;
    const snap = errores;
    setErrores((p) => p.filter((e) => e.id !== err.id));
    try { await deleteError(token, err.id); } catch { setErrores(snap); }
  };
  const confirmarBorrar = (err: AgentError) => {
    Alert.alert("Borrar error", `¿Borrar el error #${err.id}? No se puede deshacer.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Borrar", style: "destructive", onPress: () => borrar(err) },
    ]);
  };

  const salirSeleccion = () => { setSelectMode(false); setSelected(new Set()); };
  const toggleSelect = (id: number) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const procesar = async () => {
    if (!token || selected.size === 0 || procesando) return;
    const ids = [...selected];
    setProcesando(true);
    try {
      const cola = await encolarErrores(token, ids);
      const byId = new Map(cola.map((c) => [c.id, c]));
      setErrores((prev) => prev.map((e) => byId.get(e.id) ?? e));
      salirSeleccion();
      Alert.alert("A la cola", `${ids.length === 1 ? "1 error" : ids.length + " errores"} en la cola de procesamiento.`);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "No se pudo procesar.");
    } finally {
      setProcesando(false);
    }
  };

  const eliminarMarcados = () => {
    if (!token || selected.size === 0 || procesando) return;
    const ids = [...selected];
    Alert.alert("Eliminar", `¿Eliminar ${ids.length} error(es)? No se puede deshacer.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar", style: "destructive", onPress: async () => {
          setProcesando(true);
          setErrores((prev) => prev.filter((e) => !selected.has(e.id)));
          salirSeleccion();
          try { await Promise.all(ids.map((id) => deleteError(token, id))); }
          catch { load(); }
          finally { setProcesando(false); }
        },
      },
    ]);
  };

  const onCreado = (nuevo: AgentError) => { setErrores((prev) => [nuevo, ...prev]); setFiltro("nuevo"); };

  if (loading) return <Loader />;

  const enCola = (e: AgentError) => !!e.cola_estado;
  const COLA_ORDER: Record<NonNullable<ColaEstado>, number> = { pendiente: 0, procesado: 1, standby: 2 };
  const queued = errores.filter(enCola).sort(
    (a, b) => (COLA_ORDER[a.cola_estado!] ?? 9) - (COLA_ORDER[b.cola_estado!] ?? 9) || a.id - b.id,
  );
  const colaDone = queued.filter((e) => e.cola_estado === "procesado").length;
  const colaPend = queued.filter((e) => e.cola_estado === "pendiente").length;
  const colaStandby = queued.filter((e) => e.cola_estado === "standby").length;
  const colaPct = queued.length ? Math.round((colaDone / queued.length) * 100) : 0;
  const colaSettled = queued.length > 0 && colaPend === 0;
  const colaAllDone = colaSettled && colaStandby === 0;
  const colaWaiting = colaSettled && colaStandby > 0;
  const mostrarCola = !selectMode && filtro !== "fixed" && queued.length > 0;

  const visibles = errores.filter((e) => e.estado === filtro && !enCola(e));
  const n = (s: EstadoError) => errores.filter((e) => e.estado === s).length;
  const tabs: [EstadoError, string][] = [
    ["nuevo", `Nuevos (${n("nuevo")})`],
    ["reportado", `Reportados (${n("reportado")})`],
    ["fixed", `Fixed (${n("fixed")})`],
  ];

  const colaHeader = mostrarCola ? (
    <View style={[styles.colaBox, colaAllDone && styles.colaBoxDone, colaWaiting && styles.colaBoxWaiting]}>
      <View style={styles.colaBoxHead}>
        {colaAllDone ? (
          <View style={styles.colaCheckHead}><Icon name="check" size={11} color={colors.bg} /></View>
        ) : colaWaiting ? (
          <View style={styles.colaWaitHead}><Icon name="clock" size={11} color={colors.bg} /></View>
        ) : colaPend > 0 ? (
          <ActivityIndicator size="small" color={colors.blue} />
        ) : null}
        <Text style={styles.colaBoxTitle}>
          {colaAllDone
            ? queued.length === 1 ? "Listo, resolví 1" : `Listo, resolví los ${queued.length}`
            : colaWaiting ? "Resolví los que pude" : "Procesando"}
        </Text>
        <Text style={[styles.colaBoxCount, colaAllDone && styles.colaBoxCountDone, colaWaiting && styles.colaBoxCountWaiting]}>{colaDone}/{queued.length}</Text>
        <View style={[styles.colaBoxBar, colaAllDone && styles.colaBoxBarDone, colaWaiting && styles.colaBoxBarWaiting]}>
          <View style={[styles.colaBoxBarFill, colaAllDone && styles.colaBoxBarFillDone, colaWaiting && styles.colaBoxBarFillWaiting, { width: `${colaPct}%` }]} />
        </View>
      </View>
      {colaAllDone && <Text style={styles.colaBoxHint}>Revisá la conclusión y confirmá cada uno para pasarlo a Fixed.</Text>}
      {colaWaiting && <Text style={styles.colaBoxHint}>{colaStandby === 1 ? "1 espera" : `${colaStandby} esperan`} tu info para seguir.</Text>}
      {queued.map((q) => (
        <View key={q.id}>
          <ColaCard err={q} settled={colaSettled} />
          {colaSettled && q.cola_estado === "procesado" && (
            <View style={styles.colaActions}>
              <TouchableOpacity style={[styles.colaConfirmBtn, styles.colaActionFlex]} onPress={() => confirmarFixed(q)} activeOpacity={0.8}>
                <Icon name="check" size={15} color={colors.green} />
                <Text style={styles.colaConfirmText}>Confirmar (Fixed)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.colaRejectBtn, styles.colaActionFlex]} onPress={() => rechazar(q)} activeOpacity={0.8}>
                <Icon name="undo" size={15} color={colors.red} />
                <Text style={styles.colaRejectText}>Rechazar</Text>
              </TouchableOpacity>
            </View>
          )}
          {colaSettled && q.cola_estado === "standby" && (
            <TouchableOpacity style={styles.colaReactivarBtn} onPress={() => reactivar(q)} activeOpacity={0.8}>
              <Icon name="undo" size={15} color={colors.blue} />
              <Text style={styles.colaReactivarText}>Ya te pasé la info — volver a la cola</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  ) : null;

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {tabs.map(([k, l]) => (
          <Tab key={k} label={l} active={filtro === k} onPress={() => setFiltro(k)} />
        ))}
      </View>

      {selectMode ? (
        <View style={styles.selHeader}>
          <Text style={styles.selHeaderText}>Tildá los que querés procesar</Text>
          <TouchableOpacity onPress={salirSeleccion}><Text style={styles.selHeaderCancel}>Cancelar</Text></TouchableOpacity>
        </View>
      ) : (
        <View style={styles.topActions}>
          <TouchableOpacity style={styles.addBtn} onPress={() => setFormOpen(true)}>
            <Icon name="plus" size={18} color="#fff" />
            <Text style={styles.addBtnText}>Cargar error</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.selBtn} onPress={() => setSelectMode(true)}>
            <Icon name="check" size={16} color={colors.primary} />
            <Text style={styles.selBtnText}>Seleccionar</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        data={visibles}
        keyExtractor={(e) => String(e.id)}
        ListHeaderComponent={
          <>
            {error ? <ErrorBox message={error} onRetry={load} /> : null}
            {colaHeader}
          </>
        }
        ListEmptyComponent={mostrarCola ? null : <Text style={styles.empty}>{vacioMsg(filtro)}</Text>}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
        renderItem={({ item }) => {
          if (selectMode && item.estado !== "fixed") {
            return (
              <TouchableOpacity onPress={() => toggleSelect(item.id)} activeOpacity={0.7}>
                <ErrorCard err={item} selectMode selected={selected.has(item.id)} />
              </TouchableOpacity>
            );
          }
          return (
            <SwipeRow
              left={{ icon: "x", color: colors.red, onTrigger: () => confirmarBorrar(item) }}
              right={
                item.estado === "nuevo"
                  ? { icon: "flag", color: colors.amber, onTrigger: () => cambiarEstado(item, "reportado") }
                  : { icon: "undo", color: colors.amber, onTrigger: () => cambiarEstado(item, "nuevo") }
              }
            >
              <ErrorCard err={item} onEstado={cambiarEstado} />
            </SwipeRow>
          );
        }}
      />

      {selectMode && (
        <View style={[styles.procBar, { paddingBottom: insets.bottom + 12 }]}>
          <Text style={styles.procCount}>{selected.size === 1 ? "1 seleccionado" : `${selected.size} seleccionados`}</Text>
          <View style={styles.procBtns}>
            <TouchableOpacity style={[styles.eliminarBtn, selected.size === 0 ? styles.procBtnOff : null]} onPress={eliminarMarcados} disabled={selected.size === 0 || procesando}>
              <Icon name="x" size={15} color={colors.red} />
              <Text style={styles.eliminarBtnText}>Eliminar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.procBtn, selected.size === 0 ? styles.procBtnOff : null]} onPress={procesar} disabled={selected.size === 0 || procesando}>
              <Text style={styles.procBtnText}>{procesando ? "…" : "Procesar"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <CargarErrorModal visible={formOpen} onClose={() => setFormOpen(false)} onCreado={onCreado} />
    </View>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.tab, active ? styles.tabActive : null]} onPress={onPress}>
      <Text style={[styles.tabText, active ? styles.tabTextActive : null]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

function ErrorCard({
  err, onEstado, selectMode = false, selected = false,
}: {
  err: AgentError;
  onEstado?: (e: AgentError, s: EstadoError) => void;
  selectMode?: boolean;
  selected?: boolean;
}) {
  const borderColor = err.estado === "fixed" ? colors.green : err.estado === "reportado" ? colors.red : colors.amber;
  return (
    <View style={[styles.card, { borderLeftColor: borderColor }, err.estado === "fixed" ? styles.cardFixed : null, selected ? styles.cardSelected : null]}>
      <View style={styles.headerRow}>
        {selectMode && (
          <View style={[styles.selBox, selected ? styles.selBoxOn : null]}>
            {selected && <Icon name="check" size={13} color="#fff" />}
          </View>
        )}
        <Text style={styles.numero}>#{err.id}</Text>
        <View style={styles.headerRight}>
          <Text style={styles.fuente}>{err.fuente}{err.agente === "sebi" ? "  · manual" : ""}</Text>
          <Text style={styles.fecha}>{fmt(err.fecha)}</Text>
        </View>
        {err.estado === "reportado" ? <Text style={styles.badgeReportado}>Reportado</Text> : null}
        {err.estado === "fixed" ? <Text style={styles.badgeFixed}>Fixed</Text> : null}
      </View>
      <Text style={styles.contenido}>{err.contenido}</Text>
      <View style={styles.metaRow}>
        {err.telefono ? <IconText name="phone" text={err.telefono} /> : null}
        {err.patron ? <IconText name="search" text={err.patron} /> : null}
      </View>
      {!selectMode && onEstado && (
        <View style={styles.actionsRow}>
          {err.estado === "nuevo" ? <ActionBtn icon="flag" label="Reportar" color={colors.red} onPress={() => onEstado(err, "reportado")} /> : null}
          {err.estado === "reportado" ? <ActionBtn icon="undo" label="Quitar reporte" color={colors.textDim} onPress={() => onEstado(err, "nuevo")} /> : null}
          {err.estado === "fixed" ? <ActionBtn icon="undo" label="Reabrir" color={colors.textDim} onPress={() => onEstado(err, "nuevo")} /> : null}
        </View>
      )}
    </View>
  );
}

function ColaCard({ err, settled }: { err: AgentError; settled: boolean }) {
  const [showConcl, setShowConcl] = useState(false);
  const dotColor = err.cola_estado === "procesado" ? colors.green : err.cola_estado === "standby" ? YELLOW : colors.blue;
  return (
    <View style={[styles.card, { borderLeftColor: dotColor, borderLeftWidth: 3 }]}>
      <View style={styles.headerRow}>
        <Text style={styles.numero}>#{err.id}</Text>
        <View style={styles.headerRight}>
          <Text style={styles.fuente}>{err.fuente}</Text>
        </View>
        {err.cola_estado === "pendiente" && <ActivityIndicator size="small" color={colors.blue} />}
        {err.cola_estado === "procesado" && <Text style={styles.badgeFixed}>resuelto</Text>}
        {err.cola_estado === "standby" && <Text style={[styles.badgeReportado, { color: YELLOW, borderColor: YELLOW }]}>falta info</Text>}
      </View>
      <Text style={styles.contenido}>{err.contenido}</Text>
      {err.cola_resultado ? (
        <View>
          <TouchableOpacity style={styles.conclToggle} onPress={() => setShowConcl((v) => !v)} activeOpacity={0.7}>
            <Text style={styles.conclToggleText}>{showConcl ? "▾ Ocultar conclusión" : "▸ Ver conclusión"}</Text>
          </TouchableOpacity>
          {showConcl && (
            <View style={styles.conclBody}><Text style={styles.conclText}>{err.cola_resultado}</Text></View>
          )}
        </View>
      ) : null}
    </View>
  );
}

function ActionBtn({ icon, label, color, onPress }: { icon: "flag" | "undo"; label: string; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.actionBtn, { borderColor: color }]} onPress={onPress} activeOpacity={0.7}>
      <Icon name={icon} size={14} color={color} strokeWidth={2} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function CargarErrorModal({
  visible, onClose, onCreado,
}: {
  visible: boolean;
  onClose: () => void;
  onCreado: (e: AgentError) => void;
}) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [texto, setTexto] = useState("");
  const [img, setImg] = useState<{ b64: string; mime: string; nombre: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (visible) { setTexto(""); setImg(null); } }, [visible]);

  const elegirImagen = async () => {
    try {
      const picked = await pickImageBase64();
      if (picked) setImg(picked);
    } catch (e) {
      Alert.alert("Imagen", e instanceof Error ? e.message : "No se pudo abrir la galería.");
    }
  };

  const guardar = async () => {
    if (!token || (!texto.trim() && !img) || busy) return;
    setBusy(true);
    try {
      const nuevo = await crearErrorManual(token, texto.trim(), img ? { b64: img.b64, mime: img.mime } : undefined);
      onCreado(nuevo);
      onClose();
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "No se pudo cargar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 18 }]}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetTitle}>Cargar error a mano</Text>
            <TextInput
              style={styles.input}
              placeholder="¿Qué error viste?"
              placeholderTextColor={colors.textDim}
              value={texto}
              onChangeText={setTexto}
              multiline
              autoFocus
            />
            <Text style={styles.label}>Imagen (opcional)</Text>
            {img ? (
              <View style={styles.imgRow}>
                <Text style={styles.imgName} numberOfLines={1}>📎 {img.nombre}</Text>
                <TouchableOpacity onPress={() => setImg(null)} disabled={busy}>
                  <Text style={styles.imgQuitar}>Quitar</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.imgBtn} onPress={elegirImagen} disabled={busy}>
                <Icon name="plus" size={15} color={colors.primary} />
                <Text style={styles.imgBtnText}>Adjuntar imagen</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.imgHint}>La IA la lee y transcribe el error (cuesta centavos).</Text>

            <View style={styles.actions}>
              <TouchableOpacity style={styles.btnCancel} onPress={onClose}><Text style={styles.btnCancelText}>Cancelar</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.btnSave, (!texto.trim() && !img) ? styles.btnSaveOff : null]} onPress={guardar} disabled={(!texto.trim() && !img) || busy}>
                <Text style={styles.btnSaveText}>{busy ? (img ? "Analizando…" : "Cargando…") : "Cargar"}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function vacioMsg(f: Filtro): string {
  if (f === "nuevo") return "Sin errores nuevos 🎉";
  if (f === "reportado") return "No hay errores reportados.";
  return "No hay errores solucionados.";
}

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 12, paddingBottom: 40 },
  empty: { color: colors.textDim, textAlign: "center", marginTop: 40 },

  tabs: { flexDirection: "row", padding: 8, gap: 8 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  tabActive: { backgroundColor: colors.cardAlt, borderColor: colors.primary },
  tabText: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  tabTextActive: { color: colors.text },

  topActions: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginTop: 4, marginBottom: 4 },
  addBtn: { flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  addBtnText: { color: "#fff", fontSize: 15, fontWeight: "700", marginLeft: 6 },
  selBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14 },
  selBtnText: { color: colors.primary, fontSize: 13, fontWeight: "700" },

  selHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 12, marginTop: 8, marginBottom: 4 },
  selHeaderText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  selHeaderCancel: { color: colors.primary, fontSize: 13, fontWeight: "700" },

  procBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.cardAlt, borderTopWidth: 1, borderTopColor: colors.border },
  procCount: { color: colors.text, fontSize: 14, fontWeight: "700" },
  procBtns: { flexDirection: "row", gap: 8 },
  procBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 18 },
  procBtnOff: { opacity: 0.5 },
  procBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  eliminarBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: colors.red, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  eliminarBtnText: { color: colors.red, fontSize: 14, fontWeight: "700" },

  colaBox: { backgroundColor: "rgba(110,150,230,0.08)", borderWidth: 1, borderColor: "rgba(110,150,230,0.38)", borderRadius: 14, padding: 10, paddingBottom: 4, marginBottom: 16 },
  colaBoxHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10, paddingHorizontal: 4, paddingTop: 2 },
  colaBoxTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  colaBoxCount: { color: colors.blue, fontSize: 12, fontWeight: "700" },
  colaBoxBar: { flex: 1, height: 5, borderRadius: 3, backgroundColor: "rgba(110,150,230,0.16)", overflow: "hidden", marginLeft: 4 },
  colaBoxBarFill: { height: "100%", borderRadius: 3, backgroundColor: colors.blue },
  colaBoxDone: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.5)" },
  colaCheckHead: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.green, alignItems: "center", justifyContent: "center" },
  colaBoxCountDone: { color: colors.green },
  colaBoxBarDone: { backgroundColor: "rgba(34,197,94,0.18)" },
  colaBoxBarFillDone: { backgroundColor: colors.green },
  colaBoxWaiting: { backgroundColor: "rgba(235,201,68,0.12)", borderColor: "rgba(235,201,68,0.5)" },
  colaWaitHead: { width: 18, height: 18, borderRadius: 9, backgroundColor: YELLOW, alignItems: "center", justifyContent: "center" },
  colaBoxCountWaiting: { color: YELLOW },
  colaBoxBarWaiting: { backgroundColor: "rgba(235,201,68,0.18)" },
  colaBoxBarFillWaiting: { backgroundColor: YELLOW },
  colaBoxHint: { color: colors.textDim, fontSize: 12, marginTop: -4, marginBottom: 10, paddingHorizontal: 4 },
  colaActions: { flexDirection: "row", gap: 8, marginTop: -2, marginBottom: 10 },
  colaActionFlex: { flex: 1 },
  colaConfirmBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.green, borderRadius: 9, paddingVertical: 9 },
  colaConfirmText: { color: colors.green, fontSize: 13, fontWeight: "700" },
  colaRejectBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.red, borderRadius: 9, paddingVertical: 9 },
  colaRejectText: { color: colors.red, fontSize: 13, fontWeight: "700" },
  colaReactivarBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.blue, borderRadius: 9, paddingVertical: 9, marginTop: -2, marginBottom: 10 },
  colaReactivarText: { color: colors.blue, fontSize: 13, fontWeight: "700" },

  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, borderLeftColor: colors.red, borderLeftWidth: 3 },
  cardFixed: { opacity: 0.55 },
  cardSelected: { borderWidth: 1, borderColor: colors.primary },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 4 },
  selBox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center", marginRight: 6 },
  selBoxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  numero: { color: colors.text, fontSize: 16, fontWeight: "800" },
  headerRight: { flex: 1, marginLeft: 10 },
  fuente: { color: colors.amber, fontSize: 12, fontWeight: "700" },
  fecha: { color: colors.textDim, fontSize: 11 },
  badgeReportado: { color: colors.red, fontSize: 11, fontWeight: "700", borderColor: colors.red, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeFixed: { color: colors.green, fontSize: 11, fontWeight: "700", borderColor: colors.green, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  contenido: { color: colors.text, fontSize: 14 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },

  actionsRow: { flexDirection: "row", gap: 8, marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  actionLabel: { fontSize: 12, fontWeight: "700" },

  conclToggle: { marginTop: 10, paddingVertical: 4 },
  conclToggleText: { color: colors.green, fontSize: 12, fontWeight: "700" },
  conclBody: { marginTop: 6, backgroundColor: "rgba(70,177,123,0.12)", borderWidth: 1, borderColor: "rgba(70,177,123,0.3)", borderRadius: 10, padding: 11 },
  conclText: { color: colors.text, fontSize: 13, lineHeight: 19 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: "90%" },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: "800", marginBottom: 12 },
  input: { backgroundColor: colors.card, borderRadius: 10, padding: 12, color: colors.text, fontSize: 15, minHeight: 90, textAlignVertical: "top" },
  label: { color: colors.textDim, fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginTop: 16, marginBottom: 8 },
  imgRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  imgName: { color: colors.text, fontSize: 14, flex: 1 },
  imgQuitar: { color: colors.red, fontSize: 13, fontWeight: "700" },
  imgBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: colors.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, alignSelf: "flex-start" },
  imgBtnText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  imgHint: { color: colors.textDim, fontSize: 11, marginTop: 8 },

  actions: { flexDirection: "row", gap: 10, marginTop: 20 },
  btnCancel: { flex: 1, borderColor: colors.border, borderWidth: 1, borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  btnCancelText: { color: colors.text, fontSize: 15, fontWeight: "700" },
  btnSave: { flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  btnSaveOff: { opacity: 0.5 },
  btnSaveText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
