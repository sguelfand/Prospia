import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, IconName } from "../components/Icon";
import { ConfiguracionProps } from "../navigation";
import { colors } from "../theme";

// Configuración = menú con dos entradas que llevan a su detalle: Perfil
// (usuario + contraseña) y Notificaciones (avisos de este dispositivo).
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
    </ScrollView>
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
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 16, gap: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowIcon: { width: 28, alignItems: "center" },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: "600" },
  rowSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  chevron: { color: colors.textDim, fontSize: 22, fontWeight: "300" },
});
