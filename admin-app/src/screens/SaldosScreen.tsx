import React, { useCallback, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { ProveedorSaldo, SaldosResp, getSaldos } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import { ErrorBox, Loader } from "../components/ui";
import { SaldosProps } from "../navigation";
import { colors } from "../theme";

function usd(n?: number | null): string {
  if (n === null || n === undefined) return "—";
  return `US$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Color e ícono según el estado del proveedor.
function estadoVisual(p: ProveedorSaldo): { color: string; label: string; icon: any } {
  if (!p.ok) return { color: colors.red, label: "Error", icon: "alert" };
  switch (p.estado) {
    case "activo": return { color: colors.green, label: "Con saldo", icon: "check" };
    case "sin_saldo": return { color: colors.red, label: "Sin saldo", icon: "alert" };
    case "sin_api_saldo": return { color: colors.textDim, label: "Sin API de saldo", icon: "alert" };
    default: return { color: colors.amber, label: "Desconocido", icon: "alert" };
  }
}

export default function SaldosScreen(_props: SaldosProps) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<SaldosResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      setData(await getSaldos(token));
    } catch (e: any) {
      setError(e?.message || "No se pudieron traer los saldos");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <Loader />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
    >
      <Text style={styles.intro}>
        Saldo de los proveedores de IA que mueven a Camila. Deslizá para actualizar.
      </Text>

      {error ? <ErrorBox message={error} onRetry={load} /> : null}

      {(data?.proveedores || []).map((p) => {
        const v = estadoVisual(p);
        return (
          <View key={p.proveedor} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.prov}>{p.proveedor}</Text>
              <View style={[styles.badge, { borderColor: v.color }]}>
                <Icon name={v.icon} size={12} color={v.color} />
                <Text style={[styles.badgeText, { color: v.color }]}>{v.label}</Text>
              </View>
            </View>

            {/* Cuerpo según el tipo de dato del proveedor */}
            {p.ok && p.tipo === "saldo" ? (
              <>
                <Text style={styles.big}>{usd(p.saldo_usd)}</Text>
                <Text style={styles.sub}>
                  disponible · usado {usd(p.usado_usd)} de {usd(p.total_usd)}
                </Text>
              </>
            ) : null}

            {p.ok && p.tipo === "estado" ? (
              <Text style={[styles.detalle, p.estado === "sin_saldo" ? { color: colors.red } : null]}>
                {p.detalle}
              </Text>
            ) : null}

            {p.ok && p.tipo === "consumo" ? (
              <>
                <Text style={styles.big}>{usd(p.consumo_mes_usd)}</Text>
                <Text style={styles.sub}>consumo {p.mes_nombre}</Text>
                <Text style={styles.detalle}>{p.detalle}</Text>
              </>
            ) : null}

            {!p.ok ? <Text style={[styles.detalle, { color: colors.red }]}>{p.error}</Text> : null}
          </View>
        );
      })}

      {data?.consultado_at ? (
        <Text style={styles.foot}>
          Actualizado {new Date(data.consultado_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  intro: { color: colors.textDim, fontSize: 13, marginBottom: 14, lineHeight: 18 },
  card: {
    backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 12,
    borderColor: colors.border, borderWidth: 1,
  },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  prov: { color: colors.text, fontSize: 16, fontWeight: "800" },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 9, paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontWeight: "700" },
  big: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: 0.3 },
  sub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  detalle: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginTop: 4 },
  foot: { color: colors.textDim, fontSize: 11, textAlign: "center", marginTop: 8 },
});
