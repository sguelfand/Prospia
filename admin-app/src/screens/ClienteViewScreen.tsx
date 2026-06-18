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
  EtiguelLead,
  FiltrosCliente,
  ProspectRow,
  ProspectsFiltro,
  getClienteStats,
  getEtiguelLeads,
  getFiltrosCliente,
  getProspectsCliente,
  getPushPref,
  setPushPref,
} from "../api";
import { useAuth } from "../auth";
import { Bar, ErrorBox, KpiCard, Loader, Section } from "../components/ui";
import { ClienteViewProps } from "../navigation";
import { getExpoTokenAsync } from "../push";
import { colors, estadoColor, estadoLabel } from "../theme";

const PAGE_SIZE = 50;

export default function ClienteViewScreen({ route, navigation }: ClienteViewProps) {
  const { tenantId, nombre } = route.params;
  const esEtiguel = tenantId === ETIGUEL_TENANT_ID;
  const { token } = useAuth();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [leads, setLeads] = useState<EtiguelLead[]>([]);
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
            setLeads(await getEtiguelLeads(token));
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

      {/* ── Leads (solo Etiguel) ─────────────────────────────────── */}
      {esEtiguel ? (
        <Section title={`Leads (${leads.length})`}>
          {leads.map((l, i) => (
            <LeadCard key={`${i}-${l.descripcion}`} lead={l} />
          ))}
          {leads.length === 0 ? <Text style={styles.empty}>Sin leads en el período.</Text> : null}
        </Section>
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
        contentContainerStyle={styles.content}
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
        contentContainerStyle={styles.content}
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
      <Text style={styles.pushLabel}>🔔 Notificaciones de este cliente</Text>
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
        {prospect.termino_texto ? <Text style={styles.metaItem}>🔍 {prospect.termino_texto}</Text> : null}
        {prospect.clasificacion ? <Text style={styles.metaItem}>⭐ {prospect.clasificacion}</Text> : null}
        <Text style={styles.metaItem}>📨 {prospect.cant_contactos}</Text>
        {prospect.cant_mensajes > 0 ? <Text style={styles.metaItem}>💬 {prospect.cant_mensajes}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

// ── Card de lead de Etiguel (igual que la pantalla previa) ────────────────────
function LeadCard({ lead }: { lead: EtiguelLead }) {
  return (
    <View style={styles.leadCard}>
      <View style={styles.cardRow}>
        <Text style={styles.cardTitle} numberOfLines={2}>{lead.descripcion}</Text>
        <Text style={styles.leadEstado}>{lead.estado}</Text>
      </View>
      {lead.nombre ? <Text style={styles.leadNombre}>{lead.nombre}</Text> : null}
      <View style={styles.cardMeta}>
        {lead.origen ? <Text style={styles.metaItem}>📍 {lead.origen}</Text> : null}
        {lead.fecha_creacion ? <Text style={styles.metaItem}>🗓 {lead.fecha_creacion}</Text> : null}
      </View>
      {lead.telefono ? <Text style={styles.leadContacto}>📞 {lead.telefono}</Text> : null}
      {lead.email ? <Text style={styles.leadContacto}>✉️ {lead.email}</Text> : null}
    </View>
  );
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
  useEffect(() => {
    if (visible) setDraft(filtro);
  }, [visible, filtro]);

  const toggle = (key: keyof ProspectsFiltro, value: string | number) => {
    setDraft((d) => ({ ...d, [key]: d[key] === value ? null : value }));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
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

  leadCard: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10 },
  leadEstado: { color: colors.primary, fontSize: 11, fontWeight: "700", borderColor: colors.primary, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
  leadNombre: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  leadContacto: { color: colors.text, fontSize: 13, marginTop: 4 },

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
