import {
  DarkTheme,
  NavigationContainer,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Sora_600SemiBold, Sora_700Bold, Sora_800ExtraBold, useFonts } from "@expo-google-fonts/sora";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { getEtiguelMirror, getProspect, setNotifPref } from "./src/api";
import { AuthProvider, useAuth } from "./src/auth";
import DrawerContent from "./src/components/DrawerContent";
import { ProspiaMark } from "./src/components/Logo";
import { Loader } from "./src/components/ui";
import { AuthStackParamList, DrawerParamList } from "./src/navigation";
import { getCachedExpoToken, getExpoTokenAsync, registerForPush } from "./src/push";
import AvisosScreen from "./src/screens/AvisosScreen";
import ClienteNotificacionesScreen from "./src/screens/ClienteNotificacionesScreen";
import ClienteViewScreen from "./src/screens/ClienteViewScreen";
import ConfiguracionScreen from "./src/screens/ConfiguracionScreen";
import DashboardScreen from "./src/screens/DashboardScreen";
import ErroresScreen from "./src/screens/ErroresScreen";
import EtiguelMirrorDetailScreen from "./src/screens/EtiguelMirrorDetailScreen";
import LockScreen from "./src/screens/LockScreen";
import LoginScreen from "./src/screens/LoginScreen";
import MonitoreoScreen from "./src/screens/MonitoreoScreen";
import NotificacionesScreen from "./src/screens/NotificacionesScreen";
import PendientesScreen from "./src/screens/PendientesScreen";
import AgendaScreen from "./src/screens/AgendaScreen";
import PerfilScreen from "./src/screens/PerfilScreen";
import PreguntasScreen from "./src/screens/PreguntasScreen";
import PreguntasClaudeScreen from "./src/screens/PreguntasClaudeScreen";
import ProspectDetailScreen from "./src/screens/ProspectDetailScreen";
import TokensScreen from "./src/screens/TokensScreen";
import CalidadScreen from "./src/screens/CalidadScreen";
import SaldosScreen from "./src/screens/SaldosScreen";
import { colors } from "./src/theme";

const Drawer = createDrawerNavigator<DrawerParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
export const navigationRef = createNavigationContainerRef<DrawerParamList>();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.card,
    text: colors.text,
    border: colors.border,
    primary: colors.primary,
  },
};

const screenOptions = {
  headerStyle: { backgroundColor: colors.card },
  headerTintColor: colors.text,
  drawerStyle: { backgroundColor: colors.card },
  sceneStyle: { backgroundColor: colors.bg },
  // Isotipo siempre arriba a la derecha, en cualquier pantalla.
  headerRight: () => (
    <View style={{ marginRight: 16 }}>
      <ProspiaMark size={26} />
    </View>
  ),
} as const;

function AppDrawer() {
  return (
    <Drawer.Navigator
      // "history": el botón atrás vuelve a la última pantalla visitada
      // (ProspectDetail → ClienteView → Dashboard), no siempre al Dashboard.
      backBehavior="history"
      screenOptions={screenOptions}
      drawerContent={(props) => <DrawerContent {...props} />}
    >
      <Drawer.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard" }} />
      <Drawer.Screen name="ClienteView" component={ClienteViewScreen} options={{ title: "" }} />
      <Drawer.Screen name="ProspectDetail" component={ProspectDetailScreen} options={{ title: "" }} />
      <Drawer.Screen name="EtiguelMirrorDetail" component={EtiguelMirrorDetailScreen} options={{ title: "" }} />
      <Drawer.Screen name="Errores" component={ErroresScreen} options={{ title: "Errores" }} />
      <Drawer.Screen name="Preguntas" component={PreguntasScreen} options={{ title: "Preguntas" }} />
      <Drawer.Screen name="PreguntasClaude" component={PreguntasClaudeScreen} options={{ title: "Preguntas de Claude" }} />
      <Drawer.Screen name="Pendientes" component={PendientesScreen} options={{ title: "Pendientes" }} />
      <Drawer.Screen name="Agenda" component={AgendaScreen} options={{ title: "Agenda" }} />
      <Drawer.Screen name="Avisos" component={AvisosScreen} options={{ title: "Avisos" }} />
      <Drawer.Screen name="Configuracion" component={ConfiguracionScreen} options={{ title: "Configuración" }} />
      <Drawer.Screen name="Perfil" component={PerfilScreen} options={{ title: "Perfil" }} />
      <Drawer.Screen name="Notificaciones" component={NotificacionesScreen} options={{ title: "Notificaciones" }} />
      <Drawer.Screen name="Monitoreo" component={MonitoreoScreen} options={{ title: "Servicios" }} />
      <Drawer.Screen name="Tokens" component={TokensScreen} options={{ title: "Tokens" }} />
      <Drawer.Screen name="Calidad" component={CalidadScreen} options={{ title: "Calidad" }} />
      <Drawer.Screen name="Saldos" component={SaldosScreen} options={{ title: "Saldos" }} />
      <Drawer.Screen name="ClienteNotificaciones" component={ClienteNotificacionesScreen} options={{ title: "" }} />
    </Drawer.Navigator>
  );
}

function Routes() {
  const { token, loading, locked } = useAuth();

  // Registrar el dispositivo para push apenas hay sesión desbloqueada.
  useEffect(() => {
    if (token && !locked) registerForPush(token);
  }, [token, locked]);

  // Al tocar una notificación, ir al feed de Avisos.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as {
        tenant_id?: number; tipo?: string; aviso_id?: number; nav?: string;
        prospect_id?: number; mirror_id?: number; cliente?: string; evento?: string;
        consulta_id?: number; pregunta_id?: number;
      };
      // Botón de acción del panel de Android: "Desactivar avisos" del push
      // claude_termino → apaga ese evento para este device (no abre nada).
      if (response.actionIdentifier === "desactivar_claude_termino") {
        (async () => {
          try {
            const expoToken = getCachedExpoToken() ?? (await getExpoTokenAsync());
            if (token && expoToken) await setNotifPref(token, expoToken, "claude_termino", false);
            else if (navigationRef.isReady()) navigationRef.navigate("Notificaciones");
          } catch { /* best-effort */ }
          // Cerrar esa notificación del panel al desactivar.
          Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => {});
        })();
        return;
      }

      if (!navigationRef.isReady()) return;
      const { nav, evento } = data ?? {};
      const avisosFallback = () =>
        data?.aviso_id != null ? navigationRef.navigate("Avisos", { avisoId: data.aviso_id }) : navigationRef.navigate("Avisos");

      // Deep-link: cada push abre la pantalla/registro donde vive lo notificado.
      (async () => {
        try {
          if (evento === "claude_termino") {
            // Tap normal en "Claude terminó" → abrir ESE aviso en la sección Avisos.
            avisosFallback();
          } else if (nav === "error" || data?.tipo === "agent_error") {
            navigationRef.navigate("Errores");
          } else if (nav === "preguntas" || data?.tipo === "consulta") {
            // Tap en el push de consulta → abrir DIRECTO la ventana de contestar.
            navigationRef.navigate("Preguntas", data?.consulta_id != null ? { consultaId: data.consulta_id } : undefined);
          } else if (nav === "pregunta_claude" || data?.tipo === "pregunta_claude" || evento === "pregunta_claude") {
            // Tap en el push de Claude → abrir DIRECTO la pantalla de opciones.
            navigationRef.navigate("PreguntasClaude", data?.pregunta_id != null ? { preguntaId: data.pregunta_id } : undefined);
          } else if (nav === "tokens" || data?.tipo === "tokens" || evento === "tokens_oportunidad") {
            navigationRef.navigate("Tokens");
          } else if (nav === "calidad" || data?.tipo === "calidad" || evento === "calidad_revision") {
            navigationRef.navigate("Calidad");
          } else if (nav === "monitoreo_servicios" || evento === "servicio_caido" || evento === "servicio_recuperado") {
            navigationRef.navigate("Monitoreo");
          } else if (nav === "pendientes" || evento === "standby" || evento === "cola_terminada" || evento === "necesita_autorizacion") {
            navigationRef.navigate("Pendientes");
          } else if ((nav === "etiguel_lead" || data?.tenant_id === -1) && data?.mirror_id != null && token) {
            const items = await getEtiguelMirror(token);
            const item = items.find((i) => i.id === data.mirror_id);
            if (item) navigationRef.navigate("EtiguelMirrorDetail", { item });
            else avisosFallback();
          } else if (nav === "prospect" && data?.prospect_id != null && data?.tenant_id != null && token) {
            const prospect = await getProspect(token, data.tenant_id, data.prospect_id);
            navigationRef.navigate("ProspectDetail", { tenantId: data.tenant_id, clienteNombre: data.cliente ?? "Cliente", prospect });
          } else {
            avisosFallback();
          }
        } catch {
          avisosFallback();
        }
      })();
    });
    return () => sub.remove();
  }, [token]);

  if (loading) return <Loader />;
  if (token && locked) return <LockScreen />;

  if (!token) {
    return (
      <AuthStack.Navigator screenOptions={{ headerShown: false }}>
        <AuthStack.Screen name="Login" component={LoginScreen} />
      </AuthStack.Navigator>
    );
  }

  return <AppDrawer />;
}

export default function App() {
  const [fontsLoaded] = useFonts({ Sora_600SemiBold, Sora_700Bold, Sora_800ExtraBold });

  if (!fontsLoaded) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
        <Loader />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <NavigationContainer theme={navTheme} ref={navigationRef}>
          <StatusBar style="light" />
          <Routes />
        </NavigationContainer>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
