import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getPreguntasModo, setPreguntasModo } from "../api";
import { useAuth } from "../auth";
import { Icon, IconName } from "../components/Icon";
import { ConfiguracionProps } from "../navigation";
import { colors } from "../theme";

// Configuración = menú con dos entradas que llevan a su detalle: Perfil
// (usuario + contraseña) y Notificaciones (avisos de este dispositivo) + el
// switch "Preguntas al cel" (rutea las preguntas de Claude Code al celular).
export default function ConfiguracionScreen({ navigation }: ConfiguracionProps) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
      <View style={styles.card}>
        <Row
          icon="lock"
          label="Perfil"
          sub="Usuario y contraseña"
          onPress={() => navigation.navigate("Perfil")}
        />
        <Row
          icon="bell"
          label="Notificaciones"
          sub="Avisos que te llegan a este dispositivo"
          border
          onPress={() => navigation.navigate("Notificaciones")}
        />
      </View>

      <Text style={styles.sectionTitle}>Claude Code</Text>
      <View style={styles.card}>
        <PreguntasAlCelSwitch />
        <Row
          icon="flag"
          label="Preguntas de Claude"
          sub="Historial de lo que te preguntó y elegiste"
          border
          onPress={() => navigation.navigate("PreguntasClaude")}
        />
      </View>
    </ScrollView>
  );
}

// Switch maestro: cuando está ON, las preguntas de Claude Code llegan como push a
// este cel (en vez de la cajita nativa de la terminal) y las respondés acá.
function PreguntasAlCelSwitch() {
  const { token } = useAuth();
  const [activo, setActivo] = useState<boolean | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!token) return;
    getPreguntasModo(token).then((r) => setActivo(r.activo)).catch(() => setErr(true));
  }, [token]);

  const onToggle = async (next: boolean) => {
    if (!token || guardando) return;
    const prev = activo;
    setActivo(next);           // optimista
    setGuardando(true);
    setErr(false);
    try {
      const r = await setPreguntasModo(token, next);
      setActivo(r.activo);
    } catch {
      setActivo(prev ?? false); // revertir si falla
      setErr(true);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Icon name="send" size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>Preguntas al cel</Text>
        <Text style={styles.rowSub}>
          {err ? "No se pudo guardar, probá de nuevo"
            : activo === null ? "Cargando…"
            : activo ? "Claude te pregunta acá (no en la compu)"
            : "Las preguntas van a la compu (normal)"}
        </Text>
      </View>
      {guardando ? <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 6 }} /> : null}
      <Switch
        value={!!activo}
        onValueChange={onToggle}
        disabled={activo === null}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#fff"
      />
    </View>
  );
}

function Row({ icon, label, sub, onPress, border }: { icon: IconName; label: string; sub: string; onPress: () => void; border?: boolean }) {
  return (
    <TouchableOpacity style={[styles.row, border && styles.rowBorder]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowIcon}>
        <Icon name={icon} size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  card: { backgroundColor: colors.card, borderRadius: 14, paddingHorizontal: 16 },
  sectionTitle: { color: colors.textDim, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 24, marginBottom: 8, marginLeft: 4 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 16, gap: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowIcon: { width: 28, alignItems: "center" },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: "600" },
  rowSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  chevron: { color: colors.textDim, fontSize: 22, fontWeight: "300" },
});
