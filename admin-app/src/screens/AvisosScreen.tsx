import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { Evento, getEventos } from "../api";
import { useAuth } from "../auth";
import { ErrorBox, Loader } from "../components/ui";
import { AvisosProps } from "../navigation";
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
  if (dias < 30) return `hace ${dias} d`;
  return d.toLocaleDateString();
}

export default function AvisosScreen({ navigation }: AvisosProps) {
  const { token } = useAuth();
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setEventos(await getEventos(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar avisos.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loader />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={colors.primary}
        />
      }
    >
      {error ? <ErrorBox message={error} onRetry={load} /> : null}

      {eventos.map((e) => {
        const esInteresado = e.tipo === "interesado";
        return (
          <TouchableOpacity
            key={e.id}
            style={styles.card}
            onPress={() =>
              navigation.navigate("ClienteView", {
                tenantId: e.tenant_id,
                nombre: e.cliente,
                fuente: "plataforma",
              })
            }
          >
            <View style={styles.row}>
              <Text style={styles.emoji}>{esInteresado ? "🔥" : "💬"}</Text>
              <View style={styles.body}>
                <View style={styles.headerRow}>
                  <Text style={styles.tipo}>
                    {esInteresado ? "Interesado" : "Primera respuesta"}
                  </Text>
                  <Text style={styles.tiempo}>{tiempoRelativo(e.fecha)}</Text>
                </View>
                <Text style={styles.prospect}>{e.prospect_nombre}</Text>
                <Text style={styles.cliente}>{e.cliente}</Text>
                {esInteresado && e.detalle ? (
                  <Text style={styles.detalle} numberOfLines={2}>
                    {e.detalle}
                  </Text>
                ) : null}
              </View>
            </View>
          </TouchableOpacity>
        );
      })}

      {eventos.length === 0 && !error ? (
        <Text style={styles.empty}>No hay avisos todavía.</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 12, paddingBottom: 40 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 10 },
  row: { flexDirection: "row" },
  emoji: { fontSize: 22, marginRight: 12, marginTop: 2 },
  body: { flex: 1 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tipo: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  tiempo: { color: colors.textDim, fontSize: 12 },
  prospect: { color: colors.text, fontSize: 16, fontWeight: "700", marginTop: 4 },
  cliente: { color: colors.textDim, fontSize: 13, marginTop: 1 },
  detalle: { color: colors.text, fontSize: 13, marginTop: 6, lineHeight: 18 },
  empty: { color: colors.textDim, textAlign: "center", marginTop: 30 },
});
