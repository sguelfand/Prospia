import React, { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AprendizajeEstado, CalidadSource, MensajeRow, RevisionCalidad, aprobarAprendizaje,
  confirmarRevision, consolidarAprendizajes, deleteRevision, descartarAprendizaje,
  getAprendizajes, getCalidadSources, getEtiguelMirrorMensajes, getPreferences,
  getRevisiones, putPreferences, reportarCalidadManual,
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
  const [apr, setApr] = useState<AprendizajeEstado | null>(null);
  const [verBloque, setVerBloque] = useState(false);
  const [aprBusy, setAprBusy] = useState(false);
  const [source, setSource] = useState("etiguel");
  const [sources, setSources] = useState<CalidadSource[]>([{ source: "etiguel", nombre: "Etiguel" }]);
  const [savedDefault, setSavedDefault] = useState("etiguel");
  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [nuevoTel, setNuevoTel] = useState("");
  const [nuevoTexto, setNuevoTexto] = useState("");
  const [nuevoBusy, setNuevoBusy] = useState(false);

  // Cliente inicial: el default guardado por el usuario (tilde) o Etiguel.
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const [srcs, prefs] = await Promise.all([
          getCalidadSources(token),
          getPreferences(token, "calidad"),
        ]);
        if (srcs.length) setSources(srcs);
        const def = (prefs.prefs as { default_source?: string })?.default_source;
        if (def && srcs.some((s) => s.source === def)) { setSavedDefault(def); setSource(def); }
      } catch { /* usa el fallback */ }
    })();
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [revs, aprE] = await Promise.all([getRevisiones(token, source), getAprendizajes(token, source)]);
      setRevisiones(revs);
      setApr(aprE);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, source]);

  const setDefault = async () => {
    if (!token) return;
    const nuevo = savedDefault === source ? "etiguel" : source;
    setSavedDefault(nuevo);
    try { await putPreferences(token, "calidad", { default_source: nuevo }); } catch { /* noop */ }
  };

  const crearRegistro = async () => {
    const texto = nuevoTexto.trim();
    if (!token || nuevoBusy || !texto) return;
    setNuevoBusy(true);
    try {
      await reportarCalidadManual(token, source, texto, nuevoTel.trim() || undefined);
      setNuevoOpen(false); setNuevoTel(""); setNuevoTexto("");
      await load();
      Alert.alert("Registrado ✓", "Lo sumé a la lista de Calidad (cuenta para las 5 lecciones).");
    } catch (e) {
      Alert.alert("No se pudo", e instanceof Error ? e.message : "Error");
    } finally {
      setNuevoBusy(false);
    }
  };

  const consolidar = async () => {
    if (!token) return;
    setAprBusy(true);
    try { await consolidarAprendizajes(token, source); await load(); } finally { setAprBusy(false); }
  };
  const aprobarApr = (id: number) => {
    Alert.alert("Enseñar a Camila", "¿Aplicar estos aprendizajes al prompt de Camila? Hay backup automático y es reversible.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Aplicar", onPress: async () => {
        if (!token) return;
        setAprBusy(true);
        try { await aprobarAprendizaje(token, id); setVerBloque(false); await load(); }
        catch (e) { Alert.alert("No se pudo", e instanceof Error ? e.message : "Error"); }
        finally { setAprBusy(false); }
      } },
    ]);
  };
  const descartarApr = async (id: number) => {
    if (!token) return;
    setAprBusy(true);
    try { await descartarAprendizaje(token, id); setVerBloque(false); await load(); } finally { setAprBusy(false); }
  };

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
          {r.origen === "sebi" && <Text style={styles.badgeReporte}>Reportado por vos</Text>}
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
      <Text style={styles.intro}>
        <Text style={{ fontWeight: "700", color: colors.text }}>Especialista Negocio</Text> marcó respuestas de Camila. Confirmá si estuvo bien o mal — así afina su criterio.
      </Text>

      {sources.length > 1 ? (
        <View style={styles.selectorWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillsRow}>
            {sources.map((s) => (
              <TouchableOpacity
                key={s.source}
                style={[styles.pill, source === s.source ? styles.pillActive : null]}
                onPress={() => setSource(s.source)}
              >
                <Text style={[styles.pillText, source === s.source ? styles.pillTextActive : null]}>{s.nombre}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.defaultToggle} onPress={setDefault} activeOpacity={0.7}>
            <Icon name="check" size={13} color={savedDefault === source ? colors.primary : colors.textDim} strokeWidth={2.5} />
            <Text style={[styles.defaultText, savedDefault === source ? { color: colors.primary } : null]}>Por defecto</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <TouchableOpacity style={styles.nuevoBtn} onPress={() => setNuevoOpen(true)} activeOpacity={0.8}>
        <Icon name="plus" size={15} color={colors.primary} strokeWidth={2.5} />
        <Text style={styles.nuevoBtnText}>Nuevo registro de calidad</Text>
      </TouchableOpacity>

      {apr ? (
        <View style={[styles.aprCard, apr.propuesta ? styles.aprCardProp : null]}>
          <View style={styles.aprHeader}>
            <Text style={styles.aprTitle}>🎓 Aprendizajes de Camila</Text>
            {apr.propuesta
              ? <Text style={styles.aprBadge}>Propuesta lista</Text>
              : <Text style={styles.meta}>{apr.pendientes}/{apr.umbral} lecciones</Text>}
          </View>
          {/* Progreso: cuántas modificaciones ya están cargadas de las {umbral} antes de pasarlas al código de Camila */}
          <View style={styles.progRow}>
            <View style={styles.progSegs}>
              {Array.from({ length: apr.umbral }).map((_, i) => (
                <View key={i} style={[styles.progSeg, i < apr.pendientes ? styles.progSegOn : null]} />
              ))}
            </View>
            <Text style={styles.progText}><Text style={{ fontWeight: "700", color: colors.text }}>{apr.pendientes} de {apr.umbral}</Text> modificaciones cargadas</Text>
          </View>
          {apr.propuesta ? (
            <>
              <Text style={styles.aprDesc}>Consolidé {apr.propuesta.n_lecciones} lección(es) en un bloque para el prompt de Camila.</Text>
              <TouchableOpacity onPress={() => setVerBloque((v) => !v)}>
                <Text style={styles.linkText}>{verBloque ? "Ocultar" : "Ver"} bloque propuesto</Text>
              </TouchableOpacity>
              {verBloque ? <Text style={styles.aprBloque}>{apr.propuesta.bloque_propuesto}</Text> : null}
              <View style={styles.aprActions}>
                <TouchableOpacity disabled={aprBusy} style={[styles.actionBtn, { borderColor: colors.green, flex: 1 }]} onPress={() => aprobarApr(apr.propuesta!.id)}>
                  <Text style={[styles.actionLabel, { color: colors.green }]}>Aprobar y enseñar</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={aprBusy} style={[styles.actionBtn, { borderColor: colors.border }]} onPress={() => descartarApr(apr.propuesta!.id)}>
                  <Text style={[styles.actionLabel, { color: colors.textDim }]}>Descartar</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.aprRow}>
              <Text style={styles.aprDesc}>
                {apr.pendientes === 0
                  ? "Cuando confirmes errores, se juntan acá para enseñárselos."
                  : `Al llegar a ${apr.umbral} (o cuando quieras) te propongo un bloque.`}
              </Text>
              <TouchableOpacity disabled={aprBusy || apr.pendientes === 0} style={[styles.actionBtn, { borderColor: colors.primary, opacity: apr.pendientes === 0 ? 0.4 : 1 }]} onPress={consolidar}>
                <Text style={[styles.actionLabel, { color: colors.primary }]}>Consolidar</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : null}

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

      {/* Modal: nuevo registro manual (teléfono + descripción) */}
      <Modal visible={nuevoOpen} transparent animationType="fade" onRequestClose={() => setNuevoOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nuevo registro de calidad</Text>
            <Text style={styles.modalSub}>
              Para {sources.find((s) => s.source === source)?.nombre ?? source}. Entra ya confirmado como "Camila estuvo mal" y suma para las {apr?.umbral ?? 5} lecciones.
            </Text>
            <Text style={styles.modalLabel}>Teléfono (opcional)</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Ej: 5491122334455"
              placeholderTextColor={colors.textDim}
              value={nuevoTel}
              onChangeText={setNuevoTel}
              keyboardType="phone-pad"
            />
            <Text style={styles.modalLabel}>¿Qué estuvo mal?</Text>
            <TextInput
              style={[styles.modalInput, styles.modalTextarea]}
              placeholder="Describí qué hizo mal Camila…"
              placeholderTextColor={colors.textDim}
              value={nuevoTexto}
              onChangeText={setNuevoTexto}
              multiline
              textAlignVertical="top"
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setNuevoOpen(false)} disabled={nuevoBusy}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalCrear, (!nuevoTexto.trim() || nuevoBusy) && styles.modalCrearOff]}
                onPress={crearRegistro}
                disabled={!nuevoTexto.trim() || nuevoBusy}
              >
                <Text style={styles.modalCrearText}>{nuevoBusy ? "Creando…" : "Crear"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  intro: { color: colors.textDim, fontSize: 12, paddingHorizontal: 12, paddingTop: 12 },

  selectorWrap: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 10, gap: 8 },
  pillsRow: { gap: 6, paddingRight: 6 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  pillActive: { borderColor: colors.primary, backgroundColor: colors.cardAlt },
  pillText: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  pillTextActive: { color: colors.text },
  defaultToggle: { flexDirection: "row", alignItems: "center", gap: 3 },
  defaultText: { color: colors.textDim, fontSize: 11, fontWeight: "700" },
  nuevoBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginHorizontal: 12, marginTop: 12, borderWidth: 1, borderColor: colors.primary, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8 },
  nuevoBtnText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  progRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  progSegs: { flexDirection: "row", gap: 4 },
  progSeg: { width: 22, height: 7, borderRadius: 999, backgroundColor: colors.border },
  progSegOn: { backgroundColor: colors.primary },
  progText: { color: colors.textDim, fontSize: 11 },
  modalBackdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "center", padding: 22 },
  modalCard: { backgroundColor: colors.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: colors.border },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: "800", marginBottom: 6 },
  modalSub: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  modalLabel: { color: colors.textDim, fontSize: 12, fontWeight: "700", marginBottom: 4 },
  modalInput: { backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 14, padding: 12, marginBottom: 12 },
  modalTextarea: { minHeight: 100 },
  modalBtns: { flexDirection: "row", justifyContent: "flex-end", gap: 10, alignItems: "center", marginTop: 2 },
  modalCancel: { paddingHorizontal: 14, paddingVertical: 9 },
  modalCancelText: { color: colors.textDim, fontSize: 14, fontWeight: "700" },
  modalCrear: { backgroundColor: colors.primary, borderRadius: 9, paddingHorizontal: 18, paddingVertical: 9, minWidth: 96, alignItems: "center" },
  modalCrearOff: { opacity: 0.5 },
  modalCrearText: { color: colors.onPrimary, fontSize: 14, fontWeight: "800" },

  aprCard: { marginHorizontal: 12, marginTop: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 12, padding: 12 },
  aprCardProp: { borderColor: colors.primary, backgroundColor: colors.cardAlt },
  aprHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  aprTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  aprBadge: { color: colors.primary, fontSize: 11, fontWeight: "700", borderColor: colors.primary, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  aprDesc: { color: colors.textDim, fontSize: 12, marginTop: 6, flex: 1 },
  aprBloque: { color: colors.text, fontSize: 11, fontFamily: "monospace", backgroundColor: colors.bg, borderRadius: 8, padding: 10, marginTop: 8 },
  aprActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  aprRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },

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
  badgeReporte: { color: colors.primary, fontSize: 11, fontWeight: "700", borderColor: colors.primary, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
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
