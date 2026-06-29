import React, { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  MensajeRow, RevisionCalidad, confirmarRevision, deleteRevision,
  getEtiguelMirrorMensajes, getRevisiones,
} from "../api";
import { useAuth } from "../auth";
import { Icon, IconText } from "../components/Icon";
import { SwipeRow } from "../components/SwipeRow";
import { ErrorBox, Loader } from "../components/ui";
import { CalidadProps } from "../navigation";
import { colors } from "../theme";

type Filtro = "nuevo" | "revisado";

const CAT_LABEL: Record<string, string> = {
  lead_perdido: "Lead perdido",
  info_incorrecta: "Info incorrecta",
  oportunidad_venta: "Oportunidad de venta",
  tono: "Tono",
  derivacion: "Derivación",
  confuso: "Confuso",
  otro: "Otro",
};

const SEV_COLOR: Record<string, string> = {
  alta: colors.red,
  media: colors.amber,
  baja: colors.primary,
};

export default function CalidadScreen(_props: CalidadProps) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [revisiones, setRevisiones] = useState<RevisionCalidad[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("nuevo");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notas, setNotas] = useState<Record<number, string>>({});
  const [conv, setConv] = useState<Record<number, MensajeRow[] | "loading">>({});

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setRevisiones(await getRevisiones(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const confirmar = async (r: RevisionCalidad, veredicto: "acierto" | "falso_positivo") => {
    if (!token) return;
    const nota = notas[r.id]?.trim() || undefined;
    const snap = revisiones;
    setRevisiones((prev) => prev.map((x) => (x.id === r.id ? { ...x, estado: "revisado", veredicto, nota_sebi: nota ?? null } : x)));
    try {
      await confirmarRevision(token, r.id, veredicto, nota);
    } catch {
      setRevisiones(snap);
    }
  };

  const borrar = async (r: RevisionCalidad) => {
    if (!token) return;
    const snap = revisiones;
    setRevisiones((prev) => prev.filter((x) => x.id !== r.id));
    try {
      await deleteRevision(token, r.id);
    } catch {
      setRevisiones(snap);
    }
  };

  const confirmarBorrar = (r: RevisionCalidad) => {
    Alert.alert("Borrar revisión", "¿Seguro? No se puede deshacer.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Borrar", style: "destructive", onPress: () => borrar(r) },
    ]);
  };

  const toggleConv = async (r: RevisionCalidad) => {
    if (!token || r.mirror_id == null) return;
    if (conv[r.id]) { setConv((p) => { const n = { ...p }; delete n[r.id]; return n; }); return; }
    setConv((p) => ({ ...p, [r.id]: "loading" }));
    try {
      const msgs = await getEtiguelMirrorMensajes(token, r.mirror_id);
      setConv((p) => ({ ...p, [r.id]: msgs }));
    } catch {
      setConv((p) => { const n = { ...p }; delete n[r.id]; return n; });
    }
  };

  if (loading) return <Loader />;

  const visibles = revisiones.filter((r) => r.estado === filtro);
  const n = (s: Filtro) => revisiones.filter((r) => r.estado === s).length;
  const tabs: [Filtro, string][] = [
    ["nuevo", `Nuevas (${n("nuevo")})`],
    ["revisado", `Revisadas (${n("revisado")})`],
  ];

  const renderCard = (r: RevisionCalidad) => {
    const sevColor = SEV_COLOR[r.severidad] ?? colors.primary;
    const c = conv[r.id];
    return (
      <View style={[styles.card, { borderLeftColor: sevColor }, r.estado === "revisado" ? styles.cardDone : null]}>
        <View style={styles.headerRow}>
          <Text style={[styles.cat, { color: colors.amber }]}>{CAT_LABEL[r.categoria] || r.categoria}</Text>
          <Text style={styles.meta}>· {r.severidad}</Text>
          <Text style={styles.meta}>· {r.fecha}</Text>
          {r.estado === "revisado" && r.veredicto === "acierto" && <Text style={styles.badgeMal}>Camila mal</Text>}
          {r.estado === "revisado" && r.veredicto === "falso_positivo" && <Text style={styles.badgeBien}>Camila bien</Text>}
        </View>

        <Text style={styles.titulo}>{r.titulo}</Text>
        {!!r.detalle && <Text style={styles.detalle}>{r.detalle}</Text>}
        {!!r.fragmento && <Text style={styles.fragmento}>{r.fragmento}</Text>}
        {!!r.sugerencia && <Text style={styles.sugerencia}><Text style={{ fontWeight: "700" }}>Sugerencia: </Text>{r.sugerencia}</Text>}

        <View style={styles.metaRow}>
          {(r.nombre || r.telefono) ? <IconText name="phone" text={r.nombre || r.telefono || ""} /> : null}
          {r.mirror_id != null ? (
            <TouchableOpacity style={styles.linkBtn} onPress={() => toggleConv(r)}>
              <Icon name="message" size={13} color={colors.textDim} strokeWidth={2} />
              <Text style={styles.linkText}>{c ? "Ocultar" : "Ver"} conversación</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {c === "loading" ? <Text style={styles.meta}>Cargando…</Text> : null}
        {Array.isArray(c) ? (
          <View style={styles.convBox}>
            {c.map((m) => (
              <View key={m.id} style={[styles.bubble, m.direccion === "in" ? styles.bubbleIn : styles.bubbleOut]}>
                <Text style={styles.bubbleText}>{m.texto}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {r.estado === "nuevo" ? (
          <View style={styles.actionsWrap}>
            <TextInput
              value={notas[r.id] || ""}
              onChangeText={(t) => setNotas((p) => ({ ...p, [r.id]: t }))}
              placeholder="Nota opcional (por qué) — ayuda a que aprenda"
              placeholderTextColor={colors.textDim}
              style={styles.notaInput}
            />
            <View style={styles.actionsRow}>
              <ActionBtn icon="flag" label="Camila mal (acertaste)" color={colors.red} onPress={() => confirmar(r, "acierto")} />
              <ActionBtn icon="check" label="Camila bien (erraste)" color={colors.green} onPress={() => confirmar(r, "falso_positivo")} />
            </View>
          </View>
        ) : (
          !!r.nota_sebi && <Text style={styles.notaSebi}>"{r.nota_sebi}"</Text>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {tabs.map(([k, l]) => (
          <TouchableOpacity key={k} style={[styles.tab, filtro === k ? styles.tabActive : null]} onPress={() => setFiltro(k)}>
            <Text style={[styles.tabText, filtro === k ? styles.tabTextActive : null]} numberOfLines={1}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        data={visibles}
        keyExtractor={(r) => String(r.id)}
        ListHeaderComponent={error ? <ErrorBox message={error} onRetry={load} /> : null}
        ListEmptyComponent={<Text style={styles.empty}>{filtro === "nuevo" ? "Nada para revisar 🎉" : "Todavía no confirmaste ninguna."}</Text>}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        renderItem={({ item }) =>
          item.estado === "revisado" ? (
            <SwipeRow
              left={{ icon: "x", color: colors.red, onTrigger: () => confirmarBorrar(item) }}
              right={{ icon: "x", color: colors.red, onTrigger: () => confirmarBorrar(item) }}
            >
              {renderCard(item)}
            </SwipeRow>
          ) : (
            renderCard(item)
          )
        }
      />
    </View>
  );
}

function ActionBtn({ icon, label, color, onPress }: { icon: "flag" | "check"; label: string; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.actionBtn, { borderColor: color }]} onPress={onPress} activeOpacity={0.7}>
      <Icon name={icon} size={14} color={color} strokeWidth={2} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
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

  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, borderLeftColor: colors.amber, borderLeftWidth: 3 },
  cardDone: { opacity: 0.7 },
  headerRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4, marginBottom: 6 },
  cat: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  meta: { color: colors.textDim, fontSize: 11 },
  badgeMal: { marginLeft: "auto", color: colors.red, fontSize: 11, fontWeight: "700", borderColor: colors.red, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeBien: { marginLeft: "auto", color: colors.green, fontSize: 11, fontWeight: "700", borderColor: colors.green, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  titulo: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 3 },
  detalle: { color: colors.text, fontSize: 13, marginBottom: 6 },
  fragmento: { color: colors.textDim, fontSize: 12, fontStyle: "italic", borderLeftColor: colors.border, borderLeftWidth: 2, paddingLeft: 10, marginBottom: 6 },
  sugerencia: { color: colors.primary, fontSize: 12, marginBottom: 4 },

  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14, marginTop: 4 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  linkText: { color: colors.textDim, fontSize: 12 },

  convBox: { marginTop: 10, gap: 6, maxHeight: 280, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 10 },
  bubble: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, maxWidth: "85%" },
  bubbleIn: { backgroundColor: colors.cardAlt, alignSelf: "flex-start" },
  bubbleOut: { backgroundColor: colors.amber + "26", alignSelf: "flex-end" },
  bubbleText: { color: colors.text, fontSize: 12 },

  actionsWrap: { marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  notaInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, color: colors.text, fontSize: 12, marginBottom: 8 },
  actionsRow: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderWidth: 1, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 9 },
  actionLabel: { fontSize: 12, fontWeight: "700" },
  notaSebi: { color: colors.textDim, fontSize: 12, fontStyle: "italic", marginTop: 8 },
});
