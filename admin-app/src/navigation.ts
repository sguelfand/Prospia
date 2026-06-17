import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type RootStackParamList = {
  Login: undefined;
  Clientes: undefined;
  Avisos: undefined;
  ClienteDetail: { tenantId: number; nombre: string };
};

export type ClientesProps = NativeStackScreenProps<RootStackParamList, "Clientes">;
export type AvisosProps = NativeStackScreenProps<RootStackParamList, "Avisos">;
export type ClienteDetailProps = NativeStackScreenProps<RootStackParamList, "ClienteDetail">;
