import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./Icon";
import { colors } from "../theme";

// Bottom-sheet para reagendar (re-disparar) un aviso por push: +30 min, +1 h, o
// "Personalizar" con un selector de día / hora / minutos 100% en JS (sin dep
// nativa → sale por OTA). El re-aviso se agenda local con expo-notifications.

const WD = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const HORAS = Array.from({ length: 24 }, (_, i) => i);
const MINUTOS = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,…,55
const DIA_MS = 86400000;

function medianoche(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dd(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// "hoy 14:30" / "mañana 09:00" / "mié 1/7 · 18:15"
export function formatWhen(d: Date): string {
  const hoy = medianoche(new Date());
  const dia = medianoche(d);
  const diffDias = Math.round((dia.getTime() - hoy.getTime()) / DIA_MS);
  const hm = `${dd(d.getHours())}:${dd(d.getMinutes())}`;
  if (diffDias === 0) return `hoy ${hm}`;
  if (diffDias === 1) return `mañana ${hm}`;
  return `${WD[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} · ${hm}`;
}

function dayLabel(d: Date, i: number): string {
  if (i === 0) return "Hoy";
  if (i === 1) return "Mañana";
  return `${WD[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

export function ReagendarSheet({
  visible,
  titulo,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  titulo: string;
  onClose: () => void;
  onConfirm: (when: Date) => void;
}) {
  const insets = useSafeAreaInsets();
  const [custom, setCustom] = useState(false);
  const [dayIdx, setDayIdx] = useState(0);
  const [hour, setHour] = useState(12);
  const [minute, setMinute] = useState(0);

  // Próximos 14 días (a medianoche local). Se recalcula al reabrir el sheet.
  const days = useMemo(
    () => Array.from({ length: 14 }, (_, i) => medianoche(new Date(Date.now() + i * DIA_MS))),
    [visible],
  );

  // Al abrir: arrancar el picker en +1 h redondeado a 5', día = hoy.
  useEffect(() => {
    if (!visible) return;
    const base = new Date(Date.now() + 60 * 60 * 1000);
    let m = Math.ceil(base.getMinutes() / 5) * 5;
    let h = base.getHours();
    if (m >= 60) {
      m = 0;
      h = (h + 1) % 24;
    }
    setCustom(false);
    setDayIdx(0);
    setHour(h);
    setMinute(m);
  }, [visible]);

  const when = useMemo(() => {
    const d = new Date(days[dayIdx] ?? medianoche(new Date()));
    d.setHours(hour, minute, 0, 0);
    return d;
  }, [days, dayIdx, hour, minute]);

  const valido = when.getTime() > Date.now() + 30 * 1000;

  const quick = (mins: number) => onConfirm(new Date(Date.now() + mins * 60000));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.header}>
            <View style={styles.headIcon}>
              <Icon name="clock" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Reagendar aviso</Text>
              {!!titulo && (
                <Text style={styles.sub} numberOfLines={1}>
                  {titulo}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Icon name="x" size={18} color={colors.textDim} />
            </TouchableOpacity>
          </View>

          {/* Opciones rápidas */}
          <View style={styles.quickRow}>
            <TouchableOpacity style={styles.quickBtn} onPress={() => quick(30)}>
              <Text style={styles.quickText}>+30 min</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickBtn} onPress={() => quick(60)}>
              <Text style={styles.quickText}>+1 hora</Text>
            </TouchableOpacity>
          </View>

          {/* Personalizar */}
          <TouchableOpacity style={styles.personalizar} onPress={() => setCustom((v) => !v)}>
            <Icon name="calendar" size={15} color={colors.text} />
            <Text style={styles.personalizarText}>Personalizar</Text>
            <Icon name={custom ? "check" : "plus"} size={14} color={colors.textDim} />
          </TouchableOpacity>

          {custom && (
            <>
              <Text style={styles.pickLabel}>DÍA</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {days.map((d, i) => {
                  const sel = i === dayIdx;
                  return (
                    <TouchableOpacity key={i} style={[styles.chip, sel && styles.chipOn]} onPress={() => setDayIdx(i)}>
                      <Text style={[styles.chipText, sel && styles.chipTextOn]}>{dayLabel(d, i)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text style={styles.pickLabel}>HORA</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {HORAS.map((h) => {
                  const sel = h === hour;
                  return (
                    <TouchableOpacity key={h} style={[styles.chipSm, sel && styles.chipOn]} onPress={() => setHour(h)}>
                      <Text style={[styles.chipText, sel && styles.chipTextOn]}>{dd(h)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text style={styles.pickLabel}>MINUTOS</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {MINUTOS.map((m) => {
                  const sel = m === minute;
                  return (
                    <TouchableOpacity key={m} style={[styles.chipSm, sel && styles.chipOn]} onPress={() => setMinute(m)}>
                      <Text style={[styles.chipText, sel && styles.chipTextOn]}>{dd(m)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={styles.preview}>
                <Icon name="bell" size={14} color={valido ? colors.primary : colors.textDim} />
                <Text style={[styles.previewText, !valido && styles.previewBad]}>
                  {valido ? `Te aviso de nuevo: ${formatWhen(when)}` : "Elegí un momento futuro"}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.confirm, !valido && styles.confirmOff]}
                disabled={!valido}
                onPress={() => onConfirm(when)}
              >
                <Text style={styles.confirmText}>Reagendar</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  headIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.primary + "26", alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: 17, fontWeight: "800" },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 2 },

  quickRow: { flexDirection: "row", gap: 10 },
  quickBtn: { flex: 1, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 15, alignItems: "center" },
  quickText: { color: colors.text, fontSize: 15, fontWeight: "700" },

  personalizar: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  personalizarText: { color: colors.text, fontSize: 15, fontWeight: "700", flex: 1 },

  pickLabel: { color: colors.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1, marginTop: 16, marginBottom: 8 },
  chipRow: { gap: 8, paddingRight: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardAlt },
  chipSm: { minWidth: 46, alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardAlt },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  chipTextOn: { color: colors.onPrimary },

  preview: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18, marginBottom: 4 },
  previewText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  previewBad: { color: colors.textDim },

  confirm: { marginTop: 14, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 15, alignItems: "center" },
  confirmOff: { opacity: 0.4 },
  confirmText: { color: colors.onPrimary, fontSize: 16, fontWeight: "800" },
});
