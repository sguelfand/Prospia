import React, { useCallback, useEffect, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Aviso, eliminarAvisos, getAvisos } from "../api";
import { useAuth } from "../auth";
import { ErrorBox, Loader } from "../components/ui";
import { AvisosProps } from "../navigation";
import { Icon, IconName } from "../components/Icon";
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
  return { name: "bell", color: colors.textDim };
}

export default function AvisosScreen({ navigation }: AvisosProps) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

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
    if (a.tenant_id != null) {
      navigation.navigate("ClienteView", { tenantId: a.tenant_id, nombre: a.cliente ?? "Cliente", fuente: "plataforma" });
    }
  };

  if (loading) return <Loader />;

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
});
