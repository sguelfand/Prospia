import type { DrawerScreenProps } from "@react-navigation/drawer";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { EtiguelMirrorItem, ProspectRow, ProspectsFiltro } from "./api";

// ── Área autenticada: Drawer (menú lateral) ──────────────────────────────────
// El menú lista el Dashboard (home) + cada cliente. ClienteView y ProspectDetail
// no se muestran como ítems del menú: se llegan navegando desde la lista.
export type DrawerParamList = {
  Dashboard: undefined;
  ClienteView: { tenantId: number; nombre: string; fuente: string; filtroInicial?: ProspectsFiltro };
  ProspectDetail: {
    tenantId: number;
    clienteNombre: string;
    prospect: ProspectRow;
  };
  EtiguelMirrorDetail: { item: EtiguelMirrorItem };
  Errores: undefined;
  Preguntas: { consultaId?: number } | undefined;
  PreguntasClaude: { preguntaId?: number } | undefined;
  Pendientes: undefined;
  Agenda: undefined;
  Avisos: { avisoId?: number } | undefined;
  Configuracion: undefined;
  Perfil: undefined;
  Notificaciones: undefined;
  Monitoreo: undefined;
  Tokens: undefined;
  Calidad: undefined;
  Saldos: undefined;
  ClienteNotificaciones: { tenantId: number; nombre: string };
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
export type PreguntasProps = DrawerScreenProps<DrawerParamList, "Preguntas">;
export type PreguntasClaudeProps = DrawerScreenProps<DrawerParamList, "PreguntasClaude">;
export type PendientesProps = DrawerScreenProps<DrawerParamList, "Pendientes">;
export type AgendaProps = DrawerScreenProps<DrawerParamList, "Agenda">;
export type AvisosProps = DrawerScreenProps<DrawerParamList, "Avisos">;
export type ConfiguracionProps = DrawerScreenProps<DrawerParamList, "Configuracion">;
export type ClienteNotificacionesProps = DrawerScreenProps<DrawerParamList, "ClienteNotificaciones">;
export type PerfilProps = DrawerScreenProps<DrawerParamList, "Perfil">;
export type NotificacionesProps = DrawerScreenProps<DrawerParamList, "Notificaciones">;
export type MonitoreoProps = DrawerScreenProps<DrawerParamList, "Monitoreo">;
export type TokensProps = DrawerScreenProps<DrawerParamList, "Tokens">;
export type CalidadProps = DrawerScreenProps<DrawerParamList, "Calidad">;
export type SaldosProps = DrawerScreenProps<DrawerParamList, "Saldos">;
export type LoginProps = NativeStackScreenProps<AuthStackParamList, "Login">;
