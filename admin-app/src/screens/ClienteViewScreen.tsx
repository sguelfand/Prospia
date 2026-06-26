import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  DashboardStats,
  ETIGUEL_TENANT_ID,
  EtiguelMirrorItem,
  FiltrosCliente,
  ProspectRow,
  ProspectsFiltro,
  getClienteStats,
  getEtiguelMirror,
  getFiltrosCliente,
  getProspectsCliente,
  getPushPref,
  resetNumeroPrueba,
  setPushPref,
} from "../api";
import { useAuth } from "../auth";
import { Icon, IconText } from "../components/Icon";
import { Bar, ErrorBox, KpiCard, Loader, Section } from "../components/ui";
import { ClienteViewProps } from "../navigation";
import { getExpoTokenAsync } from "../push";
import { colors, estadoColor, estadoLabel } from "../theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PAGE_SIZE = 50;

export default function ClienteViewScreen({ route, navigation }: ClienteViewProps) {
  const { tenantId, nombre, filtroInicial } = route.params;
  const insets = useSafeAreaInsets();
  const esEtiguel = tenantId === ETIGUEL_TENANT_ID;
  const { token } = useAuth();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [mirror, setMirror] = useState<EtiguelMirrorItem[]>([]);
  const [expandLeads, setExpandLeads] = useState(true);
  const [expandProspects, setExpandProspects] = useState(true);
  const [filtrosOpts, setFiltrosOpts] = useState<FiltrosCliente | null>(null);
  const [filtro, setFiltro] = useState<ProspectsFiltro>(filtroInicial ?? {});
  const [prospects, setProspects] = useState<ProspectRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtroVisible, setFiltroVisible] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: nombre });
  }, [navigation, nombre]);

  // Carga de prospects (página 1 con el filtro actual).
  const loadProspects = useCallback(
    async (f: ProspectsFiltro) => {
      if (!token || esEtiguel) return;
      const res = await getProspectsCliente(token, tenantId, f, 1, PAGE_SIZE);
      setProspects(res.items);
      setTotal(res.total);
      setPage(1);
    },
    [token, tenantId, esEtiguel],
  );

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [s] = await Promise.all([
        getClienteStats(token, tenantId),
        (async () => {
          if (esEtiguel) {
            setMirror(await getEtiguelMirror(token));
          } else {
            const [f] = await Promise.all([
              getFiltrosCliente(token, tenantId),
              loadProspects(filtro),
            ]);
            setFiltrosOpts(f);
          }
        })(),
      ]);
      setStats(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar el cliente.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, tenantId, esEtiguel, filtro, loadProspects]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Recargar al volver del detalle (ej. tras Bloquear/Desbloquear un lead) para
  // que el badge "Bloqueado" del listado quede al día sin pull-to-refresh.
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => { load(); });
    return unsub;
  }, [navigation, load]);

  const aplicarFiltro = async (f: ProspectsFiltro) => {
    setFiltro(f);
    setFiltroVisible(false);
    try {
      await loadProspects(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al filtrar.");
    }
  };

  const cargarMas = async () => {
    if (!token || esEtiguel || loadingMore || prospects.length >= total) return;
    setLoadingMore(true);
    try {
      const res = await getProspectsCliente(token, tenantId, filtro, page + 1, PAGE_SIZE);
      setProspects((prev) => [...prev, ...res.items]);
      setPage(page + 1);
    } catch {
      // silencioso: el pull-to-refresh recarga
    } finally {
      setLoadingMore(false);
    }
  };

  const filtrosActivos = contarFiltros(filtro);

  if (loading) return <Loader />;
  if (error && !stats) return <ErrorBox message={error} onRetry={load} />;
  if (!stats) return null;

  const maxEstado = Math.max(1, ...stats.por_estado.map((e) => e.count));

  // Etiguel: espejo separado en leads / prospects (backend ya los manda por más reciente).
  const mirrorLeads = mirror.filter((m) => m.tipo === "lead");
  const mirrorProspects = mirror.filter((m) => m.tipo === "prospect");

  // Inicializar prueba: borra todo rastro de un número de prueba para este cliente
  // (app + memoria del bot si está conectado). Usa el número de prueba estándar;
  // para otro número, está el campo editable en la web (AdminClientes).
  const TELEFONO_PRUEBA = "+5491123146373";
  async function inicializarPrueba() {
    if (!token) return;
    Alert.alert(
      "Inicializar prueba",
      `Borra todo rastro del número ${TELEFONO_PRUEBA} para ${nombre} (app + memoria del bot si está conectado).`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Borrar",
          style: "destructive",
          onPress: async () => {
            try {
              const r = await resetNumeroPrueba(token, tenantId, TELEFONO_PRUEBA);
              const db = r.db_borrado || {};
              const prospects = db.prospects ?? db.mirrors ?? 0;
              const mensajes = db.mensajes ?? 0;
              let bot: string;
              if (r.webhook_estado === "no_conectado")
                bot = "Bot no conectado: se limpió solo la app.";
              else if (r.webhook_ok === false || r.webhook_estado === "error")
                bot = `El bot NO limpió su memoria (${r.webhook_error ?? "error"}).`;
              else bot = "Memoria del bot limpiada.";
              Alert.alert("Listo", `App: ${prospects} prospects, ${mensajes} mensajes.\n${bot}`);
            } catch (e) {
              Alert.alert("Error", e instanceof Error ? e.message : "No se pudo inicializar la prueba.");
            }
          },
        },
      ],
    );
  }

  const header = (
    <View>
      {/* ── Notificaciones de este cliente (#44): botón → config detallada ── */}
      <TouchableOpacity
        style={styles.pushRow}
        onPress={() => navigation.navigate("ClienteNotificaciones", { tenantId, nombre })}
        activeOpacity={0.7}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Icon name="bell" size={16} color={colors.text} />
          <Text style={[styles.pushLabel, { marginLeft: 6 }]}>Notificaciones de este cliente</Text>
        </View>
        <Text style={styles.pushChevron}>›</Text>
      </TouchableOpacity>

      {/* ── Inicializar prueba (per-cliente): borra todo del número de prueba ── */}
      <TouchableOpacity style={styles.pushRow} onPress={inicializarPrueba} activeOpacity={0.7}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Icon name="refresh" size={16} color={colors.text} />
          <Text style={[styles.pushLabel, { marginLeft: 6 }]}>Inicializar prueba</Text>
        </View>
        <Text style={styles.pushChevron}>›</Text>
      </TouchableOpacity>

      {/* ── Estadística actual del cliente (tocar → filtra la lista) ── */}
      <Section title="Este mes">
        <View style={styles.kpiGrid}>
          <KpiCard label="Prospects" value={stats.mes_actual.prospects} onPress={esEtiguel ? undefined : () => aplicarFiltro({})} />
          <KpiCard label="En conversación" value={stats.mes_actual.en_conversacion} accent={colors.primary} onPress={esEtiguel ? undefined : () => aplicarFiltro({ estado: "en_conversacion" })} />
          <KpiCard label="Interesados" value={stats.mes_actual.interesados} accent={colors.green} onPress={esEtiguel ? undefined : () => aplicarFiltro({ estado: "interesado" })} />
        </View>
        <View style={styles.kpiGrid}>
          <KpiCard label="Tasa respuesta" value={`${stats.mes_actual.tasa_respuesta}%`} accent={colors.primary} />
          <KpiCard label="Tasa conversión" value={`${stats.mes_actual.tasa_conversion}%`} accent={colors.green} />
          <KpiCard label="Total histórico" value={stats.total_prospects} />
        </View>
      </Section>

      <Section title="Por estado">
        {stats.por_estado
          .slice()
          .sort((a, b) => b.count - a.count)
          .map((e) => (
            <Bar
              key={e.estado}
              label={estadoLabel[e.estado] ?? e.estado}
              value={e.count}
              max={maxEstado}
              color={estadoColor[e.estado] ?? colors.textDim}
              onPress={esEtiguel ? undefined : () => aplicarFiltro({ estado: e.estado })}
            />
          ))}
      </Section>


      {/* ── Etiguel: contactados por Camila (espejo, APP.7) ──────── */}
      {esEtiguel ? (
        <View style={{ marginTop: 20 }}>
          <CollapsibleSection
            title="Leads"
            count={mirrorLeads.length}
            expanded={expandLeads}
            onToggle={() => setExpandLeads((v) => !v)}
          >
            {mirrorLeads.map((m) => (
              <MirrorCard key={m.id} item={m} onPress={() => navigation.navigate("EtiguelMirrorDetail", { item: m })} />
            ))}
            {mirrorLeads.length === 0 ? <Text style={styles.empty}>Todavía no contactó ningún lead.</Text> : null}
          </CollapsibleSection>

          <CollapsibleSection
            title="Prospects"
            count={mirrorProspects.length}
            expanded={expandProspects}
            onToggle={() => setExpandProspects((v) => !v)}
          >
            {mirrorProspects.map((m) => (
              <MirrorCard key={m.id} item={m} onPress={() => navigation.navigate("EtiguelMirrorDetail", { item: m })} />
            ))}
            {mirrorProspects.length === 0 ? <Text style={styles.empty}>Todavía no contactó ningún prospect.</Text> : null}
          </CollapsibleSection>
        </View>
      ) : null}

      {/* ── Prospects (Prospia) ──────────────────────────────────── */}
      {!esEtiguel ? (
        <View style={styles.prospectsHeader}>
          <Text style={styles.prospectsTitle}>Prospects ({total})</Text>
          <TouchableOpacity
            style={[styles.filtrarBtn, filtrosActivos > 0 ? styles.filtrarBtnActive : null]}
            onPress={() => setFiltroVisible(true)}
          >
            <Text style={styles.filtrarText}>
              ⛃ Filtrar{filtrosActivos > 0 ? ` (${filtrosActivos})` : ""}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );

  if (esEtiguel) {
    // Etiguel no tiene listado de prospects todavía; solo el header con stats+leads.
    return (
      <FlatList
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        data={[]}
        renderItem={null}
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
      />
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        data={prospects}
        keyExtractor={(p) => String(p.id)}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <ProspectCard
            prospect={item}
            onPress={() =>
              navigation.navigate("ProspectDetail", {
                tenantId,
                clienteNombre: nombre,
                prospect: item,
              })
            }
          />
        )}
        ListEmptyComponent={<Text style={styles.empty}>Sin prospects con este filtro.</Text>}
        onEndReached={cargarMas}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
      />
      <FiltroModal
        visible={filtroVisible}
        opts={filtrosOpts}
        filtro={filtro}
        onClose={() => setFiltroVisible(false)}
        onApply={aplicarFiltro}
      />
    </View>
  );
}

// ── Interruptor de notificaciones push del cliente ───────────────────────────
function PushToggle({ tenantId }: { tenantId: number }) {
  const { token } = useAuth();
  const [expoToken, setExpoToken] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let activo = true;
    (async () => {
      const et = await getExpoTokenAsync();
      if (!activo) return;
      setExpoToken(et);
      if (et && token) {
        try {
          const pref = await getPushPref(token, tenantId, et);
          if (activo) setEnabled(pref.enabled);
        } catch {
          // si falla, queda en activado (default)
        }
      }
      if (activo) setReady(true);
    })();
    return () => { activo = false; };
  }, [token, tenantId]);

  const onToggle = async (value: boolean) => {
    if (!token || !expoToken) return;
    setEnabled(value); // optimista
    try {
      await setPushPref(token, tenantId, expoToken, value);
    } catch {
      setEnabled(!value); // revertir si falla
    }
  };

  return (
    <View style={styles.pushRow}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Icon name="bell" size={16} color={colors.text} />
        <Text style={[styles.pushLabel, { marginLeft: 6 }]}>Notificaciones de este cliente</Text>
      </View>
      <Switch
        value={enabled}
        onValueChange={onToggle}
        disabled={!ready || !expoToken}
        trackColor={{ false: colors.cardAlt, true: colors.primary }}
        thumbColor="#fff"
      />
    </View>
  );
}

function contarFiltros(f: ProspectsFiltro): number {
  return [f.estado, f.termino_id, f.rubro_id, f.mes, f.q].filter((v) => v != null && v !== "").length;
}

// ── Card de prospect ─────────────────────────────────────────────────────────
// Misma estética que la tarjeta de la web (mobile): nombre + URL, clasificación,
// meta (estado · contactos · fecha) y un "Ver más" con el detalle.
function fechaCorta(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function ProspectCard({ prospect, onPress }: { prospect: ProspectRow; onPress: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const color = estadoColor[prospect.estado] ?? colors.textDim;
  const url = prospect.url ? prospect.url.replace(/^https?:\/\//, "") : null;
  const detalle: { label: string; value: string }[] = [];
  if (prospect.email) detalle.push({ label: "Email", value: prospect.email });
  if (prospect.whatsapp) detalle.push({ label: "WhatsApp", value: prospect.whatsapp });
  if (prospect.termino_texto) detalle.push({ label: "Término", value: prospect.termino_texto });
  if (prospect.rubro_nombre) detalle.push({ label: "Rubro", value: prospect.rubro_nombre });
  if (prospect.clasificacion_detalle) detalle.push({ label: "Detalle IA", value: prospect.clasificacion_detalle });

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.cardBody} onPress={onPress} activeOpacity={0.7}>
        <View style={styles.cardRow}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={styles.cardTitle} numberOfLines={1}>{prospect.nombre}</Text>
            {url ? <Text style={styles.cardUrl} numberOfLines={1}>{url}</Text> : null}
          </View>
          {prospect.clasificacion ? (
            <Text style={styles.clasifChip}>{prospect.clasificacion}</Text>
          ) : null}
        </View>
        <View style={styles.cardMeta}>
          <View style={styles.metaItem}>
            <View style={[styles.estadoDot, { backgroundColor: color }]} />
            <Text style={styles.metaText}>{estadoLabel[prospect.estado] ?? prospect.estado}</Text>
          </View>
          {prospect.envio_no_confirmado ? (
            <Text style={styles.envioChip}>⚠️ Envío sin confirmar</Text>
          ) : null}
          {prospect.cant_contactos > 0 ? (
            <IconText name="message" text={`${prospect.cant_contactos} ${prospect.cant_contactos === 1 ? "contacto" : "contactos"}`} />
          ) : null}
          {prospect.ult_contacto ? <IconText name="clock" text={fechaCorta(prospect.ult_contacto)} /> : null}
          {prospect.prox_contacto ? <IconText name="calendar" text={`Próx. ${fechaCorta(prospect.prox_contacto)}`} /> : null}
        </View>
      </TouchableOpacity>

      {expanded && detalle.length > 0 ? (
        <View style={styles.cardDetalle}>
          {detalle.map((d) => (
            <View key={d.label} style={styles.detalleRow}>
              <Text style={styles.detalleLabel}>{d.label}</Text>
              <Text style={styles.detalleValue}>{d.value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {detalle.length > 0 ? (
        <TouchableOpacity style={styles.verMas} onPress={() => setExpanded((v) => !v)} activeOpacity={0.7}>
          <Text style={styles.verMasText}>{expanded ? "▴ Ver menos" : "▾ Ver más"}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── Sección colapsable (Leads / Prospects de Etiguel) ─────────────────────────
function CollapsibleSection({
  title,
  count,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.collapsible}>
      <TouchableOpacity style={styles.collapsibleHeader} onPress={onToggle} activeOpacity={0.7}>
        <Text style={styles.collapsibleArrow}>{expanded ? "▾" : "▸"}</Text>
        <Text style={styles.collapsibleTitle}>{title}</Text>
        <Text style={styles.collapsibleCount}>{count}</Text>
      </TouchableOpacity>
      {expanded ? <View>{children}</View> : null}
    </View>
  );
}

// ── Card de item espejado de Etiguel (lead/prospect) ──────────────────────────
function MirrorCard({ item, onPress }: { item: EtiguelMirrorItem; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={styles.cardRow}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.nombre ?? "(sin nombre)"}</Text>
        {item.bloqueado ? (
          <Text style={styles.leadBloqueado} numberOfLines={1}>Bloqueado</Text>
        ) : item.estado ? (
          <Text style={styles.leadEstado} numberOfLines={2}>{item.estado}</Text>
        ) : null}
      </View>
      <View style={styles.cardMeta}>
        {item.telefono ? <IconText name="phone" text={item.telefono} /> : null}
        {item.cant_mensajes > 0 ? <IconText name="message" text={String(item.cant_mensajes)} /> : null}
        <IconText name="clock" text={fmtFecha(item.ultima_actividad)} />
        {item.prox_contacto ? <IconText name="calendar" text={`Próx. ${fmtFechaCorta(item.prox_contacto)}`} /> : null}
      </View>
    </TouchableOpacity>
  );
}

function fmtFecha(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Fecha 'YYYY-MM-DD' → 'dd/mm' sin pasar por Date (evita el corrimiento de día por timezone).
function fmtFechaCorta(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  return m ? `${m[3]}/${m[2]}` : s;
}

// ── Modal de filtros ─────────────────────────────────────────────────────────
function FiltroModal({
  visible,
  opts,
  filtro,
  onClose,
  onApply,
}: {
  visible: boolean;
  opts: FiltrosCliente | null;
  filtro: ProspectsFiltro;
  onClose: () => void;
  onApply: (f: ProspectsFiltro) => void;
}) {
  const [draft, setDraft] = useState<ProspectsFiltro>(filtro);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (visible) setDraft(filtro);
  }, [visible, filtro]);

  const toggle = (key: keyof ProspectsFiltro, value: string | number) => {
    setDraft((d) => ({ ...d, [key]: d[key] === value ? null : value }));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 18 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Filtrar prospects</Text>
            <TouchableOpacity onPress={() => onApply({})}>
              <Text style={styles.modalClear}>Limpiar</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={[0]}
            keyExtractor={() => "f"}
            renderItem={() => (
              <View>
                <FiltroGrupo
                  titulo="Estado"
                  opciones={(opts?.estados ?? []).map((e) => ({ id: e, label: estadoLabel[e] ?? e }))}
                  selected={draft.estado ?? null}
                  onToggle={(v) => toggle("estado", v)}
                />
                <FiltroGrupo
                  titulo="Término"
                  opciones={(opts?.terminos ?? []).map((t) => ({ id: t.id, label: t.label }))}
                  selected={draft.termino_id ?? null}
                  onToggle={(v) => toggle("termino_id", v)}
                />
                <FiltroGrupo
                  titulo="Rubro"
                  opciones={(opts?.rubros ?? []).map((r) => ({ id: r.id, label: r.label }))}
                  selected={draft.rubro_id ?? null}
                  onToggle={(v) => toggle("rubro_id", v)}
                />
                <FiltroGrupo
                  titulo="Mes"
                  opciones={(opts?.meses ?? []).map((m) => ({ id: m, label: m }))}
                  selected={draft.mes ?? null}
                  onToggle={(v) => toggle("mes", v)}
                />
              </View>
            )}
          />

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.btnCancel} onPress={onClose}>
              <Text style={styles.btnCancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnApply} onPress={() => onApply(draft)}>
              <Text style={styles.btnApplyText}>Aplicar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function FiltroGrupo({
  titulo,
  opciones,
  selected,
  onToggle,
}: {
  titulo: string;
  opciones: { id: string | number; label: string }[];
  selected: string | number | null;
  onToggle: (v: string | number) => void;
}) {
  if (opciones.length === 0) return null;
  return (
    <View style={styles.grupo}>
      <Text style={styles.grupoTitulo}>{titulo}</Text>
      <View style={styles.chips}>
        {opciones.map((o) => {
          const active = selected === o.id;
          return (
            <TouchableOpacity
              key={String(o.id)}
              style={[styles.chip, active ? styles.chipActive : null]}
              onPress={() => onToggle(o.id)}
            >
              <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 12, paddingBottom: 40 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap" },
  empty: { color: colors.textDim, marginTop: 8 },

  pushRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 4,
  },
  pushLabel: { color: colors.text, fontSize: 14, fontWeight: "600" },
  pushChevron: { color: colors.textDim, fontSize: 20, fontWeight: "300" },

  prospectsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 10 },
  prospectsTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  filtrarBtn: { borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  filtrarBtnActive: { borderColor: colors.primary, backgroundColor: colors.cardAlt },
  filtrarText: { color: colors.text, fontSize: 13, fontWeight: "600" },

  card: { backgroundColor: colors.card, borderRadius: 12, marginBottom: 10, overflow: "hidden" },
  cardBody: { padding: 14 },
  cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "700", flex: 1, marginRight: 8 },
  cardUrl: { color: colors.blue, fontSize: 12, marginTop: 2 },
  clasifChip: { color: colors.textDim, fontSize: 11, fontWeight: "700", borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden", textTransform: "capitalize" },
  envioChip: { color: "#b45309", backgroundColor: "#fef3c7", borderColor: "#fcd34d", borderWidth: 1, fontSize: 10, fontWeight: "700", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
  cardMeta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 8 },
  metaItem: { flexDirection: "row", alignItems: "center" },
  estadoDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  metaText: { color: colors.textDim, fontSize: 12 },
  cardDetalle: { paddingHorizontal: 14, paddingBottom: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  detalleRow: { flexDirection: "row", marginBottom: 6 },
  detalleLabel: { color: colors.textDim, fontSize: 12, width: 80, flexShrink: 0 },
  detalleValue: { color: colors.text, fontSize: 12, flex: 1 },
  verMas: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 8, alignItems: "center" },
  verMasText: { color: colors.textDim, fontSize: 12, fontWeight: "600" },

  leadEstado: { color: colors.primary, fontSize: 11, fontWeight: "700", borderColor: colors.primary, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 0, maxWidth: "52%", textAlign: "right" },
  leadBloqueado: { color: colors.red, fontSize: 11, fontWeight: "800", borderColor: colors.red, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 0, textAlign: "right", backgroundColor: colors.red + "1A" },

  collapsible: { marginBottom: 14 },
  collapsibleHeader: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomColor: colors.border, borderBottomWidth: 1, marginBottom: 10 },
  collapsibleArrow: { color: colors.textDim, fontSize: 14, width: 20 },
  collapsibleTitle: { color: colors.text, fontSize: 16, fontWeight: "700", flex: 1 },
  collapsibleCount: { color: colors.textDim, fontSize: 14, fontWeight: "700" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: "80%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  modalClear: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 14 },
  btnCancel: { flex: 1, borderColor: colors.border, borderWidth: 1, borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  btnCancelText: { color: colors.text, fontSize: 15, fontWeight: "700" },
  btnApply: { flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  btnApplyText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  grupo: { marginBottom: 16 },
  grupoTitulo: { color: colors.textDim, fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginBottom: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextActive: { color: "#fff", fontWeight: "700" },
});
