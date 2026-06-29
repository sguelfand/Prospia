import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./Icon";
import { colors } from "../theme";

// Reagendar (re-disparar) un aviso por push: +30 min, +1 h, o elegir día (calendario)
// y hora/minutos (ruedas arrastrables). Todo en JS (sin dep nativa → OTA). El re-aviso
// se agenda local con expo-notifications (ver programarReaviso en push.ts).

const MONO = "Sora_700Bold"; // única fuente bold cargada en la app
const WD = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DOW = ["L", "M", "M", "J", "V", "S", "D"]; // semana arranca lunes
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIA_MS = 86400000;
const ITEM = 44;
const WHEEL_H = 176;
const PAD = (WHEEL_H - ITEM) / 2;

const dd = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const clamp = (i: number, max: number) => Math.max(0, Math.min(max, i));

function medianoche(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

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

// ───────────────────────── rueda arrastrable ─────────────────────────
function Wheel({
  values,
  initial,
  onChange,
}: {
  values: string[];
  initial: number;
  onChange: (i: number) => void;
}) {
  const ref = useRef<ScrollView>(null);
  const [active, setActive] = useState(initial);

  useEffect(() => {
    const t = setTimeout(() => ref.current?.scrollTo({ y: initial * ITEM, animated: false }), 0);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const idxDe = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    clamp(Math.round(e.nativeEvent.contentOffset.y / ITEM), values.length - 1);

  return (
    <View style={styles.wheelWrap}>
      <View style={styles.band} pointerEvents="none" />
      <ScrollView
        ref={ref}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={(e) => setActive(idxDe(e))}
        onScrollEndDrag={(e) => onChange(idxDe(e))}
        onMomentumScrollEnd={(e) => onChange(idxDe(e))}
        contentContainerStyle={{ paddingVertical: PAD }}
      >
        {values.map((v, i) => (
          <View key={i} style={styles.wItem}>
            <Text style={[styles.wText, i === active && styles.wActive]}>{v}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ───────────────────────── calendario mensual ─────────────────────────
function Calendario({
  view,
  sel,
  onPrev,
  onNext,
  onPick,
}: {
  view: Date;
  sel: Date;
  onPrev: () => void;
  onNext: () => void;
  onPick: (d: Date) => void;
}) {
  const y = view.getFullYear();
  const m = view.getMonth();
  const hoy = medianoche(new Date());
  const startDow = (new Date(y, m, 1).getDay() + 6) % 7;
  const totalDias = new Date(y, m + 1, 0).getDate();
  const puedePrev = y > hoy.getFullYear() || (y === hoy.getFullYear() && m > hoy.getMonth());

  const celdas: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) celdas.push(null);
  for (let d = 1; d <= totalDias; d++) celdas.push(new Date(y, m, d));

  return (
    <View style={styles.cal}>
      <View style={styles.calHd}>
        <TouchableOpacity style={[styles.nav, !puedePrev && styles.navOff]} onPress={onPrev} disabled={!puedePrev}>
          <Text style={styles.navTxt}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.calMes}>{MESES[m]} {y}</Text>
        <TouchableOpacity style={styles.nav} onPress={onNext}>
          <Text style={styles.navTxt}>›</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.dowRow}>
        {DOW.map((d, i) => <Text key={i} style={styles.dow}>{d}</Text>)}
      </View>
      <View style={styles.grid}>
        {celdas.map((d, i) => {
          if (!d) return <View key={i} style={styles.cell} />;
          const past = d < hoy;
          const isHoy = d.getTime() === hoy.getTime();
          const isSel = sameDay(d, sel);
          return (
            <View key={i} style={styles.cell}>
              <TouchableOpacity
                disabled={past}
                onPress={() => onPick(d)}
                style={[styles.dayBtn, isHoy && styles.dayHoy, isSel && styles.daySel]}
              >
                <Text style={[styles.dayTxt, past && styles.dayPast, isSel && styles.daySelTxt]}>
                  {d.getDate()}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ───────────── contenido (monta fresco al abrir para resetear las ruedas) ─────────────
function Inner({ titulo, onClose, onConfirm }: { titulo: string; onClose: () => void; onConfirm: (w: Date) => void }) {
  const base = useMemo(() => new Date(Date.now() + 3600000), []);
  const [view, setView] = useState(() => {
    const v = new Date();
    v.setDate(1);
    v.setHours(0, 0, 0, 0);
    return v;
  });
  const [sel, setSel] = useState(() => medianoche(new Date()));
  const [hour, setHour] = useState(base.getHours());
  const [minute, setMinute] = useState(0);
  const [custom, setCustom] = useState(false); // false = opciones rápidas; true = calendario + hora

  const when = useMemo(() => {
    const d = new Date(sel);
    d.setHours(hour, minute, 0, 0);
    return d;
  }, [sel, hour, minute]);
  const valido = when.getTime() > Date.now() + 30000;

  // Paso 1: opciones rápidas + "Personalizar"
  if (!custom) {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
        <TouchableOpacity style={styles.back} onPress={onClose}>
          <Text style={styles.backTxt}>‹ Volver</Text>
        </TouchableOpacity>
        <Text style={styles.titulo}>Reagendar aviso</Text>
        {!!titulo && <Text style={styles.sub} numberOfLines={1}>{titulo}</Text>}

        <View style={[styles.quickRow, { marginTop: 16 }]}>
          <TouchableOpacity style={styles.quick} onPress={() => onConfirm(new Date(Date.now() + 30 * 60000))}>
            <Text style={styles.quickTxt}>+30 min</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quick} onPress={() => onConfirm(new Date(Date.now() + 60 * 60000))}>
            <Text style={styles.quickTxt}>+1 hora</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.personalizar} onPress={() => setCustom(true)}>
          <Icon name="calendar" size={17} color={colors.text} />
          <Text style={styles.personalizarTxt}>Personalizar</Text>
          <Text style={styles.personalizarChevron}>›</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // Paso 2: calendario + hora
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
      <TouchableOpacity style={styles.back} onPress={() => setCustom(false)}>
        <Text style={styles.backTxt}>‹ Opciones rápidas</Text>
      </TouchableOpacity>

      <View style={styles.readout}>
        <Text style={[styles.readBig, !valido && styles.readBad]}>{formatWhen(when)}</Text>
        <Text style={styles.readSmall}>{valido ? "te aviso de nuevo" : "elegí un momento futuro"}</Text>
      </View>

      <Text style={styles.lbl}>DÍA</Text>
      <Calendario
        view={view}
        sel={sel}
        onPrev={() => setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1))}
        onNext={() => setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1))}
        onPick={setSel}
      />

      <Text style={styles.lbl}>HORA · MINUTOS  (arrastrá ↑↓)</Text>
      <View style={styles.wheels}>
        <Wheel values={Array.from({ length: 24 }, (_, i) => dd(i))} initial={hour} onChange={setHour} />
        <Text style={styles.colon}>:</Text>
        <Wheel values={Array.from({ length: 60 }, (_, i) => dd(i))} initial={minute} onChange={setMinute} />
      </View>

      <TouchableOpacity
        style={[styles.confirm, !valido && styles.confirmOff]}
        disabled={!valido}
        onPress={() => onConfirm(when)}
      >
        <Text style={styles.confirmTxt}>Reagendar</Text>
      </TouchableOpacity>
    </ScrollView>
  );
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
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
          {visible && <Inner titulo={titulo} onClose={onClose} onConfirm={onConfirm} />}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 18,
    paddingTop: 12,
    maxHeight: "94%",
  },

  back: { paddingVertical: 6 },
  backTxt: { color: colors.textDim, fontSize: 14, fontWeight: "700" },
  titulo: { color: colors.text, fontSize: 18, fontWeight: "800", marginTop: 4 },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 2 },

  personalizar: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, paddingVertical: 15, paddingHorizontal: 16, borderRadius: 13, borderWidth: 1, borderColor: colors.border },
  personalizarTxt: { color: colors.text, fontSize: 15, fontWeight: "700", flex: 1 },
  personalizarChevron: { color: colors.textDim, fontSize: 22, fontWeight: "700" },

  readout: { alignItems: "center", paddingTop: 6, paddingBottom: 12 },
  readBig: { fontFamily: MONO, fontSize: 30, color: colors.primary, letterSpacing: 0.5 },
  readBad: { color: colors.textDim },
  readSmall: { color: colors.textDim, fontSize: 13, fontWeight: "600", marginTop: 2 },

  quickRow: { flexDirection: "row", gap: 10 },
  quick: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  quickTxt: { color: colors.text, fontSize: 15, fontWeight: "700" },

  lbl: { color: colors.textDim, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginTop: 16, marginBottom: 8 },

  cal: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 10 },
  calHd: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  calMes: { color: colors.text, fontWeight: "700", fontSize: 14, textTransform: "capitalize" },
  nav: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardAlt, alignItems: "center", justifyContent: "center" },
  navOff: { opacity: 0.3 },
  navTxt: { color: colors.text, fontSize: 18, fontWeight: "700", lineHeight: 20 },
  dowRow: { flexDirection: "row" },
  dow: { width: `${100 / 7}%`, textAlign: "center", color: colors.textDim, fontSize: 11, fontWeight: "700", paddingVertical: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center", padding: 2 },
  dayBtn: { width: "100%", height: "100%", borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent" },
  dayHoy: { borderColor: colors.primary },
  daySel: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayTxt: { color: colors.text, fontSize: 14, fontWeight: "600" },
  dayPast: { color: "#33415f" },
  daySelTxt: { color: colors.onPrimary, fontWeight: "800" },

  wheels: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 18, paddingHorizontal: 24, overflow: "hidden" },
  colon: { fontFamily: MONO, fontSize: 26, color: colors.textDim },
  wheelWrap: { flex: 1, maxWidth: 120, height: WHEEL_H, position: "relative" },
  band: { position: "absolute", left: 0, right: 0, top: PAD, height: ITEM, borderRadius: 11, backgroundColor: "rgba(245,178,61,0.10)", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(245,178,61,0.4)" },
  wItem: { height: ITEM, alignItems: "center", justifyContent: "center" },
  wText: { fontFamily: MONO, fontSize: 24, color: colors.textDim },
  wActive: { color: colors.text },

  confirm: { marginTop: 16, backgroundColor: colors.primary, borderRadius: 13, paddingVertical: 15, alignItems: "center" },
  confirmOff: { opacity: 0.4 },
  confirmTxt: { color: colors.onPrimary, fontSize: 16, fontWeight: "800" },
});
