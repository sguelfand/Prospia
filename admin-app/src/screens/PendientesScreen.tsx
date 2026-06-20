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

import { Area, ColaEstado, Pendiente, PendienteRich, Prioridad, borrarPendiente, crearPendiente, editarPendiente, encolarPendientes, getPendientes } from "../api";
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

const COLA_LABEL: Record<NonNullable<ColaEstado>, string> = {
  pendiente: "En cola",
  procesado: "Realizado · sin confirmar",
  standby: "En espera · falta info",
};
const YELLOW = "#EBC944"; // standby = en espera de info (amarillo)
const colaColor: Record<NonNullable<ColaEstado>, string> = {
  pendiente: colors.blue,
  procesado: colors.amber,
  standby: YELLOW,
};

export default function PendientesScreen(_props: PendientesProps) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Pendiente[]>([]);
  const [filtro, setFiltro] = useState<"pendientes" | "realizados">("pendientes");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Pendiente | null>(null);
  // Cuando rechazo un procesado: al guardar el modal vuelve a cola_estado='pendiente'.
  const [requeueId, setRequeueId] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [procesando, setProcesando] = useState(false);

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

  // Mientras haya algo `pendiente` en la cola (y no estoy seleccionando), refresca solo
  // cada 10s para que los círculos se vayan llenando a medida que se marcan `procesado`.
  const hayPendiente = items.some((p) => p.cola_estado === "pendiente" && !p.hecho);
  useEffect(() => {
    if (!hayPendiente || selectMode || !token) return;
    const t = setInterval(() => {
      getPendientes(token, true).then(setItems).catch(() => {});
    }, 10000);
    return () => clearInterval(t);
  }, [hayPendiente, selectMode, token]);

  const setHecho = async (p: Pendiente, hecho: boolean) => {
    if (!token) return;
    setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, hecho } : x)));
    try {
      await editarPendiente(token, p.id, { hecho });
    } catch {
      load();
    }
  };

  // Reactivar un standby: vuelve a 'pendiente' al instante (Sebi ya pasó la info).
  const reactivar = async (p: Pendiente) => {
    if (!token) return;
    setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, cola_estado: "pendiente" } : x)));
    try {
      const upd = await editarPendiente(token, p.id, { cola_estado: "pendiente" });
      setItems((prev) => prev.map((x) => (x.id === upd.id ? upd : x)));
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

  const guardar = async (texto: string, prioridad: Prioridad, area: Area, rich: Partial<PendienteRich>) => {
    if (!token) return;
    if (editing) {
      // Si lo estoy rechazando, lo SACO de la cola (cola_estado vacío → nulo):
      // vuelve a ser un pendiente normal abajo, como si nunca lo hubiera procesado,
      // sin afectar a los demás del recuadro de confirmación.
      const rechazando = requeueId === editing.id;
      const upd = await editarPendiente(token, editing.id, {
        texto, prioridad, area, ...rich,
        ...(rechazando ? { cola_estado: "" as const } : {}),
      });
      setItems((prev) => prev.map((p) => (p.id === upd.id ? upd : p)));
      setRequeueId(null);
    } else {
      const nuevo = await crearPendiente(token, texto, prioridad, area, rich);
      setItems((prev) => [nuevo, ...prev]);
      setFiltro("pendientes");
    }
  };

  const abrirNuevo = () => { setEditing(null); setRequeueId(null); setFormOpen(true); };
  const abrirEditar = (p: Pendiente) => { setEditing(p); setRequeueId(null); setFormOpen(true); };
  // Rechazar un procesado: abre el modal para que escriba qué ve; al guardar vuelve a 'pendiente'.
  const rechazar = (p: Pendiente) => { setEditing(p); setRequeueId(p.id); setFormOpen(true); };

  const salirSeleccion = () => { setSelectMode(false); setSelected(new Set()); };
  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const procesar = async () => {
    if (!token || selected.size === 0 || procesando) return;
    const ids = [...selected];
    setProcesando(true);
    try {
      const cola = await encolarPendientes(token, ids);
      const byId = new Map(cola.map((c) => [c.id, c]));
      setItems((prev) => prev.map((p) => byId.get(p.id) ?? p));
      salirSeleccion();
      Alert.alert("A la cola", `${ids.length === 1 ? "1 pendiente" : ids.length + " pendientes"} en la cola de procesamiento.`);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "No se pudo procesar.");
    } finally {
      setProcesando(false);
    }
  };

  const renderRow = (item: Pendiente) => (
    <SwipeRow
      left={
        item.hecho
          ? { icon: "undo", color: colors.amber, onTrigger: () => setHecho(item, false) }
          : { icon: "check", color: colors.green, onTrigger: () => setHecho(item, true) }
      }
      right={{ icon: "x", color: colors.red, onTrigger: () => confirmarBorrar(item) }}
    >
      <PendienteCard item={item} onPress={() => abrirEditar(item)} />
    </SwipeRow>
  );

  if (loading) return <Loader />;

  // En cola activa = encolado y todavía no confirmado como hecho. Va al tray de arriba.
  const enCola = (p: Pendiente) => !!p.cola_estado && !p.hecho;
  // Orden: procesando arriba → terminados → en espera (standby) al fondo.
  const COLA_ORDER: Record<NonNullable<ColaEstado>, number> = { pendiente: 0, procesado: 1, standby: 2 };
  const queued = items
    .filter(enCola)
    .sort((a, b) => (COLA_ORDER[a.cola_estado!] ?? 9) - (COLA_ORDER[b.cola_estado!] ?? 9) || b.id - a.id);
  const colaDone = queued.filter((p) => p.cola_estado === "procesado").length;
  const colaPend = queued.filter((p) => p.cola_estado === "pendiente").length;
  const colaStandby = queued.filter((p) => p.cola_estado === "standby").length;
  const colaPct = queued.length ? Math.round((colaDone / queued.length) * 100) : 0;
  const colaSettled = queued.length > 0 && colaPend === 0; // ya no queda nada procesándose
  const colaAllDone = colaSettled && colaStandby === 0;     // todo terminado → verde
  const colaWaiting = colaSettled && colaStandby > 0;       // terminé lo que pude, faltan datos tuyos
  const mostrarCola = !selectMode && filtro === "pendientes" && queued.length > 0;

  const visibles = items.filter((p) => (filtro === "pendientes" ? !p.hecho : p.hecho) && !enCola(p));
  const nPend = items.filter((p) => !p.hecho).length;
  const nReal = items.length - nPend;

  const colaHeader = mostrarCola ? (
    <View style={[styles.colaBox, colaAllDone && styles.colaBoxDone, colaWaiting && styles.colaBoxWaiting]}>
      <View style={styles.colaBoxHead}>
        {colaAllDone ? (
          <View style={styles.colaCheckHead}>
            <Icon name="check" size={11} color={colors.bg} />
          </View>
        ) : colaWaiting ? (
          <View style={styles.colaWaitHead}>
            <Icon name="clock" size={11} color={colors.bg} />
          </View>
        ) : colaPend > 0 ? (
          <ActivityIndicator size="small" color={colors.blue} />
        ) : null}
        <Text style={styles.colaBoxTitle}>
          {colaAllDone
            ? queued.length === 1 ? "Listo, terminé 1" : `Listo, terminé los ${queued.length}`
            : colaWaiting ? "Terminé los que pude" : "Procesando"}
        </Text>
        <Text style={[styles.colaBoxCount, colaAllDone && styles.colaBoxCountDone, colaWaiting && styles.colaBoxCountWaiting]}>{colaDone}/{queued.length}</Text>
        <View style={[styles.colaBoxBar, colaAllDone && styles.colaBoxBarDone, colaWaiting && styles.colaBoxBarWaiting]}>
          <View style={[styles.colaBoxBarFill, colaAllDone && styles.colaBoxBarFillDone, colaWaiting && styles.colaBoxBarFillWaiting, { width: `${colaPct}%` }]} />
        </View>
      </View>
      {colaAllDone && <Text style={styles.colaBoxHint}>Revisá y confirmá cada uno para pasarlo a Realizados.</Text>}
      {colaWaiting && (
        <Text style={styles.colaBoxHint}>
          {colaStandby === 1 ? "1 espera" : `${colaStandby} esperan`} tu info para seguir. Confirmá los que ya están listos.
        </Text>
      )}
      {queued.map((q) => (
        <View key={q.id}>
          {colaSettled ? (
            <PendienteCard item={q} onPress={() => abrirEditar(q)} />
          ) : (
            renderRow(q)
          )}
          {colaSettled && q.cola_estado === "procesado" && (
            <View style={styles.colaActions}>
              <TouchableOpacity style={[styles.colaConfirmBtn, styles.colaActionFlex]} onPress={() => setHecho(q, true)} activeOpacity={0.8}>
                <Icon name="check" size={15} color={colors.green} />
                <Text style={styles.colaConfirmText}>Confirmar realizado</Text>
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
        <Tab label={`Pendientes (${nPend})`} active={filtro === "pendientes"} onPress={() => setFiltro("pendientes")} />
        <Tab label={`Realizados (${nReal})`} active={filtro === "realizados"} onPress={() => setFiltro("realizados")} />
      </View>

      {selectMode ? (
        <View style={styles.selHeader}>
          <Text style={styles.selHeaderText}>Tildá los que querés procesar</Text>
          <TouchableOpacity onPress={salirSeleccion}>
            <Text style={styles.selHeaderCancel}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.topActions}>
          <TouchableOpacity style={styles.addBtn} onPress={abrirNuevo}>
            <Icon name="plus" size={18} color="#fff" />
            <Text style={styles.addBtnText}>Nuevo pendiente</Text>
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
        keyExtractor={(p) => String(p.id)}
        ListHeaderComponent={
          <>
            {error ? <ErrorBox message={error} onRetry={load} /> : null}
            {colaHeader}
          </>
        }
        ListEmptyComponent={
          mostrarCola ? null : (
            <Text style={styles.empty}>{filtro === "pendientes" ? "Sin pendientes 🎉" : "Nada realizado todavía."}</Text>
          )
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
        renderItem={({ item }) => {
          if (selectMode) {
            return (
              <PendienteCard
                item={item}
                selectMode
                selected={selected.has(item.id)}
                onPress={() => toggleSelect(item.id)}
              />
            );
          }
          return renderRow(item);
        }}
      />

      {selectMode && (
        <View style={[styles.procBar, { paddingBottom: insets.bottom + 12 }]}>
          <Text style={styles.procCount}>
            {selected.size === 1 ? "1 seleccionado" : `${selected.size} seleccionados`}
          </Text>
          <TouchableOpacity
            style={[styles.procBtn, selected.size === 0 ? styles.procBtnOff : null]}
            onPress={procesar}
            disabled={selected.size === 0 || procesando}
          >
            <Text style={styles.procBtnText}>{procesando ? "Procesando…" : "Procesar"}</Text>
          </TouchableOpacity>
        </View>
      )}

      <FormModal visible={formOpen} initial={editing} onClose={() => { setFormOpen(false); setRequeueId(null); }} onSubmit={guardar} rejecting={requeueId != null} />
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

const RICH_LABELS: Record<keyof PendienteRich, string> = {
  contexto: "Contexto / Por qué",
  que_armar: "Qué hay que armar",
  consideraciones: "Consideraciones / Riesgos",
  depende: "Depende de",
  alcance: "Alcance a futuro",
};
const RICH_ORDER: (keyof PendienteRich)[] = ["contexto", "que_armar", "consideraciones", "depende", "alcance"];
const RICH_LISTS: (keyof PendienteRich)[] = ["que_armar", "consideraciones", "depende"];

function RichSection({ campo, valor }: { campo: keyof PendienteRich; valor: string }) {
  const lines = valor.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{RICH_LABELS[campo]}</Text>
      {RICH_LISTS.includes(campo) ? (
        lines.map((l, i) => (
          <View key={i} style={styles.bulletRow}>
            <Text style={styles.bullet}>›</Text>
            <Text style={styles.sectionText}>{l}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.sectionText}>{valor}</Text>
      )}
    </View>
  );
}

function ColaDot({ estado }: { estado: NonNullable<ColaEstado> }) {
  if (estado === "procesado") {
    return (
      <View style={[styles.colaDot, styles.colaDotDone]}>
        <Icon name="check" size={11} color={colors.bg} />
      </View>
    );
  }
  if (estado === "standby") {
    return (
      <View style={[styles.colaDot, styles.colaDotStandby]}>
        <View style={styles.colaDotStandbyInner} />
      </View>
    );
  }
  // pendiente = spinner girando (procesándose), no un círculo vacío
  return <ActivityIndicator size="small" color={colors.blue} style={styles.colaDotSpin} />;
}

function PendienteCard({
  item,
  onPress,
  selectMode = false,
  selected = false,
}: {
  item: Pendiente;
  onPress: () => void;
  selectMode?: boolean;
  selected?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const richCampos = RICH_ORDER.filter((k) => item[k]);
  const tieneDetalle = richCampos.length > 0;
  const cola = item.cola_estado;
  return (
    <View style={[styles.card, selected ? styles.cardSelected : null]}>
      <TouchableOpacity style={styles.cardBodyRow} onPress={onPress} activeOpacity={0.7}>
        {selectMode && (
          <View style={[styles.selBox, selected ? styles.selBoxOn : null]}>
            {selected && <Icon name="check" size={13} color="#fff" />}
          </View>
        )}
        {!selectMode && cola && <ColaDot estado={cola} />}
        <View style={styles.cardBody}>
          <Text style={styles.texto}><Text style={styles.idTag}>#{item.id}</Text>  {item.texto}</Text>
          <View style={styles.badges}>
            <Text style={[styles.badge, { color: prioColor[item.prioridad], borderColor: prioColor[item.prioridad] }]}>
              {item.prioridad}
            </Text>
            <Text style={[styles.badge, { color: areaColor[item.area], borderColor: areaColor[item.area] }]}>
              {item.area}
            </Text>
            {cola && (
              <Text style={[styles.badge, { color: colaColor[cola], borderColor: colaColor[cola] }]}>
                {COLA_LABEL[cola]}
              </Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
      {!selectMode && tieneDetalle && (
        <>
          <TouchableOpacity style={styles.detalleToggle} onPress={() => setExpanded((v) => !v)} activeOpacity={0.7}>
            <Text style={styles.detalleToggleText}>{expanded ? "Ocultar detalle ▾" : "Ver detalle ▸"}</Text>
          </TouchableOpacity>
          {expanded && (
            <View style={styles.detalle}>
              {richCampos.map((k) => (
                <RichSection key={k} campo={k} valor={item[k] as string} />
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

function FormModal({
  visible,
  initial,
  onClose,
  onSubmit,
  rejecting = false,
}: {
  visible: boolean;
  initial?: Pendiente | null;
  onClose: () => void;
  onSubmit: (texto: string, prioridad: Prioridad, area: Area, rich: Partial<PendienteRich>) => Promise<void>;
  rejecting?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [prioridad, setPrioridad] = useState<Prioridad>("media");
  const [area, setArea] = useState<Area>("app");
  const [rich, setRich] = useState<Record<keyof PendienteRich, string>>({
    contexto: "", que_armar: "", consideraciones: "", depende: "", alcance: "",
  });
  const [mostrarDetalle, setMostrarDetalle] = useState(false);
  const [saving, setSaving] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      setTexto(initial?.texto ?? "");
      setPrioridad(initial?.prioridad ?? "media");
      setArea(initial?.area ?? "app");
      const r = {
        contexto: initial?.contexto ?? "", que_armar: initial?.que_armar ?? "",
        consideraciones: initial?.consideraciones ?? "", depende: initial?.depende ?? "",
        alcance: initial?.alcance ?? "",
      };
      setRich(r);
      setMostrarDetalle(RICH_ORDER.some((k) => r[k]));
    }
  }, [visible, initial]);

  const guardar = async () => {
    if (!texto.trim() || saving) return;
    setSaving(true);
    try {
      // mandamos los campos ricos siempre (vacío → el backend lo guarda como NULL)
      await onSubmit(texto.trim(), prioridad, area, rich);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 18 }]}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetTitle}>{rejecting ? "Rechazar y reabrir" : initial ? "Editar pendiente" : "Nuevo pendiente"}</Text>
            {rejecting ? (
              <Text style={styles.rejectHint}>Escribí qué viste / qué falta. Al guardar sale del recuadro y vuelve abajo como pendiente normal.</Text>
            ) : null}
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

            <TouchableOpacity style={styles.detalleToggle} onPress={() => setMostrarDetalle((v) => !v)} activeOpacity={0.7}>
              <Text style={styles.detalleToggleText}>{mostrarDetalle ? "Ocultar detalle ▾" : "Agregar detalle (contexto, pasos…) ▸"}</Text>
            </TouchableOpacity>

            {mostrarDetalle &&
              RICH_ORDER.map((campo) => (
                <View key={campo}>
                  <Text style={styles.label}>{RICH_LABELS[campo]}{RICH_LISTS.includes(campo) ? " (una línea por punto)" : ""}</Text>
                  <TextInput
                    style={[styles.input, styles.inputRich]}
                    placeholder="Opcional"
                    placeholderTextColor={colors.textDim}
                    value={rich[campo]}
                    onChangeText={(t) => setRich((prev) => ({ ...prev, [campo]: t }))}
                    multiline
                  />
                </View>
              ))}

            <View style={styles.actions}>
              <TouchableOpacity style={styles.btnCancel} onPress={onClose}>
                <Text style={styles.btnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnSave, !texto.trim() ? styles.btnSaveOff : null]} onPress={guardar} disabled={!texto.trim() || saving}>
                <Text style={styles.btnSaveText}>{saving ? "Guardando…" : rejecting ? "Rechazar" : "Guardar"}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
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

  topActions: { flexDirection: "row", alignItems: "center", gap: 8, margin: 12, marginBottom: 4 },
  addBtn: { flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  addBtnText: { color: "#fff", fontSize: 15, fontWeight: "700", marginLeft: 6 },
  selBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14 },
  selBtnText: { color: colors.primary, fontSize: 13, fontWeight: "700" },

  selHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 12, marginTop: 12, marginBottom: 4 },
  selHeaderText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  selHeaderCancel: { color: colors.primary, fontSize: 13, fontWeight: "700" },

  procBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.cardAlt, borderTopWidth: 1, borderTopColor: colors.border },
  procCount: { color: colors.text, fontSize: 14, fontWeight: "700" },
  procBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 22 },
  procBtnOff: { opacity: 0.5 },
  procBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  colaBox: { backgroundColor: "rgba(110,150,230,0.08)", borderWidth: 1, borderColor: "rgba(110,150,230,0.38)", borderRadius: 14, padding: 10, paddingBottom: 2, marginBottom: 16 },
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
  colaActionFlex: { flex: 1, marginTop: 0, marginBottom: 0 },
  colaConfirmBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.green, borderRadius: 9, paddingVertical: 9, marginTop: -2, marginBottom: 10 },
  colaConfirmText: { color: colors.green, fontSize: 13, fontWeight: "700" },
  colaRejectBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.red, borderRadius: 9, paddingVertical: 9 },
  colaReactivarBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.blue, borderRadius: 9, paddingVertical: 9, marginTop: -2, marginBottom: 10 },
  colaReactivarText: { color: colors.blue, fontSize: 13, fontWeight: "700" },
  colaRejectText: { color: colors.red, fontSize: 13, fontWeight: "700" },
  rejectHint: { color: colors.textDim, fontSize: 12, marginBottom: 10, marginTop: -6 },
  colaDot: { width: 19, height: 19, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 1 },
  colaDotSpin: { width: 19, height: 19, marginTop: 1 },
  colaDotDone: { borderColor: colors.amber, backgroundColor: colors.amber },
  colaDotStandby: { borderColor: YELLOW, backgroundColor: "transparent" },
  colaDotStandbyInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: YELLOW },

  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10 },
  cardSelected: { borderWidth: 1, borderColor: colors.primary },
  cardBodyRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  cardBody: { flex: 1 },
  selBox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center", marginTop: 1 },
  selBoxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  texto: { color: colors.text, fontSize: 14 },
  idTag: { color: colors.textDim, fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
  badges: { flexDirection: "row", gap: 8, marginTop: 8 },
  badge: { fontSize: 11, fontWeight: "700", borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden", textTransform: "capitalize" },

  detalleToggle: { marginTop: 12, paddingVertical: 4 },
  detalleToggleText: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  detalle: { marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  section: { marginBottom: 12 },
  sectionTitle: { color: colors.textDim, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 },
  sectionText: { color: colors.text, fontSize: 13, lineHeight: 19, flex: 1 },
  bulletRow: { flexDirection: "row", marginBottom: 4 },
  bullet: { color: colors.primary, fontSize: 13, fontWeight: "700", width: 16 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: "90%" },
  inputRich: { minHeight: 44 },
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
