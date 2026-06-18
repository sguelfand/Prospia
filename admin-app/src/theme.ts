// Sistema de marca Prospia "La señal".
// Dos paletas (dark / light) listas para el toggle de tema.
// `colors` exporta la dark por defecto para no romper los imports actuales.

export type Palette = {
  bg: string;
  card: string;
  cardAlt: string;
  border: string;
  text: string;
  textDim: string;
  primary: string;     // ámbar (acento / CTA / "la señal")
  onPrimary: string;   // texto sobre ámbar
  green: string;
  amber: string;
  red: string;
  blue: string;
};

export const dark: Palette = {
  bg: "#0C1730",       // navy
  card: "#13213C",
  cardAlt: "#1B2A47",
  border: "#243454",
  text: "#EEF3FB",     // niebla
  textDim: "#8294B4",
  primary: "#F5B23D",  // ámbar
  onPrimary: "#0C1730",
  green: "#22C55E",
  amber: "#F5B23D",
  red: "#EF4444",
  blue: "#3B82F6",
};

export const light: Palette = {
  bg: "#F6F8FC",
  card: "#FFFFFF",
  cardAlt: "#F1F5F9",
  border: "#E3E9F3",
  text: "#0C1730",
  textDim: "#64748B",
  primary: "#F5B23D",
  onPrimary: "#0C1730",
  green: "#16A34A",
  amber: "#D97706",
  red: "#DC2626",
  blue: "#2563EB",
};

export const palettes = { dark, light };

// Paleta activa por defecto (la app es dark). El toggle de tema podrá
// intercambiarla vía contexto en un próximo paso.
export const colors = dark;

// Color por estado de prospect (mismo criterio visual que la web)
export const estadoColor: Record<string, string> = {
  sin_contactar: "#8294B4",
  en_cola: "#F5B23D",        // ámbar
  contactado: "#3B82F6",     // azul
  en_conversacion: "#8B5CF6", // violeta (distinto de en_cola)
  interesado: "#22C55E",     // verde
  no_le_interesa: "#EF4444", // rojo
  cancelado: "#64748B",
  rechazado: "#64748B",      // estado propio de Etiguel (Monday)
};

export const estadoLabel: Record<string, string> = {
  sin_contactar: "Sin contactar",
  en_cola: "En cola",
  contactado: "Contactado",
  en_conversacion: "En conversación",
  interesado: "Interesado",
  no_le_interesa: "No le interesa",
  cancelado: "Cancelado",
  rechazado: "Rechazado",
};
