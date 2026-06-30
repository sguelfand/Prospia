import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AprendizajeEstado, AuditEstado, CalidadSource, MensajeRow, RevisionCalidad, aprobarAprendizaje,
  confirmarRevision, consolidarAprendizajes, correrAuditoriaPrompt, deleteRevision, descartarAprendizaje,
  getAprendizajes, getAprendizajesHistorial, getAuditoriaPrompt, getCalidadSources, getEtiguelMirrorMensajes, getPreferences,
  getRevisiones, putPreferences, reportarCalidadManual, type AprendizajeHist,
} from "../api";
import { useAuth } from "../auth";
import { pickImageBase64, type PickedImage } from "../imagePicker";
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

function fmtFechaCorta(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function fmtFechaHora(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const SEV_COLOR: Record<string, string> = {
  alta: colors.red,
  media: colors.amber,
  baja: colors.primary,
};

const HALLAZGO_META: Record<string, { emoji: string; label: string; color: string }> = {
  duplicacion: { emoji: "🔁", label: "Duplicación", color: colors.amber },
  contradiccion: { emoji: "⚠️", label: "Contradicción", color: colors.red },
  obsoleto: { emoji: "🗑️", label: "Obsoleto", color: colors.textDim },
  estructura: { emoji: "🧱", label: "Estructura", color: colors.blue },
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
  const [nuevoImg, setNuevoImg] = useState<PickedImage | null>(null);
  const [historial, setHistorial] = useState<AprendizajeHist[]>([]);
  const [verHistorial, setVerHistorial] = useState(false);
  const [histExpandida, setHistExpandida] = useState<number | null>(null);
  const [audit, setAudit] = useState<AuditEstado | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [verReporte, setVerReporte] = useState(false);

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
      const [revs, aprE, auditE] = await Promise.all([
        getRevisiones(token, source), getAprendizajes(token, source), getAuditoriaPrompt(token, source),
      ]);
      setRevisiones(revs);
      setApr(aprE);
      setAudit(auditE);
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

  const auditarPrompt = async () => {
    if (!token || auditBusy) return;
    setAuditBusy(true);
    try {
      const r = await correrAuditoriaPrompt(token, source);
      setAudit(r); setVerReporte(true);
    } catch (e) {
      Alert.alert("No se pudo", e instanceof Error ? e.message : "Error");
    } finally {
      setAuditBusy(false);
    }
  };

  const elegirImagenNuevo = async () => {
    try {
      const img = await pickImageBase64();
      if (img) setNuevoImg(img);
    } catch (e) {
      Alert.alert("No se pudo", e instanceof Error ? e.message : "Error");
    }
  };

  const crearRegistro = async () => {
    const texto = nuevoTexto.trim();
    if (!token || nuevoBusy || (!texto && !nuevoImg)) return;
    setNuevoBusy(true);
    try {
      await reportarCalidadManual(token, source, texto, nuevoTel.trim() || undefined,
        nuevoImg ? { b64: nuevoImg.b64, mime: nuevoImg.mime } : undefined);
      setNuevoOpen(false); setNuevoTel(""); setNuevoTexto(""); setNuevoImg(null);
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
        try {
          await aprobarAprendizaje(token, id); setVerBloque(false); await load();
          if (verHistorial) { try { setHistorial(await getAprendizajesHistorial(token, source)); } catch { /* noop */ } }
          Alert.alert("Listo ✓", "Le enseñé las mejoras a Camila. Quedó aplicado en su prompt.");
        }
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

  const toggleHistorial = async () => {
    const nuevo = !verHistorial;
    setVerHistorial(nuevo);
    if (nuevo && token) { try { setHistorial(await getAprendizajesHistorial(token, source)); } catch { /* noop */ } }
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
      <FlatList
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        data={visibles}
        keyExtractor={(r) => String(r.id)}
        ListEmptyComponent={<Text style={styles.empty}>{filtro === "nuevo" ? "Nada para revisar 🎉" : "Todavía no confirmaste ninguna."}</Text>}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        renderItem={({ item }) => (
          <SwipeRow
            left={{ icon: "x", color: colors.red, onTrigger: () => confirmarBorrar(item) }}
            right={{ icon: "x", color: colors.red, onTrigger: () => confirmarBorrar(item) }}
          >
            {renderCard(item)}
          </SwipeRow>
        )}
        ListHeaderComponent={
          <View>
            {error ? <ErrorBox message={error} onRetry={load} /> : null}
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
            <TouchableOpacity onPress={toggleHistorial}>
              <Text style={styles.linkText}>{verHistorial ? "Ocultar historial" : "Ver historial"}</Text>
            </TouchableOpacity>
          </View>

          {apr.propuesta ? (
            /* Paso 2: propuesta esperando aprobación */
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
                <Text style={styles.aprBadge}>Falta aprobar</Text>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: "700" }}>Propuesta: {apr.propuesta.n_lecciones} mejora(s)</Text>
              </View>
              <Text style={styles.aprDesc}>Todavía NO están en Camila. Para aplicarlas tocá "Aprobar y enseñar".</Text>
              <TouchableOpacity onPress={() => setVerBloque((v) => !v)}>
                <Text style={styles.linkText}>{verBloque ? "Ocultar" : "Ver"} qué se le va a enseñar</Text>
              </TouchableOpacity>
              {verBloque ? <Text style={styles.aprBloque}>{apr.propuesta.bloque_propuesto}</Text> : null}
              <View style={styles.aprActions}>
                <TouchableOpacity disabled={aprBusy} style={[styles.actionBtn, { borderColor: colors.green, flex: 1 }]} onPress={() => aprobarApr(apr.propuesta!.id)}>
                  <Text style={[styles.actionLabel, { color: colors.green }]}>{aprBusy ? "Aplicando…" : "Aprobar y enseñar"}</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={aprBusy} style={[styles.actionBtn, { borderColor: colors.border }]} onPress={() => descartarApr(apr.propuesta!.id)}>
                  <Text style={[styles.actionLabel, { color: colors.textDim }]}>Descartar</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            /* Paso 1: juntando lecciones */
            <>
              <View style={styles.progRow}>
                <View style={styles.progSegs}>
                  {Array.from({ length: apr.umbral }).map((_, i) => (
                    <View key={i} style={[styles.progSeg, i < Math.min(apr.pendientes, apr.umbral) ? styles.progSegOn : null]} />
                  ))}
                </View>
                <Text style={styles.progText}><Text style={{ fontWeight: "700", color: colors.text }}>{apr.pendientes} de {apr.umbral}</Text> para la próxima tanda</Text>
              </View>
              <View style={styles.aprRow}>
                <Text style={styles.aprDesc}>
                  {apr.pendientes === 0
                    ? "Cuando confirmes errores se juntan acá. Al llegar a 5 te armo la propuesta sola."
                    : `Al llegar a ${apr.umbral} te armo la propuesta sola. También podés consolidar ahora.`}
                </Text>
                <TouchableOpacity disabled={aprBusy || apr.pendientes === 0} style={[styles.actionBtn, { borderColor: colors.primary, opacity: apr.pendientes === 0 ? 0.4 : 1 }]} onPress={consolidar}>
                  <Text style={[styles.actionLabel, { color: colors.primary }]}>Consolidar</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {apr.ultima_aplicada?.aplicada_at ? (
            <Text style={styles.aprUltima}>✓ Última vez aplicado: {fmtFechaHora(apr.ultima_aplicada.aplicada_at)} · {apr.ultima_aplicada.n_lecciones} mejora(s)</Text>
          ) : null}

          {verHistorial ? (
            <View style={styles.histWrap}>
              {historial.length === 0 ? (
                <Text style={styles.aprDesc}>Todavía no se le enseñó nada a Camila.</Text>
              ) : historial.map((h) => (
                <View key={h.id} style={styles.histItem}>
                  <TouchableOpacity onPress={() => setHistExpandida((v) => v === h.id ? null : h.id)} style={styles.histHead}>
                    <Text style={styles.histFecha}>{h.aplicada_at ? fmtFechaHora(h.aplicada_at) : "—"}</Text>
                    <Text style={styles.meta}> · {h.n_lecciones} mejora(s)</Text>
                    <Text style={[styles.linkText, { marginLeft: "auto" }]}>{histExpandida === h.id ? "ocultar" : "ver reglas"}</Text>
                  </TouchableOpacity>
                  {histExpandida === h.id ? <Text style={styles.aprBloque}>{h.bloque}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {audit ? (
        <View style={[styles.aprCard, audit.recomendar ? styles.auditCardRec : null]}>
          <View style={styles.aprHeader}>
            <Text style={styles.aprTitle}>🧱 Auditoría del prompt</Text>
            <Text style={styles.meta}>{audit.ultima_at ? `última: ${fmtFechaHora(audit.ultima_at)}` : "nunca"}</Text>
          </View>
          <Text style={styles.aprDesc}>
            Revisa el prompt entero (duplicados, contradicciones, estructura) para que al sumar
            correcciones nada se pise. Se corre sola 1×/semana y te avisa solo si encuentra algo;
            también podés correrla ahora.
          </Text>
          {audit.recomendar ? <Text style={styles.auditRec}>Conviene re-auditar.</Text> : null}
          {audit.resumen ? <Text style={styles.aprDesc}>{audit.resumen}{audit.n_hallazgos ? ` · ${audit.n_hallazgos} hallazgo(s)` : ""}</Text> : null}
          <View style={styles.aprActions}>
            <TouchableOpacity disabled={auditBusy} style={[styles.actionBtn, { borderColor: colors.primary, flex: 1 }]} onPress={auditarPrompt}>
              {auditBusy ? <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 6 }} /> : null}
              <Text style={[styles.actionLabel, { color: colors.primary }]}>{auditBusy ? "Auditando el prompt…" : "Auditar ahora"}</Text>
            </TouchableOpacity>
            {(audit.hallazgos?.length || audit.reporte) ? (
              <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.border }]} onPress={() => setVerReporte((v) => !v)}>
                <Text style={[styles.actionLabel, { color: colors.textDim }]}>{verReporte ? "Ocultar" : "Ver reporte"}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {verReporte ? (
            audit.hallazgos?.length ? (
              <View style={{ marginTop: 8, gap: 8 }}>
                {audit.hallazgos.map((h, i) => {
                  const m = HALLAZGO_META[h.tipo] || { emoji: "•", label: h.tipo || "Hallazgo", color: colors.textDim };
                  return (
                    <View key={i} style={[styles.hallCard, { borderLeftColor: m.color }]}>
                      <Text style={[styles.hallTag, { color: m.color }]}>{m.emoji} {m.label.toUpperCase()}</Text>
                      <Text style={styles.hallDet}>{h.detalle}</Text>
                      {h.sugerencia ? <Text style={styles.hallSug}><Text style={{ fontWeight: "700" }}>Sugerencia: </Text>{h.sugerencia}</Text> : null}
                    </View>
                  );
                })}
              </View>
            ) : audit.reporte ? <Text style={styles.aprBloque}>{audit.reporte}</Text> : (
              <Text style={[styles.aprDesc, { color: colors.green }]}>✅ Sin problemas detectados.</Text>
            )
          ) : null}
        </View>
      ) : null}

      <View style={styles.tabs}>
        {tabs.map(([k, l]) => (
          <TouchableOpacity key={k} style={[styles.tab, filtro === k ? styles.tabActive : null]} onPress={() => setFiltro(k)}>
            <Text style={[styles.tabText, filtro === k ? styles.tabTextActive : null]} numberOfLines={1}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>
          </View>
        }
      />

      {/* Modal: nuevo registro manual (teléfono + descripción) */}
      <Modal visible={nuevoOpen} transparent animationType="slide" onRequestClose={() => setNuevoOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 18 }]}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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

              <Text style={styles.modalLabel}>Captura de la conversación (opcional)</Text>
              {nuevoImg ? (
                <View style={styles.imgRow}>
                  <Text style={styles.imgName} numberOfLines={1}>📎 {nuevoImg.nombre}</Text>
                  <TouchableOpacity onPress={() => setNuevoImg(null)} disabled={nuevoBusy}>
                    <Text style={styles.imgQuitar}>Quitar</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.imgBtn} onPress={elegirImagenNuevo} disabled={nuevoBusy} activeOpacity={0.8}>
                  <Icon name="plus" size={14} color={colors.primary} strokeWidth={2.5} />
                  <Text style={styles.imgBtnText}>Adjuntar imagen</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.imgHint}>Si adjuntás una captura, la IA la lee y suma la conversación a la lección (cuesta centavos).</Text>

              <View style={styles.modalBtns}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setNuevoOpen(false)} disabled={nuevoBusy}>
                  <Text style={styles.modalCancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalCrear, ((!nuevoTexto.trim() && !nuevoImg) || nuevoBusy) && styles.modalCrearOff]}
                  onPress={crearRegistro}
                  disabled={(!nuevoTexto.trim() && !nuevoImg) || nuevoBusy}
                >
                  {nuevoBusy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : (
                    <Text style={styles.modalCrearText}>{nuevoImg ? "Analizar y crear" : "Crear"}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
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
  content: { paddingBottom: 40 },
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
  modalBackdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, borderWidth: 1, borderColor: colors.border, maxHeight: "90%" },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: "800", marginBottom: 6 },
  modalSub: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  modalLabel: { color: colors.textDim, fontSize: 12, fontWeight: "700", marginBottom: 4 },
  modalInput: { backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 14, padding: 12, marginBottom: 12 },
  modalTextarea: { minHeight: 100 },
  imgBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", borderWidth: 1, borderColor: colors.primary, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 6 },
  imgBtnText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  imgRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  imgName: { color: colors.text, fontSize: 13, flex: 1 },
  imgQuitar: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  imgHint: { color: colors.textDim, fontSize: 11, marginBottom: 12 },
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
  auditCardRec: { borderColor: colors.amber },
  auditRec: { color: colors.amber, fontSize: 12, fontWeight: "700", marginTop: 4 },
  hallCard: { backgroundColor: colors.bg, borderRadius: 10, borderLeftWidth: 4, borderLeftColor: colors.border, padding: 12 },
  hallTag: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4, marginBottom: 4 },
  hallDet: { color: colors.text, fontSize: 13, lineHeight: 18 },
  hallSug: { color: colors.blue, fontSize: 12, marginTop: 6 },
  aprActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  aprRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  aprUltima: { color: colors.green, fontSize: 11, marginTop: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  histWrap: { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 8 },
  histItem: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 10, backgroundColor: colors.bg },
  histHead: { flexDirection: "row", alignItems: "center" },
  histFecha: { color: colors.text, fontSize: 12, fontWeight: "700" },

  tabs: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 8, gap: 8, marginTop: 4 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  tabActive: { backgroundColor: colors.cardAlt, borderColor: colors.primary },
  tabText: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  tabTextActive: { color: colors.text },

  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, marginHorizontal: 12, borderLeftColor: colors.amber, borderLeftWidth: 3 },
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
