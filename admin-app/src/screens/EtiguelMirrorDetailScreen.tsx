import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { MensajeRow, getEtiguelMirrorMensajes } from "../api";
import { useAuth } from "../auth";
import { Loader, Section } from "../components/ui";
import { EtiguelMirrorDetailProps } from "../navigation";
import { IconText } from "../components/Icon";
import { colors } from "../theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function EtiguelMirrorDetailScreen({ route, navigation }: EtiguelMirrorDetailProps) {
  const insets = useSafeAreaInsets();
  const { item } = route.params;
  const { token } = useAuth();
  const [mensajes, setMensajes] = useState<MensajeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: item.nombre ?? "Conversación" });
  }, [navigation, item.nombre]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setMensajes(await getEtiguelMirrorMensajes(token, item.id));
    } catch {
      // sin mensajes / error aislado
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, item.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
      }
    >
      <View style={styles.headerCard}>
        <View style={styles.headerRow}>
          <Text style={styles.nombre}>{item.nombre ?? "(sin nombre)"}</Text>
          <Text style={styles.tag}>{item.tipo === "lead" ? "Lead" : "Prospect"}</Text>
        </View>
        {item.estado ? <Text style={styles.meta}>Estado: {item.estado}</Text> : null}
        {item.telefono ? <IconText name="phone" text={item.telefono} size={14} textStyle={{ fontSize: 13, marginTop: 4 }} /> : null}
        {item.email ? <IconText name="mail" text={item.email} size={14} textStyle={{ fontSize: 13, marginTop: 4 }} /> : null}
      </View>

      <Section title={`Conversación con Camila (${mensajes.length})`}>
        {loading ? (
          <Loader />
        ) : mensajes.length === 0 ? (
          <Text style={styles.empty}>Todavía no hay mensajes espejados.</Text>
        ) : (
          mensajes.map((m) => <Burbuja key={m.id} mensaje={m} />)
        )}
      </Section>
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

function fmtHora(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 12, paddingBottom: 40 },
  headerCard: { backgroundColor: colors.card, borderRadius: 12, padding: 14 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  nombre: { color: colors.text, fontSize: 18, fontWeight: "800", flex: 1, marginRight: 8 },
  tag: { color: colors.amber, fontSize: 11, fontWeight: "700", borderColor: colors.amber, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  meta: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  empty: { color: colors.textDim },

  burbujaRow: { flexDirection: "row", marginBottom: 8 },
  burbujaRowIn: { justifyContent: "flex-start" },
  burbujaRowOut: { justifyContent: "flex-end" },
  burbuja: { maxWidth: "82%", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  burbujaIn: { backgroundColor: colors.card, borderTopLeftRadius: 4 },
  burbujaOut: { backgroundColor: colors.primary, borderTopRightRadius: 4 },
  burbujaTexto: { color: colors.text, fontSize: 14 },
  burbujaFecha: { color: colors.textDim, fontSize: 10, marginTop: 4, alignSelf: "flex-end" },
});
