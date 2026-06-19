import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { Area, Pendiente, Prioridad, borrarPendiente, crearPendiente, editarPendiente, getPendientes } from "../api";
import { useAuth } from "../auth";
import { ErrorBox, Loader } from "../components/ui";
import { PendientesProps } from "../navigation";
import { colors } from "../theme";

const PRIORIDADES: Prioridad[] = ["alta", "media", "baja"];
const AREAS: Area[] = ["app", "web", "etiguel"];

const prioColor: Record<Prioridad, string> = { alta: colors.red, media: colors.amber, baja: colors.textDim };
const areaColor: Record<Area, string> = { app: colors.primary, web: colors.blue, etiguel: colors.amber };

export default function PendientesScreen(_props: PendientesProps) {
  const { token } = useAuth();
  const [items, setItems] = useState<Pendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setItems(await getPendientes(token));
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

  const marcarHecho = async (p: Pendiente) => {
    if (!token) return;
    setItems((prev) => prev.filter((x) => x.id !== p.id)); // sale de la lista de activos
    try {
      await editarPendiente(token, p.id, { hecho: true });
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

  const agregar = async (texto: string, prioridad: Prioridad, area: Area) => {
    if (!token) return;
    const nuevo = await crearPendiente(token, texto, prioridad, area);
    setItems((prev) => [nuevo, ...prev]);
  };

  if (loading) return <Loader />;

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.addBtn} onPress={() => setFormOpen(true)}>
        <Text style={styles.addBtnText}>＋  Nuevo pendiente</Text>
      </TouchableOpacity>

      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(p) => String(p.id)}
        ListHeaderComponent={error ? <ErrorBox message={error} onRetry={load} /> : null}
        ListEmptyComponent={<Text style={styles.empty}>Sin pendientes 🎉</Text>}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
        renderItem={({ item }) => (
          <PendienteCard item={item} onDone={() => marcarHecho(item)} onDelete={() => borrar(item)} />
        )}
      />

      <FormModal visible={formOpen} onClose={() => setFormOpen(false)} onSubmit={agregar} />
    </View>
  );
}

function PendienteCard({ item, onDone, onDelete }: { item: Pendiente; onDone: () => void; onDelete: () => void }) {
  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.tilde} onPress={onDone} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.tildeText}>○</Text>
      </TouchableOpacity>
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
      <TouchableOpacity onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.del}>✕</Text>
      </TouchableOpacity>
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
        <View style={styles.sheet}>
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

  addBtn: { backgroundColor: colors.primary, margin: 12, marginBottom: 4, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  addBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center" },
  tilde: { marginRight: 10 },
  tildeText: { color: colors.textDim, fontSize: 22 },
  cardBody: { flex: 1 },
  texto: { color: colors.text, fontSize: 14 },
  badges: { flexDirection: "row", gap: 8, marginTop: 8 },
  badge: { fontSize: 11, fontWeight: "700", borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden", textTransform: "capitalize" },
  del: { color: colors.textDim, fontSize: 16, marginLeft: 10 },

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
