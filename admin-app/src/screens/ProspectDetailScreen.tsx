import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  HistorialRow,
  MensajeRow,
  getHistorialProspect,
  getMensajesProspect,
} from "../api";
import { useAuth } from "../auth";
import { Loader, Section } from "../components/ui";
import { ProspectDetailProps } from "../navigation";
import { colors, estadoColor, estadoLabel } from "../theme";

export default function ProspectDetailScreen({ route, navigation }: ProspectDetailProps) {
  const { tenantId, prospect } = route.params;
  const { token } = useAuth();
  const [mensajes, setMensajes] = useState<MensajeRow[]>([]);
  const [historial, setHistorial] = useState<HistorialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: prospect.nombre });
  }, [navigation, prospect.nombre]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [m, h] = await Promise.all([
        getMensajesProspect(token, tenantId, prospect.id),
        getHistorialProspect(token, tenantId, prospect.id),
      ]);
      setMensajes(m);
      setHistorial(h);
    } catch {
      // los datos base del prospect ya vienen por params; el chat puede fallar aislado
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, tenantId, prospect.id]);

  useEffect(() => {
    load();
  }, [load]);

  const color = estadoColor[prospect.estado] ?? colors.textDim;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
      }
    >
      {/* ── Datos del prospect ───────────────────────────────────── */}
      <View style={styles.headerCard}>
        <Text style={styles.nombre}>{prospect.nombre}</Text>
        <Text style={[styles.estadoBadge, { color, borderColor: color }]}>
          {estadoLabel[prospect.estado] ?? prospect.estado}
        </Text>
      </View>

      <View style={styles.datos}>
        <Dato label="Término" value={prospect.termino_texto} />
        <Dato label="Rubro" value={prospect.rubro_nombre} />
        <Dato label="Clasificación" value={prospect.clasificacion} />
        <Dato label="Detalle clasif." value={prospect.clasificacion_detalle} />
        <Dato label="WhatsApp" value={prospect.whatsapp} />
        <Dato label="Teléfono" value={prospect.telefono} />
        <Dato label="Email" value={prospect.email} />
        <Dato label="URL" value={prospect.url} />
        <Dato label="Contactos" value={String(prospect.cant_contactos)} />
        <Dato label="Último contacto" value={fmt(prospect.ult_contacto)} />
        <Dato label="Próximo contacto" value={fmt(prospect.prox_contacto)} />
        <Dato label="Creado" value={fmt(prospect.created_at)} />
      </View>

      {/* ── Conversación con Camila ──────────────────────────────── */}
      <Section title={`Conversación con Camila (${mensajes.length})`}>
        {loading ? (
          <Loader />
        ) : mensajes.length === 0 ? (
          <Text style={styles.empty}>Sin mensajes espejados todavía.</Text>
        ) : (
          mensajes.map((m) => <Burbuja key={m.id} mensaje={m} />)
        )}
      </Section>

      {/* ── Historial ────────────────────────────────────────────── */}
      {historial.length > 0 ? (
        <Section title="Historial">
          {historial.map((h) => (
            <View key={h.id} style={styles.histRow}>
              <Text style={styles.histTipo}>{estadoLabel[h.tipo] ?? h.tipo}</Text>
              <Text style={styles.histFecha}>{fmt(h.fecha)}</Text>
              {h.detalle ? <Text style={styles.histDetalle}>{h.detalle}</Text> : null}
            </View>
          ))}
        </Section>
      ) : null}
    </ScrollView>
  );
}

function Burbuja({ mensaje }: { mensaje: MensajeRow }) {
  const out = mensaje.direccion === "out";
  return (
    <View style={[styles.burbujaRow, out ? styles.burbujaRowOut : styles.burbujaRowIn]}>
      <View style={[styles.burbuja, out ? styles.burbujaOut : styles.burbujaIn]}>
        <Text style={styles.burbujaTexto}>{mensaje.texto}</Text>
        <Text style={styles.burbujaFecha}>{fmtHora(mensaje.fecha)}</Text>
      </View>
    </View>
  );
}

function Dato({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.datoRow}>
      <Text style={styles.datoLabel}>{label}</Text>
      <Text style={styles.datoValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function fmt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtHora(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 12, paddingBottom: 40 },
  headerCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  nombre: { color: colors.text, fontSize: 20, fontWeight: "800", flex: 1, marginRight: 8 },
  estadoBadge: { fontSize: 11, fontWeight: "700", borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
  datos: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 14 },
  datoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  datoLabel: { color: colors.textDim, fontSize: 13, marginRight: 12 },
  datoValue: { color: colors.text, fontSize: 13, fontWeight: "600", flex: 1, textAlign: "right" },
  empty: { color: colors.textDim },

  burbujaRow: { flexDirection: "row", marginBottom: 8 },
  burbujaRowIn: { justifyContent: "flex-start" },
  burbujaRowOut: { justifyContent: "flex-end" },
  burbuja: { maxWidth: "82%", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  burbujaIn: { backgroundColor: colors.card, borderTopLeftRadius: 4 },
  burbujaOut: { backgroundColor: colors.primary, borderTopRightRadius: 4 },
  burbujaTexto: { color: colors.text, fontSize: 14 },
  burbujaFecha: { color: colors.textDim, fontSize: 10, marginTop: 4, alignSelf: "flex-end" },

  histRow: { borderLeftColor: colors.border, borderLeftWidth: 2, paddingLeft: 10, marginBottom: 10 },
  histTipo: { color: colors.text, fontSize: 14, fontWeight: "600" },
  histFecha: { color: colors.textDim, fontSize: 12 },
  histDetalle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
});
