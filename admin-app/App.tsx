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

import { AuthProvider, useAuth } from "./src/auth";
import DrawerContent from "./src/components/DrawerContent";
import { ProspiaMark } from "./src/components/Logo";
import { Loader } from "./src/components/ui";
import { AuthStackParamList, DrawerParamList } from "./src/navigation";
import { registerForPush } from "./src/push";
import AvisosScreen from "./src/screens/AvisosScreen";
import ClienteNotificacionesScreen from "./src/screens/ClienteNotificacionesScreen";
import ClienteViewScreen from "./src/screens/ClienteViewScreen";
import ConfiguracionScreen from "./src/screens/ConfiguracionScreen";
import DashboardScreen from "./src/screens/DashboardScreen";
import ErroresScreen from "./src/screens/ErroresScreen";
import EtiguelMirrorDetailScreen from "./src/screens/EtiguelMirrorDetailScreen";
import LockScreen from "./src/screens/LockScreen";
import LoginScreen from "./src/screens/LoginScreen";
import NotificacionesScreen from "./src/screens/NotificacionesScreen";
import PendientesScreen from "./src/screens/PendientesScreen";
import PerfilScreen from "./src/screens/PerfilScreen";
import ProspectDetailScreen from "./src/screens/ProspectDetailScreen";
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
      <Drawer.Screen name="Pendientes" component={PendientesScreen} options={{ title: "Pendientes" }} />
      <Drawer.Screen name="Avisos" component={AvisosScreen} options={{ title: "Avisos" }} />
      <Drawer.Screen name="Configuracion" component={ConfiguracionScreen} options={{ title: "Configuración" }} />
      <Drawer.Screen name="Perfil" component={PerfilScreen} options={{ title: "Perfil" }} />
      <Drawer.Screen name="Notificaciones" component={NotificacionesScreen} options={{ title: "Notificaciones" }} />
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
      const data = response.notification.request.content.data as { tenant_id?: number; tipo?: string; aviso_id?: number };
      if (!navigationRef.isReady()) return;
      if (data?.tipo === "agent_error") {
        navigationRef.navigate("Errores");
      } else if (data?.aviso_id != null) {
        // Abrir directamente ESE aviso en Avisos (deep-link).
        navigationRef.navigate("Avisos", { avisoId: data.aviso_id });
      } else if (data?.tenant_id != null) {
        navigationRef.navigate("Avisos");
      }
    });
    return () => sub.remove();
  }, []);

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
