import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { vozChat } from "../api";
import { useAuth } from "../auth";
import { Icon } from "./Icon";
import { colors } from "../theme";

// Modo VOZ de Sesiones (Etapa 2). FUNCIÓN A ACTIVAR: el default de la app es
// escrito; esto se abre solo si Sebi toca el micrófono.
//
// STT y TTS son módulos NATIVOS (expo-speech-recognition + expo-speech): hasta
// que salga el APK con ellos no existen en el binario, por eso el require es
// lazy y con guard — así este archivo puede viajar por OTA sin crashear.
// (STT: se cambió @react-native-voice/voice → expo-speech-recognition, la vieja
//  no compilaba con la arquitectura nueva de RN en Expo SDK 54.)
let SpeechRec: any = null;
let Speech: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SpeechRec = require("expo-speech-recognition").ExpoSpeechRecognitionModule;
} catch {}
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Speech = require("expo-speech");
} catch {}
const VOZ_DISPONIBLE = !!(SpeechRec && Speech);

type Fase = "idle" | "escuchando" | "pensando" | "hablando";

const FRASES: Record<Fase, string> = {
  idle: "Tocá la constelación y hablá",
  escuchando: "Te escucho…",
  pensando: "Pensando…",
  hablando: "",
};

export default function VozModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [fase, setFase] = useState<Fase>("idle");
  const [parcial, setParcial] = useState("");
  const [ultimoSebi, setUltimoSebi] = useState("");
  const [ultimaResp, setUltimaResp] = useState("");
  const faseRef = useRef<Fase>("idle");
  const cerradoRef = useRef(false);
  const setFaseOk = (f: Fase) => {
    faseRef.current = f;
    setFase(f);
  };

  const procesar = useCallback(
    async (texto: string, reset = false) => {
      if (!token || !texto.trim()) return;
      setUltimoSebi(texto);
      setParcial("");
      setFaseOk("pensando");
      try {
        const r = await vozChat(token, texto, reset);
        if (cerradoRef.current) return;
        setUltimaResp(r.respuesta);
        setFaseOk("hablando");
        Speech.speak(r.respuesta, {
          language: "es-AR",
          onDone: () => {
            if (!cerradoRef.current) empezarEscucha();
          },
          onStopped: () => {},
          onError: () => {
            if (!cerradoRef.current) setFaseOk("idle");
          },
        });
      } catch (e) {
        if (!cerradoRef.current) {
          setUltimaResp(e instanceof Error ? e.message : "Error");
          setFaseOk("idle");
        }
      }
    },
    [token], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const empezarEscucha = useCallback(async () => {
    if (!VOZ_DISPONIBLE || cerradoRef.current) return;
    try {
      Speech.stop();
      const permiso = await SpeechRec.requestPermissionsAsync();
      if (!permiso?.granted) {
        setUltimaResp("Necesito permiso de micrófono para escucharte (Ajustes → Prospia).");
        setFaseOk("idle");
        return;
      }
      SpeechRec.start({ lang: "es-AR", interimResults: true, continuous: false });
      setFaseOk("escuchando");
    } catch {
      setFaseOk("idle");
    }
  }, []);

  const pararTodo = useCallback(() => {
    try {
      SpeechRec?.stop?.();
      SpeechRec?.abort?.();
      Speech?.stop?.();
    } catch {}
  }, []);

  useEffect(() => {
    if (!visible || !VOZ_DISPONIBLE) return;
    cerradoRef.current = false;
    // expo-speech-recognition emite eventos como EventEmitter nativo.
    const subs: { remove: () => void }[] = [];
    subs.push(
      SpeechRec.addListener("result", (e: any) => {
        const texto = e?.results?.[0]?.transcript ?? "";
        if (faseRef.current !== "escuchando") return;
        if (e?.isFinal) {
          if (texto) procesar(texto);
        } else {
          setParcial(texto);
        }
      }),
    );
    subs.push(
      SpeechRec.addListener("error", () => {
        if (faseRef.current === "escuchando") setFaseOk("idle");
      }),
    );
    return () => {
      cerradoRef.current = true;
      subs.forEach((s) => s.remove?.());
      pararTodo();
    };
  }, [visible, procesar, pararTodo]);

  const onOrbe = () => {
    if (fase === "escuchando") {
      SpeechRec.stop();
      setFaseOk("idle");
    } else if (fase === "hablando") {
      Speech.stop();
      empezarEscucha();
    } else if (fase === "idle") {
      empezarEscucha();
    }
  };

  const cerrar = () => {
    cerradoRef.current = true;
    pararTodo();
    setFaseOk("idle");
    setParcial("");
    onClose();
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={cerrar}>
      <View style={[styles.wrap, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.header}>
          <Text style={styles.titulo}>Modo voz</Text>
          <TouchableOpacity onPress={cerrar} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="x" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {!VOZ_DISPONIBLE ? (
          <View style={styles.gate}>
            <Icon name="mic" size={40} color={colors.textDim} />
            <Text style={styles.gateTxt}>
              El modo voz necesita el próximo APK (micrófono y voz son módulos nativos).
              Ya está en la cola de builds — cuando se instale, esto se activa solo.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.centro}>
              <TouchableOpacity activeOpacity={0.8} onPress={onOrbe}>
                <Orbe fase={fase} />
              </TouchableOpacity>
              <Text style={styles.faseTxt}>
                {fase === "escuchando" && parcial ? `"${parcial}"` : FRASES[fase]}
              </Text>
              {fase === "pensando" ? <ActivityIndicator color={colors.primary} /> : null}
            </View>

            <View style={styles.transcript}>
              {ultimoSebi ? (
                <Text style={styles.lineaSebi} numberOfLines={2}>
                  Vos: {ultimoSebi}
                </Text>
              ) : null}
              {ultimaResp ? (
                <Text style={styles.lineaResp} numberOfLines={6}>
                  {ultimaResp}
                </Text>
              ) : null}
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

// ── Orbe: el isotipo constelación de Prospia latiendo según la fase ──────────

const NODOS = [
  { x: 60, y: 18 },
  { x: 96, y: 44 },
  { x: 84, y: 88 },
  { x: 36, y: 88 },
  { x: 24, y: 44 },
  { x: 60, y: 58 },
];
const ARISTAS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 5], [1, 5], [2, 5], [3, 5], [4, 5],
];

function Orbe({ fase }: { fase: Fase }) {
  const pulso = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    pulso.setValue(0);
    const dur = fase === "escuchando" ? 700 : fase === "hablando" ? 450 : fase === "pensando" ? 1100 : 1800;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulso, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulso, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [fase, pulso]);

  const escala = pulso.interpolate({
    inputRange: [0, 1],
    outputRange: [1, fase === "idle" ? 1.04 : 1.16],
  });
  const brillo = pulso.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const color = fase === "escuchando" ? colors.primary : fase === "hablando" ? colors.blue : colors.textDim;

  return (
    <Animated.View style={{ transform: [{ scale: escala }], opacity: brillo }}>
      <Svg width={180} height={160} viewBox="0 0 120 106">
        {ARISTAS.map(([a, b], i) => (
          <Line
            key={i}
            x1={NODOS[a].x}
            y1={NODOS[a].y}
            x2={NODOS[b].x}
            y2={NODOS[b].y}
            stroke={color}
            strokeWidth={1.2}
            opacity={0.5}
          />
        ))}
        {NODOS.map((n, i) => (
          <Circle key={i} cx={n.x} cy={n.y} r={i === 5 ? 7 : 4.5} fill={color} />
        ))}
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titulo: { color: colors.text, fontSize: 17, fontWeight: "700" },
  centro: { flex: 1, alignItems: "center", justifyContent: "center", gap: 22 },
  faseTxt: { color: colors.textDim, fontSize: 15, textAlign: "center", minHeight: 22 },
  transcript: { gap: 8, paddingBottom: 8 },
  lineaSebi: { color: colors.textDim, fontSize: 13 },
  lineaResp: { color: colors.text, fontSize: 15, lineHeight: 21 },
  gate: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 24 },
  gateTxt: { color: colors.textDim, fontSize: 14, textAlign: "center", lineHeight: 21 },
});
