import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Area, Pendiente, Prioridad, borrarPendiente, crearPendiente, editarPendiente, getPendientes } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import { SwipeRow } from "../components/SwipeRow";
import { ErrorBox, Loader } from "../components/ui";
import { PendientesProps } from "../navigation";
import { colors } from "../theme";

const PRIORIDADES: Prioridad[] = ["alta", "media", "baja"];
const AREAS: Area[] = ["app", "web", "etiguel"];

const prioColor: Record<Prioridad, string> = { alta: colors.red, media: colors.amber, baja: colors.textDim };
const areaColor: Record<Area, string> = { app: colors.primary, web: colors.blue, etiguel: colors.amber };

export default function PendientesScreen(_props: PendientesProps) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Pendiente[]>([]);
  const [filtro, setFiltro] = useState<"pendientes" | "realizados">("pendientes");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setItems(await getPendientes(token, true)); // todos (pendientes + realizados)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const setHecho = async (p: Pendiente, hecho: boolean) => {
    if (!token) return;
    setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, hecho } : x)));
    try {
      await editarPendiente(token, p.id, { hecho });
    } catch {
      load();
    }
  };

  const borrar = async (p: Pendiente) => {
    if (!token) return;
    const snap = items;
    setItems((prev) => prev.filter((x) => x.id !== p.id));
    try {
      await borrarPendiente(token, p.id);
    } catch {
      setItems(snap);
    }
  };

  const confirmarBorrar = (p: Pendiente) => {
    Alert.alert("Borrar pendiente", "¿Seguro que querés borrarlo? No se puede deshacer.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Borrar", style: "destructive", onPress: () => borrar(p) },
    ]);
  };

  const agregar = async (texto: string, prioridad: Prioridad, area: Area) => {
    if (!token) return;
    const nuevo = await crearPendiente(token, texto, prioridad, area);
    setItems((prev) => [nuevo, ...prev]);
    setFiltro("pendientes");
  };

  if (loading) return <Loader />;

  const visibles = items.filter((p) => (filtro === "pendientes" ? !p.hecho : p.hecho));
  const nPend = items.filter((p) => !p.hecho).length;
  const nReal = items.length - nPend;

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <Tab label={`Pendientes (${nPend})`} active={filtro === "pendientes"} onPress={() => setFiltro("pendientes")} />
        <Tab label={`Realizados (${nReal})`} active={filtro === "realizados"} onPress={() => setFiltro("realizados")} />
      </View>

      <TouchableOpacity style={styles.addBtn} onPress={() => setFormOpen(true)}>
        <Icon name="plus" size={18} color="#fff" />
        <Text style={styles.addBtnText}>Nuevo pendiente</Text>
      </TouchableOpacity>

      <FlatList
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        data={visibles}
        keyExtractor={(p) => String(p.id)}
        ListHeaderComponent={error ? <ErrorBox message={error} onRetry={load} /> : null}
        ListEmptyComponent={
          <Text style={styles.empty}>{filtro === "pendientes" ? "Sin pendientes 🎉" : "Nada realizado todavía."}</Text>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
        renderItem={({ item }) => (
          <SwipeRow
            left={
              filtro === "pendientes"
                ? { icon: "check", color: colors.green, onTrigger: () => setHecho(item, true) }
                : { icon: "undo", color: colors.amber, onTrigger: () => setHecho(item, false) }
            }
            right={{ icon: "x", color: colors.red, onTrigger: () => confirmarBorrar(item) }}
          >
            <PendienteCard item={item} />
          </SwipeRow>
        )}
      />

      <FormModal visible={formOpen} onClose={() => setFormOpen(false)} onSubmit={agregar} />
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

function PendienteCard({ item }: { item: Pendiente }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        <Text style={styles.texto}>{item.texto}</Text>
        <View style={styles.badges}>
          <Text style={[styles.badge, { color: prioColor[item.prioridad], borderColor: prioColor[item.prioridad] }]}>
            {item.prioridad}
          </Text>
          <Text style={[styles.badge, { color: areaColor[item.area], borderColor: areaColor[item.area] }]}>
            {item.area}
          </Text>
        </View>
      </View>
    </View>
  );
}

function FormModal({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (texto: string, prioridad: Prioridad, area: Area) => Promise<void>;
}) {
  const [texto, setTexto] = useState("");
  const [prioridad, setPrioridad] = useState<Prioridad>("media");
  const [area, setArea] = useState<Area>("app");
  const [saving, setSaving] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) { setTexto(""); setPrioridad("media"); setArea("app"); }
  }, [visible]);

  const guardar = async () => {
    if (!texto.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit(texto.trim(), prioridad, area);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 18 }]}>
          <Text style={styles.sheetTitle}>Nuevo pendiente</Text>
          <TextInput
            style={styles.input}
            placeholder="¿Qué hay que hacer?"
            placeholderTextColor={colors.textDim}
            value={texto}
            onChangeText={setTexto}
            multiline
            autoFocus
          />

          <Text style={styles.label}>Prioridad</Text>
          <View style={styles.chips}>
            {PRIORIDADES.map((p) => (
              <Chip key={p} label={p} active={prioridad === p} color={prioColor[p]} onPress={() => setPrioridad(p)} />
            ))}
          </View>

          <Text style={styles.label}>Área</Text>
          <View style={styles.chips}>
            {AREAS.map((a) => (
              <Chip key={a} label={a} active={area === a} color={areaColor[a]} onPress={() => setArea(a)} />
            ))}
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.btnCancel} onPress={onClose}>
              <Text style={styles.btnCancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnSave, !texto.trim() ? styles.btnSaveOff : null]} onPress={guardar} disabled={!texto.trim() || saving}>
              <Text style={styles.btnSaveText}>{saving ? "Guardando…" : "Guardar"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Chip({ label, active, color, onPress }: { label: string; active: boolean; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active ? { backgroundColor: color, borderColor: color } : null]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, active ? styles.chipTextOn : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 12, paddingBottom: 40 },
  empty: { color: colors.textDim, textAlign: "center", marginTop: 40 },

  tabs: { flexDirection: "row", padding: 8, paddingBottom: 0, gap: 8 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  tabActive: { backgroundColor: colors.cardAlt, borderColor: colors.primary },
  tabText: { color: colors.textDim, fontSize: 13, fontWeight: "700" },
  tabTextActive: { color: colors.text },

  addBtn: { backgroundColor: colors.primary, margin: 12, marginBottom: 4, borderRadius: 10, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  addBtnText: { color: "#fff", fontSize: 15, fontWeight: "700", marginLeft: 6 },

  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center" },
  cardBody: { flex: 1 },
  texto: { color: colors.text, fontSize: 14 },
  badges: { flexDirection: "row", gap: 8, marginTop: 8 },
  badge: { fontSize: 11, fontWeight: "700", borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden", textTransform: "capitalize" },


  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18 },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: "800", marginBottom: 12 },
  input: { backgroundColor: colors.card, borderRadius: 10, padding: 12, color: colors.text, fontSize: 15, minHeight: 60, textAlignVertical: "top" },
  label: { color: colors.textDim, fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: "row", gap: 8 },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { color: colors.text, fontSize: 13, textTransform: "capitalize" },
  chipTextOn: { color: "#fff", fontWeight: "700" },

  actions: { flexDirection: "row", gap: 10, marginTop: 20 },
  btnCancel: { flex: 1, borderColor: colors.border, borderWidth: 1, borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  btnCancelText: { color: colors.text, fontSize: 15, fontWeight: "700" },
  btnSave: { flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  btnSaveOff: { opacity: 0.5 },
  btnSaveText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
