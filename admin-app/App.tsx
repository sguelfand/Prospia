import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import React from "react";

import { AuthProvider, useAuth } from "./src/auth";
import { Loader } from "./src/components/ui";
import { RootStackParamList } from "./src/navigation";
import ClienteDetailScreen from "./src/screens/ClienteDetailScreen";
import ClientesScreen from "./src/screens/ClientesScreen";
import LoginScreen from "./src/screens/LoginScreen";
import { colors } from "./src/theme";

const Stack = createNativeStackNavigator<RootStackParamList>();

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
  const { token, loading } = useAuth();

  if (loading) return <Loader />;

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      {token ? (
        <>
          <Stack.Screen name="Clientes" component={ClientesScreen} options={{ title: "Clientes" }} />
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
      <NavigationContainer theme={navTheme}>
        <StatusBar style="light" />
        <Routes />
      </NavigationContainer>
    </AuthProvider>
  );
}
