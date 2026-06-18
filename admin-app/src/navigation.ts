import type { DrawerScreenProps } from "@react-navigation/drawer";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { EtiguelMirrorItem, ProspectRow } from "./api";

// ── Área autenticada: Drawer (menú lateral) ──────────────────────────────────
// El menú lista el Dashboard (home) + cada cliente. ClienteView y ProspectDetail
// no se muestran como ítems del menú: se llegan navegando desde la lista.
export type DrawerParamList = {
  Dashboard: undefined;
  ClienteView: { tenantId: number; nombre: string; fuente: string };
  ProspectDetail: {
    tenantId: number;
    clienteNombre: string;
    prospect: ProspectRow;
  };
  EtiguelMirrorDetail: { item: EtiguelMirrorItem };
  Errores: undefined;
  Avisos: undefined;
};

// ── Área no autenticada ──────────────────────────────────────────────────────
export type AuthStackParamList = {
  Login: undefined;
};

export type DashboardProps = DrawerScreenProps<DrawerParamList, "Dashboard">;
export type ClienteViewProps = DrawerScreenProps<DrawerParamList, "ClienteView">;
export type ProspectDetailProps = DrawerScreenProps<DrawerParamList, "ProspectDetail">;
export type EtiguelMirrorDetailProps = DrawerScreenProps<DrawerParamList, "EtiguelMirrorDetail">;
export type ErroresProps = DrawerScreenProps<DrawerParamList, "Errores">;
export type AvisosProps = DrawerScreenProps<DrawerParamList, "Avisos">;
export type LoginProps = NativeStackScreenProps<AuthStackParamList, "Login">;
