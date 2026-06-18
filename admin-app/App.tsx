import {
  DarkTheme,
  NavigationContainer,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";

import { AuthProvider, useAuth } from "./src/auth";
import { Loader } from "./src/components/ui";
import { RootStackParamList } from "./src/navigation";
import { registerForPush } from "./src/push";
import AvisosScreen from "./src/screens/AvisosScreen";
import ClienteDetailScreen from "./src/screens/ClienteDetailScreen";
import ClientesScreen from "./src/screens/ClientesScreen";
import LockScreen from "./src/screens/LockScreen";
import LoginScreen from "./src/screens/LoginScreen";
import { colors } from "./src/theme";

const Stack = createNativeStackNavigator<RootStackParamList>();
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

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
  contentStyle: { backgroundColor: colors.bg },
} as const;

function Routes() {
  const { token, loading, locked } = useAuth();

  // Registrar el dispositivo para push apenas hay sesión desbloqueada.
  useEffect(() => {
    if (token && !locked) registerForPush(token);
  }, [token, locked]);

  // Al tocar una notificación, ir al cliente del evento.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as {
        tenant_id?: number;
      };
      if (data?.tenant_id != null && navigationRef.isReady()) {
        navigationRef.navigate("Avisos");
      }
    });
    return () => sub.remove();
  }, []);

  if (loading) return <Loader />;
  if (token && locked) return <LockScreen />;

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      {token ? (
        <>
          <Stack.Screen name="Clientes" component={ClientesScreen} options={{ title: "Clientes" }} />
          <Stack.Screen name="Avisos" component={AvisosScreen} options={{ title: "Avisos" }} />
          <Stack.Screen name="ClienteDetail" component={ClienteDetailScreen} options={{ title: "" }} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer theme={navTheme} ref={navigationRef}>
        <StatusBar style="light" />
        <Routes />
      </NavigationContainer>
    </AuthProvider>
  );
}
