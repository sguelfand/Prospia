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

import { ClienteResumen, getAppVersion, getClientes } from "../api";
import { useAuth } from "../auth";
import { Icon, IconName } from "./Icon";
import { ProspiaLogo } from "./Logo";
import { colors } from "../theme";
import { APK_VERSION, APP_VERSION } from "../version";

/** Contenido del menú lateral: Dashboard (home) + cada cliente + Avisos + salir.
 *  Los clientes se traen del backend para que el menú liste todos los tenants. */
export default function DrawerContent({ navigation, state }: DrawerContentComponentProps) {
  const { token, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [clientes, setClientes] = useState<ClienteResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [monOpen, setMonOpen] = useState(true);
  const [apkLatest, setApkLatest] = useState<number | null>(null);
  // El APK instalado quedó viejo si el backend conoce uno más nuevo que el baked.
  const apkDesactualizado = apkLatest != null && APK_VERSION < apkLatest;

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
    // Chequeo del último APK (best-effort, no bloquea el menú).
    try {
      const { apk_latest } = await getAppVersion(token);
      setApkLatest(apk_latest);
    } catch {
      /* sin señal → no mostramos el aviso */
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
          icon="message"
          label="Preguntas"
          active={activeRoute === "Preguntas"}
          onPress={() => navigation.navigate("Preguntas")}
        />
        <NavItem
          icon="list"
          label="Pendientes"
          active={activeRoute === "Pendientes"}
          onPress={() => navigation.navigate("Pendientes")}
        />
        <NavItem
          icon="calendar"
          label="Agenda"
          active={activeRoute === "Agenda"}
          onPress={() => navigation.navigate("Agenda")}
        />
        <NavItem
          icon="flag"
          label="Preguntas de Claude"
          active={activeRoute === "PreguntasClaude"}
          onPress={() => navigation.navigate("PreguntasClaude")}
        />
        <NavItem
          icon="terminal"
          label="Claude"
          active={activeRoute === "Sesiones"}
          onPress={() => navigation.navigate("Sesiones")}
        />

        {/* Monitoreo desplegable → Servicios + Tokens + Calidad */}
        <TouchableOpacity
          style={[styles.item, (activeRoute === "Monitoreo" || activeRoute === "Tokens" || activeRoute === "Calidad" || activeRoute === "Saldos") ? styles.itemActive : null]}
          onPress={() => setMonOpen((v) => !v)}
        >
          <View style={styles.itemIcon}>
            <Icon name="pulse" size={18} color={(activeRoute === "Monitoreo" || activeRoute === "Tokens" || activeRoute === "Calidad" || activeRoute === "Saldos") ? colors.primary : colors.textDim} />
          </View>
          <Text style={[styles.itemText, (activeRoute === "Monitoreo" || activeRoute === "Tokens" || activeRoute === "Calidad" || activeRoute === "Saldos") ? styles.itemTextActive : null]}>
            Monitoreo
          </Text>
          <Text style={styles.chevron}>{monOpen ? "▾" : "▸"}</Text>
        </TouchableOpacity>
        {monOpen && (
          <>
            <TouchableOpacity
              style={[styles.subItem, activeRoute === "Monitoreo" ? styles.itemActive : null]}
              onPress={() => navigation.navigate("Monitoreo")}
            >
              <Text style={[styles.subText, activeRoute === "Monitoreo" ? styles.itemTextActive : null]}>Servicios</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.subItem, activeRoute === "Tokens" ? styles.itemActive : null]}
              onPress={() => navigation.navigate("Tokens")}
            >
              <Text style={[styles.subText, activeRoute === "Tokens" ? styles.itemTextActive : null]}>Tokens</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.subItem, activeRoute === "Calidad" ? styles.itemActive : null]}
              onPress={() => navigation.navigate("Calidad")}
            >
              <Text style={[styles.subText, activeRoute === "Calidad" ? styles.itemTextActive : null]}>Calidad</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.subItem, activeRoute === "Saldos" ? styles.itemActive : null]}
              onPress={() => navigation.navigate("Saldos")}
            >
              <Text style={[styles.subText, activeRoute === "Saldos" ? styles.itemTextActive : null]}>Saldos</Text>
            </TouchableOpacity>
          </>
        )}

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
        {apkDesactualizado ? (
          <View style={styles.apkAviso}>
            <Icon name="alert" size={14} color={colors.amber} />
            <Text style={styles.apkAvisoText}>
              Hay un APK nuevo (v{apkLatest}). Instalá la última versión.
            </Text>
          </View>
        ) : null}
        <TouchableOpacity style={[styles.logout, { paddingBottom: insets.bottom + 12 }]} onPress={signOut}>
          <Text style={styles.logoutText}>Salir</Text>
          <Text style={[styles.version, apkDesactualizado ? styles.versionStale : null]}>
            {APP_VERSION}
          </Text>
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
  chevron: { color: colors.textDim, fontSize: 14, marginLeft: 6 },
  subItem: { paddingVertical: 10, paddingHorizontal: 12, paddingLeft: 50, borderRadius: 10, marginBottom: 2 },
  subText: { color: colors.textDim, fontSize: 14 },
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
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 14, paddingHorizontal: 16, marginTop: 4 },
  logoutText: { color: colors.primary, fontSize: 15, fontWeight: "700" },
  version: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  versionStale: { color: colors.amber },
  apkAviso: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(245,178,61,0.12)",
    borderColor: colors.amber,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginHorizontal: 8,
    marginTop: 6,
  },
  apkAvisoText: { color: colors.amber, fontSize: 12, fontWeight: "600", flex: 1 },
});
