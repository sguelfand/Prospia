import React, { useCallback, useEffect, useState } from "react";
import {
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
  const { tenantId, nombre } = route.params;
  const insets = useSafeAreaInsets();
  const esEtiguel = tenantId === ETIGUEL_TENANT_ID;
  const { token } = useAuth();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [mirror, setMirror] = useState<EtiguelMirrorItem[]>([]);
  const [expandLeads, setExpandLeads] = useState(true);
  const [expandProspects, setExpandProspects] = useState(true);
  const [filtrosOpts, setFiltrosOpts] = useState<FiltrosCliente | null>(null);
  const [filtro, setFiltro] = useState<ProspectsFiltro>({});
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
  const maxTermino = Math.max(1, ...stats.por_termino.map((t) => t.encontrados));

  // Etiguel: espejo separado en leads / prospects (backend ya los manda por más reciente).
  const mirrorLeads = mirror.filter((m) => m.tipo === "lead");
  const mirrorProspects = mirror.filter((m) => m.tipo === "prospect");

  const header = (
    <View>
      {/* ── Interruptor de push de este cliente (APP.4) ──────────── */}
      <PushToggle tenantId={tenantId} />

      {/* ── Estadística actual del cliente ───────────────────────── */}
      <Section title="Este mes">
        <View style={styles.kpiGrid}>
          <KpiCard label="Prospects" value={stats.mes_actual.prospects} />
          <KpiCard label="En conversación" value={stats.mes_actual.en_conversacion} accent={colors.primary} />
          <KpiCard label="Interesados" value={stats.mes_actual.interesados} accent={colors.green} />
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
            />
          ))}
      </Section>

      {stats.por_termino.length > 0 ? (
        <Section title="Por término (top 10)">
          {stats.por_termino.map((t) => (
            <Bar
              key={t.termino}
              label={t.termino}
              value={t.encontrados}
              max={maxTermino}
              color={colors.blue}
              right={`${t.encontrados} · ${t.interesados} int.`}
            />
          ))}
        </Section>
      ) : null}

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
function ProspectCard({ prospect, onPress }: { prospect: ProspectRow; onPress: () => void }) {
  const color = estadoColor[prospect.estado] ?? colors.textDim;
  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={styles.cardRow}>
        <Text style={styles.cardTitle} numberOfLines={1}>{prospect.nombre}</Text>
        <Text style={[styles.estadoBadge, { color, borderColor: color }]}>
          {estadoLabel[prospect.estado] ?? prospect.estado}
        </Text>
      </View>
      <View style={styles.cardMeta}>
        {prospect.termino_texto ? <IconText name="search" text={prospect.termino_texto} /> : null}
        {prospect.clasificacion ? <IconText name="star" text={prospect.clasificacion} /> : null}
        <IconText name="send" text={String(prospect.cant_contactos)} />
        {prospect.cant_mensajes > 0 ? <IconText name="message" text={String(prospect.cant_mensajes)} /> : null}
      </View>
    </TouchableOpacity>
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
        {item.estado ? <Text style={styles.leadEstado}>{item.estado}</Text> : null}
      </View>
      <View style={styles.cardMeta}>
        {item.telefono ? <IconText name="phone" text={item.telefono} /> : null}
        {item.cant_mensajes > 0 ? <IconText name="message" text={String(item.cant_mensajes)} /> : null}
        <IconText name="clock" text={fmtFecha(item.ultima_actividad)} />
      </View>
    </TouchableOpacity>
  );
}

function fmtFecha(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
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

  prospectsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 10 },
  prospectsTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  filtrarBtn: { borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  filtrarBtnActive: { borderColor: colors.primary, backgroundColor: colors.cardAlt },
  filtrarText: { color: colors.text, fontSize: 13, fontWeight: "600" },

  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10 },
  cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "700", flex: 1, marginRight: 8 },
  estadoBadge: { fontSize: 11, fontWeight: "700", borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
  cardMeta: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  metaItem: { color: colors.textDim, fontSize: 12 },

  leadEstado: { color: colors.primary, fontSize: 11, fontWeight: "700", borderColor: colors.primary, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },

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
