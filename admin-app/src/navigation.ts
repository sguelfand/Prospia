import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type RootStackParamList = {
  Login: undefined;
  Clientes: undefined;
  ClienteDetail: { tenantId: number; nombre: string };
};

export type ClientesProps = NativeStackScreenProps<RootStackParamList, "Clientes">;
export type ClienteDetailProps = NativeStackScreenProps<RootStackParamList, "ClienteDetail">;
