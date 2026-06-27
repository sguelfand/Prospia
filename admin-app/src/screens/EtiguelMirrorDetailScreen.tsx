import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { MensajeRow, TokenConvCosto, bloquearEtiguelMirror, desbloquearEtiguelMirror, getConversacionCosto, getEtiguelMirrorMensajes } from "../api";
import { useAuth } from "../auth";
import { CollapsibleSection, Loader } from "../components/ui";
import { EtiguelMirrorDetailProps } from "../navigation";
import { Icon, IconText } from "../components/Icon";
import { colors } from "../theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function EtiguelMirrorDetailScreen({ route, navigation }: EtiguelMirrorDetailProps) {
  const insets = useSafeAreaInsets();
  const { item } = route.params;
  const { token } = useAuth();
  const [mensajes, setMensajes] = useState<MensajeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bloqueado, setBloqueado] = useState(!!item.bloqueado);
  const [bloqueando, setBloqueando] = useState(false);
  const [costo, setCosto] = useState<TokenConvCosto | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: item.nombre ?? "Conversación" });
  }, [navigation, item.nombre]);

  // El detalle vive en un Drawer navigator → reusa UNA sola instancia del screen
  // (al navegar a otro lead solo cambian los params, no se remonta). Sin esto, el
  // estado `bloqueado` se quedaba con el valor del lead anterior y mostraba
  // "Desbloquear" en contactos que no estaban bloqueados. Re-sincronizamos por item.
  useEffect(() => {
    setBloqueado(!!item.bloqueado);
    setBloqueando(false);
    setCosto(null);
  }, [item.id, item.bloqueado]);

  const toggleBloqueo = useCallback(() => {
    if (!token || bloqueando) return;
    const nombre = item.nombre ?? item.telefono ?? "este contacto";
    const accion = bloqueado ? "Desbloquear" : "Bloquear";
    const mensaje = bloqueado
      ? `Camila va a volver a atender a ${nombre}.`
      : `Camila no va a escuchar ni responder más a ${nombre}, y no se lo va a contactar.`;
    Alert.alert(`${accion} contacto`, mensaje, [
      { text: "Cancelar", style: "cancel" },
      {
        text: accion,
        style: bloqueado ? "default" : "destructive",
        onPress: async () => {
          setBloqueando(true);
          try {
            const res = bloqueado
              ? await desbloquearEtiguelMirror(token, item.id)
              : await bloquearEtiguelMirror(token, item.id);
            setBloqueado(res.bloqueado);
            Alert.alert(
              res.bloqueado ? "Bloqueado ✓" : "Desbloqueado ✓",
              res.bloqueado
                ? "El número entró a la lista negra. Camila ya no lo escucha ni le responde."
                : "El número salió de la lista negra. Camila vuelve a atenderlo."
            );
          } catch (e: any) {
            Alert.alert("No se pudo", String(e?.message ?? e));
          } finally {
            setBloqueando(false);
          }
        },
      },
    ]);
  }, [token, bloqueando, bloqueado, item.id, item.nombre, item.telefono]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setMensajes(await getEtiguelMirrorMensajes(token, item.id));
    } catch {
      // sin mensajes / error aislado
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // Costo de esta conversación (mismo dato del monitor, en vivo, best-effort).
    if (item.telefono) {
      try { setCosto(await getConversacionCosto(token, item.telefono)); } catch { /* sin costo */ }
    }
  }, [token, item.id, item.telefono]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
      }
    >
      <View style={styles.headerCard}>
        <TouchableOpacity
          style={[styles.blockBtn, bloqueado ? styles.blockBtnOn : styles.blockBtnOff]}
          onPress={toggleBloqueo}
          disabled={bloqueando}
          activeOpacity={0.8}
        >
          {bloqueando ? (
            <ActivityIndicator size="small" color={bloqueado ? colors.primary : colors.red} />
          ) : (
            <>
              <Icon name="lock" size={15} color={bloqueado ? colors.primary : colors.red} />
              <Text style={[styles.blockBtnText, { color: bloqueado ? colors.primary : colors.red }]}>
                {bloqueado ? "Desbloquear" : "Bloquear"}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.headerRow}>
          <Text style={styles.nombre}>{item.nombre ?? "(sin nombre)"}</Text>
          <Text style={styles.tag}>{item.tipo === "lead" ? "Lead" : "Prospect"}</Text>
        </View>
        {bloqueado ? (
          <View style={styles.bloqueadoBadge}>
            <Icon name="lock" size={12} color={colors.red} />
            <Text style={styles.bloqueadoBadgeText}>Bloqueado — Camila no lo atiende</Text>
          </View>
        ) : null}
        {item.estado ? <Text style={styles.meta}>Estado: {item.estado}</Text> : null}
        {item.telefono ? <IconText name="phone" text={item.telefono} size={14} textStyle={{ fontSize: 13, marginTop: 4 }} /> : null}
        {item.email ? <IconText name="mail" text={item.email} size={14} textStyle={{ fontSize: 13, marginTop: 4 }} /> : null}
        <IconText
          name="calendar"
          text={item.prox_contacto ? `Próximo contacto: ${item.prox_contacto}` : "Próximo contacto: sin agendar"}
          size={14}
          color={item.prox_contacto ? colors.primary : colors.textDim}
          textStyle={{ fontSize: 13, marginTop: 4 }}
        />
        {item.telefono ? (
          <IconText
            name="tag"
            text={
              costo?.resumen
                ? `Costo conversación: $${costo.resumen.costo.toFixed(3)} · ${costo.resumen.turnos} resp`
                : "Costo conversación: calculando…"
            }
            size={14}
            color={costo?.resumen ? colors.amber : colors.textDim}
            textStyle={{ fontSize: 13, marginTop: 4 }}
          />
        ) : null}
      </View>

      <CollapsibleSection title="Conversación con Camila" count={mensajes.length}>
        {loading ? (
          <Loader />
        ) : mensajes.length === 0 ? (
          <Text style={styles.empty}>Todavía no hay mensajes espejados.</Text>
        ) : (
          mensajes.map((m) => <Burbuja key={m.id} mensaje={m} />)
        )}
      </CollapsibleSection>
    </ScrollView>
  );
}

function Burbuja({ mensaje }: { mensaje: MensajeRow }) {
  const out = mensaje.direccion === "out";
  return (
    <View style={[styles.burbujaRow, out ? styles.burbujaRowOut : styles.burbujaRowIn]}>
      <View style={[styles.burbuja, out ? styles.burbujaOut : styles.burbujaIn]}>
        <Text style={styles.burbujaTexto}>{mensaje.texto}</Text>
        <Text style={styles.burbujaFecha}>{fmtHora(mensaje.fecha)}</Text>
      </View>
    </View>
  );
}

function fmtHora(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 12, paddingBottom: 40 },
  headerCard: { backgroundColor: colors.card, borderRadius: 12, padding: 14 },
  blockBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    alignSelf: "flex-end", borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 7, minWidth: 130, minHeight: 34, marginBottom: 10,
  },
  blockBtnOff: { borderColor: colors.red },
  blockBtnOn: { borderColor: colors.primary, backgroundColor: colors.primary + "1A" },
  blockBtnText: { fontSize: 13, fontWeight: "700" },
  bloqueadoBadge: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6,
    alignSelf: "flex-start", borderRadius: 6, backgroundColor: colors.red + "1A",
    paddingHorizontal: 8, paddingVertical: 4,
  },
  bloqueadoBadgeText: { color: colors.red, fontSize: 12, fontWeight: "700" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  nombre: { color: colors.text, fontSize: 18, fontWeight: "800", flex: 1, marginRight: 8 },
  tag: { color: colors.amber, fontSize: 11, fontWeight: "700", borderColor: colors.amber, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  meta: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  empty: { color: colors.textDim },

  burbujaRow: { flexDirection: "row", marginBottom: 8 },
  burbujaRowIn: { justifyContent: "flex-start" },
  burbujaRowOut: { justifyContent: "flex-end" },
  burbuja: { maxWidth: "82%", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  burbujaIn: { backgroundColor: colors.card, borderTopLeftRadius: 4 },
  burbujaOut: { backgroundColor: colors.primary, borderTopRightRadius: 4 },
  burbujaTexto: { color: colors.text, fontSize: 14 },
  burbujaFecha: { color: colors.textDim, fontSize: 10, marginTop: 4, alignSelf: "flex-end" },
});
