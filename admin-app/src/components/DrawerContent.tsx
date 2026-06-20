import { DrawerContentComponentProps } from "@react-navigation/drawer";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ClienteResumen, getClientes } from "../api";
import { useAuth } from "../auth";
import { Icon, IconName } from "./Icon";
import { ProspiaLogo } from "./Logo";
import { colors } from "../theme";

/** Contenido del menú lateral: Dashboard (home) + cada cliente + Avisos + salir.
 *  Los clientes se traen del backend para que el menú liste todos los tenants. */
export default function DrawerContent({ navigation, state }: DrawerContentComponentProps) {
  const { token, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [loading, setLoading] = useState(true);

  const activeRoute = state.routes[state.index]?.name;
  const activeTenant =
    activeRoute === "ClienteView"
      ? (state.routes[state.index]?.params as { tenantId?: number } | undefined)?.tenantId
      : undefined;

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setClientes(await getClientes(token));
    } catch {
      // si falla, el menú igual muestra Dashboard/Avisos
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.brandBlock}>
        <ProspiaLogo markSize={28} />
        <Text style={styles.brandSub}>Admin</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <NavItem
          icon="dashboard"
          label="Dashboard"
          active={activeRoute === "Dashboard"}
          onPress={() => navigation.navigate("Dashboard")}
        />
        <NavItem
          icon="bell"
          label="Avisos"
          active={activeRoute === "Avisos"}
          onPress={() => navigation.navigate("Avisos")}
        />
        <NavItem
          icon="alert"
          label="Errores"
          active={activeRoute === "Errores"}
          onPress={() => navigation.navigate("Errores")}
        />
        <NavItem
          icon="list"
          label="Pendientes"
          active={activeRoute === "Pendientes"}
          onPress={() => navigation.navigate("Pendientes")}
        />

        <Text style={styles.section}>Clientes</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
        ) : (
          clientes.map((c) => (
            <NavItem
              key={`${c.fuente}-${c.tenant_id}`}
              label={c.nombre}
              tag={c.fuente === "etiguel" ? "Etiguel" : undefined}
              active={activeRoute === "ClienteView" && activeTenant === c.tenant_id}
              onPress={() =>
                navigation.navigate("ClienteView", {
                  tenantId: c.tenant_id,
                  nombre: c.nombre,
                  fuente: c.fuente,
                })
              }
            />
          ))
        )}
        {!loading && clientes.length === 0 ? (
          <Text style={styles.empty}>Sin clientes.</Text>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <NavItem
          icon="settings"
          label="Configuración"
          active={activeRoute === "Configuracion"}
          onPress={() => navigation.navigate("Configuracion")}
        />
        <TouchableOpacity style={[styles.logout, { paddingBottom: insets.bottom + 12 }]} onPress={signOut}>
          <Text style={styles.logoutText}>Salir</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function NavItem({
  label,
  onPress,
  active,
  tag,
  icon,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  tag?: string;
  icon?: IconName;
}) {
  return (
    <TouchableOpacity style={[styles.item, active ? styles.itemActive : null]} onPress={onPress}>
      {icon ? (
        <View style={styles.itemIcon}>
          <Icon name={icon} size={18} color={active ? colors.primary : colors.textDim} />
        </View>
      ) : null}
      <Text style={[styles.itemText, active ? styles.itemTextActive : null]} numberOfLines={1}>
        {label}
      </Text>
      {tag ? <Text style={styles.tag}>{tag}</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.card },
  brandBlock: { paddingHorizontal: 16, marginBottom: 10 },
  brandSub: { color: colors.textDim, fontSize: 11, fontWeight: "700", letterSpacing: 2, textTransform: "uppercase", marginTop: 4, marginLeft: 40 },
  scroll: { paddingHorizontal: 8, paddingBottom: 20 },
  section: { color: colors.textDim, fontSize: 12, fontWeight: "700", marginTop: 18, marginBottom: 6, marginLeft: 12, textTransform: "uppercase" },
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 2,
  },
  itemActive: { backgroundColor: colors.cardAlt },
  itemIcon: { width: 26, alignItems: "flex-start" },
  itemText: { color: colors.text, fontSize: 15, flex: 1 },
  itemTextActive: { color: colors.primary, fontWeight: "700" },
  tag: {
    color: colors.amber,
    fontSize: 10,
    fontWeight: "700",
    borderColor: colors.amber,
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginLeft: 6,
  },
  empty: { color: colors.textDim, marginLeft: 12, marginTop: 8 },
  footer: { borderTopColor: colors.border, borderTopWidth: 1, paddingHorizontal: 8, paddingTop: 6 },
  logout: { borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 14, paddingHorizontal: 16, marginTop: 4 },
  logoutText: { color: colors.primary, fontSize: 15, fontWeight: "700" },
});
