export const colors = {
  bg: "#0f172a",        // slate-900
  card: "#1e293b",      // slate-800
  cardAlt: "#334155",   // slate-700
  border: "#334155",
  text: "#f1f5f9",      // slate-100
  textDim: "#94a3b8",   // slate-400
  primary: "#6366f1",   // indigo-500
  green: "#22c55e",
  amber: "#f59e0b",
  red: "#ef4444",
  blue: "#3b82f6",
};

// Color por estado de prospect (mismo criterio visual que la web)
export const estadoColor: Record<string, string> = {
  sin_contactar: colors.textDim,
  en_cola: colors.amber,
  contactado: colors.blue,
  en_conversacion: colors.primary,
  interesado: colors.green,
  no_le_interesa: colors.red,
  cancelado: "#64748b",
  rechazado: "#64748b",  // estado propio de Etiguel (Monday)
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
