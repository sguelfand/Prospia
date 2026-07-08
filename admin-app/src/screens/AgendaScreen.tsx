import React, { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { AgendaItem, borrarAgenda, crearAgenda, editarAgenda, getAgenda } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import { SwipeRow } from "../components/SwipeRow";
import { ErrorBox, Loader } from "../components/ui";
import { AgendaProps } from "../navigation";
import { colors } from "../theme";

// ── helpers de fecha (local, AAAA-MM-DD) ──
function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function hoyStr(): string {
  return fmt(new Date());
}
function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return fmt(d);
}
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function etiquetaFecha(fecha: string): string {
  const hoy = hoyStr();
  if (fecha === hoy) return "Hoy";
  if (fecha === addDays(1)) return "Mañana";
  if (fecha < hoy) return "Vencida";
  // parse sin timezone shift
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DIAS[dt.getDay()]} ${d} ${MESES[m - 1]}`;
}

type Grupo = "vencidas" | "hoy" | "proximas";

export default function AgendaScreen(_props: AgendaProps) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verHechas, setVerHechas] = useState(false);

  // form
  const [desc, setDesc] = useState("");
  const [fecha, setFecha] = useState(hoyStr());
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      setItems(await getAgenda(token, verHechas));
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar la agenda");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, verHechas]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const resetForm = () => { setDesc(""); setFecha(hoyStr()); setEditId(null); };

  const guardar = async () => {
    if (!token) return;
    const d = desc.trim();
    if (!d) { Alert.alert("Falta la tarea", "Escribí qué hay que hacer."); return; }
    if (!RE_FECHA.test(fecha)) { Alert.alert("Fecha inválida", "Usá el formato AAAA-MM-DD."); return; }
    setSaving(true);
    try {
      if (editId != null) {
        await editarAgenda(token, editId, { fecha, descripcion: d });
      } else {
        await crearAgenda(token, fecha, d);
      }
      resetForm();
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const empezarEdicion = (it: AgendaItem) => {
    setEditId(it.id);
    setDesc(it.descripcion);
    setFecha(it.fecha);
  };

  const toggleHecho = async (it: AgendaItem) => {
    if (!token) return;
    try {
      await editarAgenda(token, it.id, { hecho: !it.hecho });
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "No se pudo actualizar");
    }
  };

  const borrar = (it: AgendaItem) => {
    Alert.alert("Borrar tarea", `¿Borrar "${it.descripcion}"?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Borrar", style: "destructive",
        onPress: async () => {
          if (!token) return;
          try { await borrarAgenda(token, it.id); await load(); }
          catch (e: any) { Alert.alert("Error", e?.message || "No se pudo borrar"); }
        },
      },
    ]);
  };

  // Agrupar por vencidas / hoy / próximas (o mostrar hechas planas).
  const secciones = useMemo(() => {
    const hoy = hoyStr();
    if (verHechas) {
      return [{ grupo: "hechas" as const, titulo: "Hechas", data: items }];
    }
    const vencidas = items.filter((i) => i.fecha < hoy);
    const deHoy = items.filter((i) => i.fecha === hoy);
    const prox = items.filter((i) => i.fecha > hoy);
    const out: { grupo: Grupo; titulo: string; data: AgendaItem[] }[] = [];
    if (vencidas.length) out.push({ grupo: "vencidas", titulo: `Vencidas (${vencidas.length})`, data: vencidas });
    if (deHoy.length) out.push({ grupo: "hoy", titulo: "Hoy", data: deHoy });
    if (prox.length) out.push({ grupo: "proximas", titulo: "Próximas", data: prox });
    return out;
  }, [items, verHechas]);

  // Aplanar a filas con headers para un solo FlatList.
  type Fila = { tipo: "header"; key: string; titulo: string; grupo: string } | { tipo: "item"; key: string; it: AgendaItem; grupo: string };
  const filas: Fila[] = useMemo(() => {
    const out: Fila[] = [];
    for (const s of secciones) {
      out.push({ tipo: "header", key: `h-${s.grupo}`, titulo: s.titulo, grupo: s.grupo });
      for (const it of s.data) out.push({ tipo: "item", key: `i-${it.id}`, it, grupo: s.grupo });
    }
    return out;
  }, [secciones]);

  if (loading) return <Loader />;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        data={filas}
        keyExtractor={(f) => f.key}
        contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View>
            {/* Form de alta / edición */}
            <View style={styles.form}>
              <Text style={styles.formTitle}>{editId != null ? "Editar tarea" : "Nueva tarea"}</Text>
              <TextInput
                style={styles.input}
                placeholder="¿Qué hay que hacer?"
                placeholderTextColor={colors.textDim}
                value={desc}
                onChangeText={setDesc}
                multiline
              />
              <View style={styles.chipsRow}>
                {[
                  { l: "Hoy", v: hoyStr() },
                  { l: "Mañana", v: addDays(1) },
                  { l: "En 2 días", v: addDays(2) },
                  { l: "En 1 semana", v: addDays(7) },
                ].map((c) => (
                  <TouchableOpacity
                    key={c.l}
                    style={[styles.chip, fecha === c.v ? styles.chipActive : null]}
                    onPress={() => setFecha(c.v)}
                  >
                    <Text style={[styles.chipText, fecha === c.v ? styles.chipTextActive : null]}>{c.l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.fechaRow}>
                <Icon name="calendar" size={16} color={colors.textDim} />
                <TextInput
                  style={styles.fechaInput}
                  placeholder="AAAA-MM-DD"
                  placeholderTextColor={colors.textDim}
                  value={fecha}
                  onChangeText={setFecha}
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.formActions}>
                {editId != null ? (
                  <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={resetForm}>
                    <Text style={styles.btnGhostText}>Cancelar</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={[styles.btn, styles.btnPrimary, saving ? { opacity: 0.6 } : null]} onPress={guardar} disabled={saving}>
                  <Text style={styles.btnPrimaryText}>{editId != null ? "Guardar" : "Agregar"}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity style={styles.verHechas} onPress={() => setVerHechas((v) => !v)}>
              <Icon name={verHechas ? "list" : "check"} size={14} color={colors.textDim} />
              <Text style={styles.verHechasText}>{verHechas ? "Ver pendientes" : "Ver hechas"}</Text>
            </TouchableOpacity>

            {error ? <ErrorBox message={error} onRetry={load} /> : null}
          </View>
        }
        renderItem={({ item }) => {
          if (item.tipo === "header") {
            const c = item.grupo === "vencidas" ? colors.red : item.grupo === "hoy" ? colors.primary : colors.textDim;
            return <Text style={[styles.grupoTitulo, { color: c }]}>{item.titulo}</Text>;
          }
          const it = item.it;
          return (
            <SwipeRow
              left={{ icon: "trash", color: colors.red, onTrigger: () => borrar(it) }}
              right={
                it.hecho
                  ? { icon: "undo", color: colors.amber, onTrigger: () => toggleHecho(it) }
                  : { icon: "check", color: colors.green, onTrigger: () => toggleHecho(it) }
              }
            >
              <View style={styles.row}>
                <TouchableOpacity style={styles.checkBtn} onPress={() => toggleHecho(it)}>
                  <View style={[styles.check, it.hecho ? styles.checkOn : null]}>
                    {it.hecho ? <Icon name="check" size={13} color={colors.onPrimary} /> : null}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => empezarEdicion(it)}>
                  <Text style={[styles.rowDesc, it.hecho ? styles.rowDescDone : null]}>{it.descripcion}</Text>
                  <View style={styles.rowMeta}>
                    <Text style={styles.rowFecha}>{etiquetaFecha(it.fecha)}</Text>
                    {it.origen === "claude" ? <Text style={styles.origenChip}>Claude</Text> : null}
                  </View>
                </TouchableOpacity>
              </View>
            </SwipeRow>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>{verHechas ? "No hay tareas hechas." : "No tenés nada agendado. 🎉"}</Text>
        }
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  form: { backgroundColor: colors.card, borderRadius: 14, padding: 14, borderColor: colors.border, borderWidth: 1 },
  formTitle: { color: colors.text, fontSize: 15, fontWeight: "700", marginBottom: 10 },
  input: {
    backgroundColor: colors.bg, color: colors.text, borderRadius: 10, borderColor: colors.border, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, minHeight: 44,
  },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: colors.onPrimary },
  fechaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  fechaInput: {
    flex: 1, backgroundColor: colors.bg, color: colors.text, borderRadius: 10, borderColor: colors.border, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 14,
  },
  formActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  btn: { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: colors.onPrimary, fontWeight: "700", fontSize: 14 },
  btnGhost: { borderColor: colors.border, borderWidth: 1 },
  btnGhostText: { color: colors.textDim, fontWeight: "600", fontSize: 14 },
  verHechas: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-end", marginTop: 12, marginBottom: 4, paddingVertical: 4 },
  verHechasText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  grupoTitulo: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginTop: 16, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderRadius: 12, padding: 12, borderColor: colors.border, borderWidth: 1, gap: 12 },
  checkBtn: { padding: 2 },
  check: { width: 24, height: 24, borderRadius: 12, borderColor: colors.textDim, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  rowDesc: { color: colors.text, fontSize: 15, lineHeight: 20 },
  rowDescDone: { textDecorationLine: "line-through", color: colors.textDim },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  rowFecha: { color: colors.textDim, fontSize: 12, fontWeight: "600" },
  origenChip: {
    color: colors.primary, fontSize: 10, fontWeight: "700", borderColor: colors.primary, borderWidth: 1,
    borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1,
  },
  empty: { color: colors.textDim, textAlign: "center", marginTop: 30, fontSize: 14 },
});
