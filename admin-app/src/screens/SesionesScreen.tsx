import { useIsFocused } from "@react-navigation/native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  PreguntaClaude,
  SesionClaude,
  SesionDetalle,
  SesionMensaje,
  continuarSesion,
  enviarMensajeSesion,
  getPreguntasClaude,
  getSesionMensajes,
  getSesiones,
  nuevaSesionClaude,
} from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import { ErrorBox, Loader } from "../components/ui";
import VozModal from "../components/VozModal";
import { DetalleModal } from "./PreguntasClaudeScreen";
import { SesionesProps } from "../navigation";
import { colors } from "../theme";

// Pantalla "Sesiones": espejo en vivo de las sesiones de Claude Code en la Mac
// (vía mac-bridge). Lista con estado + chat por sesión + crear sesión nueva.
// Polling corto solo con la pantalla en foco (patrón ErroresScreen).

const ESTADOS: Record<string, { label: string; color: string }> = {
  procesando: { label: "Procesando…", color: colors.blue },
  esperando: { label: "Te espera", color: colors.amber },
  pregunta: { label: "Pregunta", color: colors.amber },
  idle: { label: "Al día", color: colors.green },
};

function horaCorta(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const hoy = new Date();
  const esHoy = d.toDateString() === hoy.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return esHoy ? hm : `${d.getDate()}/${d.getMonth() + 1} ${hm}`;
}

function useAlturaTeclado(): number {
  const [altura, setAltura] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", (e) =>
      setAltura(e.endCoordinates?.height ?? 0),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => setAltura(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return altura;
}

export default function SesionesScreen({ navigation, route }: SesionesProps) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();

  const [macOnline, setMacOnline] = useState(true);
  const [sesiones, setSesiones] = useState<SesionClaude[]>([]);
  const [proyectos, setProyectos] = useState<{ ruta: string; nombre: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [abierta, setAbierta] = useState<string | null>(null); // sesion_id del chat abierto
  const [nuevaVisible, setNuevaVisible] = useState(false);
  const [vozVisible, setVozVisible] = useState(false); // modo voz: SE ACTIVA, el default es escrito

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getSesiones(token);
      setMacOnline(data.mac_online);
      setSesiones(data.sesiones.filter((s) => !("oculta" in s) || !(s as any).oculta));
      setProyectos(data.proyectos || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Polling de la lista cada 5s mientras la pantalla está en foco y sin chat abierto.
  useEffect(() => {
    if (!isFocused || abierta) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [isFocused, abierta, load]);

  // Deep-link desde un push: abrir directo el chat de esa sesión. Limpiamos el
  // param al consumirlo (si no, tocar la MISMA notif dos veces no reabre: el
  // param no cambia y el efecto no vuelve a correr).
  useEffect(() => {
    const sid = route.params?.sesionId;
    if (!sid) return;
    setAbierta(sid);
    navigation.setParams({ sesionId: undefined });
  }, [route.params?.sesionId, navigation]);

  if (loading) return <Loader />;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.primary}
          />
        }
      >
        {!macOnline ? (
          <View style={styles.offline}>
            <Icon name="alert" size={16} color={colors.amber} />
            <Text style={styles.offlineTxt}>
              Mac offline — el puente no está conectado. Se ve lo último conocido.
            </Text>
          </View>
        ) : null}
        {error ? <ErrorBox message={error} onRetry={load} /> : null}

        {sesiones.length === 0 && !error ? (
          <Text style={styles.vacio}>
            No hay sesiones de Claude activas en la Mac (últimos 3 días).
          </Text>
        ) : null}

        {sesiones.map((s) => {
          const est = ESTADOS[s.estado] || ESTADOS.idle;
          return (
            <TouchableOpacity key={s.id} style={styles.card} onPress={() => setAbierta(s.id)}>
              <View style={styles.cardTop}>
                <View style={[styles.dot, { backgroundColor: est.color }]} />
                <Text style={styles.titulo} numberOfLines={1}>
                  {s.titulo}
                </Text>
                <Text style={styles.hora}>{horaCorta(s.ultima_actividad)}</Text>
              </View>
              <View style={styles.cardMeta}>
                <Text style={[styles.estado, { color: est.color }]}>{est.label}</Text>
                <Text style={styles.proyecto} numberOfLines={1}>
                  {s.proyecto}
                  {s.branch ? ` · ${s.branch}` : ""}
                </Text>
                {s.interactivo ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeTxt}>interactiva</Text>
                  </View>
                ) : null}
              </View>
              {s.preview ? (
                <Text style={styles.preview} numberOfLines={2}>
                  {s.preview}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Modo voz (función a activar; el default es escrito) */}
      <TouchableOpacity
        style={[styles.fab, styles.fabVoz, { bottom: insets.bottom + 88 }]}
        onPress={() => setVozVisible(true)}
      >
        <Icon name="mic" size={22} color={colors.primary} strokeWidth={2.2} />
      </TouchableOpacity>

      {/* Nueva sesión */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
        onPress={() => setNuevaVisible(true)}
      >
        <Icon name="plus" size={24} color={colors.onPrimary} strokeWidth={2.5} />
      </TouchableOpacity>

      <VozModal visible={vozVisible} onClose={() => setVozVisible(false)} />

      {abierta ? (
        <ChatModal
          sesionId={abierta}
          onClose={() => {
            setAbierta(null);
            load();
          }}
          onIrAPregunta={() => {
            setAbierta(null);
            navigation.navigate("PreguntasClaude");
          }}
        />
      ) : null}

      <NuevaSesionModal
        visible={nuevaVisible}
        proyectos={proyectos}
        macOnline={macOnline}
        onClose={(creada) => {
          setNuevaVisible(false);
          if (creada) load();
        }}
      />
    </View>
  );
}

// ── Chat de una sesión ────────────────────────────────────────────────────────

function ChatModal({
  sesionId,
  onClose,
  onIrAPregunta,
}: {
  sesionId: string;
  onClose: () => void;
  onIrAPregunta: () => void;
}) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [detalle, setDetalle] = useState<SesionDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  // Mensajes ya mandados (entregados al TUI de la Mac) que todavía no aparecen en
  // el transcript porque Claude está procesando y los levanta cuando puede. Se
  // encolan varios seguidos, igual que tipeando en la Mac mientras procesa.
  const [pendientes, setPendientes] = useState<string[]>([]);
  const [continuando, setContinuando] = useState(false);
  const listRef = useRef<FlatList<SesionMensaje>>(null);
  const teclado = useAlturaTeclado();
  // Pregunta pendiente de ESTA sesión → popup en la conversación (misma
  // estética/mecanismo que la pantalla Preguntas de Claude: reusa DetalleModal).
  const [pregunta, setPregunta] = useState<PreguntaClaude | null>(null);
  const descartadaRef = useRef<number | null>(null); // si la cerró, no re-abrir sola
  const esNativaRef = useRef(false); // pregunta sin pendiente en el backend (cajita nativa)
  const supresionRef = useRef(0);    // tras responder, no re-abrir el popup unos seg

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const d = await getSesionMensajes(token, sesionId);
      setDetalle(d);
      setError(null);
      if (d.estado === "pregunta") {
        try {
          const pendQ = (await getPreguntasClaude(token)).filter((q) => q.estado === "pendiente");
          const texto = (d.pregunta_texto || "").trim();
          const match =
            pendQ.find((q) => (q.preguntas?.[0]?.pregunta || q.pregunta || "").trim() === texto) ||
            pendQ[0] ||
            null;
          esNativaRef.current = !match;
          // Sin pendiente en el backend = pregunta NATIVA (cajita de la Mac,
          // switch "Preguntas al cel" apagado): popup con la tanda que manda
          // el bridge en pregunta_items. Antes esto dejaba el banner apuntando
          // a la pantalla de Preguntas vacía.
          let elegida: PreguntaClaude | null = match;
          if (!match) {
            const items = d.pregunta_items?.length
              ? d.pregunta_items
              : texto
                ? [{ pregunta: texto, opciones: [], header: null, multiselect: false }]
                : [];
            elegida = items.length
              ? {
                  id: -1,
                  preguntas: items,
                  respuestas: null,
                  contexto: null,
                  estado: "pendiente",
                  fecha: "",
                  fecha_respuesta: null,
                  header: items[0].header,
                  pregunta: items[0].pregunta,
                  elegida: null,
                }
              : null;
          }
          const suprimida = Date.now() < supresionRef.current;
          setPregunta(elegida && !suprimida && descartadaRef.current !== elegida.id ? elegida : null);
        } catch {}
      } else {
        setPregunta(null);
        descartadaRef.current = null;
        supresionRef.current = 0;
      }
      // Sacar de la cola los que ya cayeron en el transcript (Claude los levantó).
      setPendientes((ps) =>
        ps.filter(
          (p) => !d.mensajes.some((m) => m.rol === "sebi" && m.texto.trim() === p.trim()),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    }
  }, [token, sesionId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);

  const enviar = async () => {
    const t = texto.trim();
    if (!t || !token || enviando) return;
    setEnviando(true);
    try {
      await enviarMensajeSesion(token, sesionId, t);
      // Entregado al TUI: lo muestro como enviado al toque (aunque Claude esté
      // procesando y lo levante después). Podés mandar varios seguidos.
      setPendientes((ps) => [...ps, t]);
      setTexto("");
      load();
    } catch (e) {
      Alert.alert("No se pudo mandar", e instanceof Error ? e.message : "Error");
    } finally {
      setEnviando(false);
    }
  };

  const continuar = () => {
    Alert.alert(
      "Continuar desde el cel",
      "La sesión se reabre en tmux en la Mac y pasa a ser interactiva desde acá. " +
        "Tarda unos segundos (abre la ventana y Claude resume la conversación).",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Dale",
          onPress: async () => {
            if (!token) return;
            setContinuando(true);
            try {
              await continuarSesion(token, sesionId);
              // NO cerramos el chat: si mantuvo el id, este mismo chat pasa a
              // interactivo solo (el bridge fuerza el delta y el polling lo ve).
              // Si forkeó, esta sesión llega "oculta" y load() cierra a la lista
              // para entrar a la nueva. El spinner sigue hasta ahí.
            } catch (e) {
              setContinuando(false);
              Alert.alert("No se pudo continuar", e instanceof Error ? e.message : "Error");
            }
          },
        },
      ],
    );
  };

  // Cierre del "continuando": cuando la sesión ya es interactiva (mantuvo el
  // id) o quedó oculta (forkeó → volvemos a la lista a entrar a la nueva).
  useEffect(() => {
    if (!continuando || !detalle) return;
    if (detalle.interactivo) setContinuando(false);
    else if ((detalle as any).oculta) {
      setContinuando(false);
      onClose();
    }
  }, [continuando, detalle?.interactivo, (detalle as any)?.oculta]);

  // Pregunta NATIVA: la respuesta viaja como teclas al TUI en tmux — el número
  // de la opción (o el de "Other" + texto libre), una pregunta por vez.
  const responderNativa = async (respuestas: string[]) => {
    if (!token) throw new Error("Sin sesión.");
    const items = pregunta?.id === -1 ? pregunta.preguntas : [];
    const entradas = respuestas.map((r, i) => {
      const ops = items[i]?.opciones || [];
      const idx = ops.findIndex((o) => o.label === r);
      return idx >= 0 ? { n: idx + 1 } : { n: ops.length + 1, texto: r };
    });
    await enviarMensajeSesion(token, sesionId, "/respuestas " + JSON.stringify(entradas));
  };

  // Casos donde la nativa NO se puede contestar desde el cel → popup informativo.
  const nativaBloqueada =
    pregunta?.id !== -1
      ? undefined
      : detalle && !detalle.interactivo
        ? "Esta sesión no es interactiva desde el cel: respondé la pregunta en la Mac. " +
          "Tip: con el switch \"Preguntas al cel\" prendido, las preguntas te llegan al celular."
        : pregunta.preguntas.some((q) => q.multiselect)
          ? "Esta pregunta permite elegir varias opciones: respondela en la Mac."
          : !pregunta.preguntas.some((q) => q.opciones?.length)
            ? "No llegaron las opciones de esta pregunta: respondela en la Mac (o por el chat con /key 1, /key 2…)."
            : undefined;

  // Botón "Cerrar tmux" (solo sesiones interactivas): manda /exit al TUI.
  // La conversación queda en el transcript y se retoma desde el Historial
  // del panel (relojito) con todo el contexto.
  const cerrarTmux = () => {
    Alert.alert(
      "Cerrar tmux",
      (detalle?.estado === "procesando"
        ? "⚠ La sesión está procesando: si la cerrás ahora se corta el turno en curso.\n\n"
        : "") +
        "Se manda /exit y la sesión se cierra en la Mac (desaparece de esta lista). " +
        "La conversación queda guardada: la retomás en el panel desde el Historial (relojito).",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Cerrar tmux",
          style: "destructive",
          onPress: async () => {
            if (!token) return;
            try {
              await enviarMensajeSesion(token, sesionId, "/exit");
              onClose();
            } catch (e) {
              Alert.alert("No se pudo cerrar", e instanceof Error ? e.message : "Error");
            }
          },
        },
      ],
    );
  };

  const mensajes = detalle ? [...detalle.mensajes].reverse() : [];
  const est = detalle ? ESTADOS[detalle.estado] || ESTADOS.idle : null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.chatWrap, { paddingTop: insets.top }]}
      >
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="x" size={22} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginHorizontal: 10 }}>
            <Text style={styles.chatTitulo} numberOfLines={1}>
              {detalle?.titulo || "Sesión"}
            </Text>
            {est ? (
              <Text style={[styles.chatEstado, { color: est.color }]}>
                {est.label}
                {detalle && !detalle.mac_online ? " · Mac offline" : ""}
              </Text>
            ) : null}
          </View>
          {detalle?.estado === "procesando" ? (
            <ActivityIndicator size="small" color={colors.blue} />
          ) : null}
          {detalle?.interactivo && detalle.mac_online ? (
            <TouchableOpacity
              onPress={cerrarTmux}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ marginLeft: 12 }}
            >
              <Icon name="terminal" size={20} color={colors.red} />
            </TouchableOpacity>
          ) : null}
        </View>

        {error ? <ErrorBox message={error} onRetry={load} /> : null}

        {detalle?.estado === "pregunta" && !pregunta ? (
          <TouchableOpacity
            style={styles.preguntaBanner}
            onPress={() => {
              descartadaRef.current = null;
              supresionRef.current = 0;
              // Nativa: reabrir el popup acá mismo (en la pantalla Preguntas
              // no existe). Con pendiente del backend: ir a esa pantalla.
              if (esNativaRef.current) load();
              else onIrAPregunta();
            }}
          >
            <Icon name="flag" size={16} color={colors.onPrimary} />
            <Text style={styles.preguntaBannerTxt}>
              Claude te hizo una pregunta — tocá para responder
            </Text>
          </TouchableOpacity>
        ) : null}

        <FlatList
          ref={listRef}
          inverted
          data={mensajes}
          keyExtractor={(m) => String(m.seq)}
          contentContainerStyle={styles.chatLista}
          renderItem={({ item }) => <Burbuja m={item} />}
          ListHeaderComponent={
            pendientes.length ? (
              <>
                {pendientes
                  .filter(
                    (p) => !mensajes.some((m) => m.rol === "sebi" && m.texto.trim() === p.trim()),
                  )
                  .map((p, i) => (
                    <Burbuja
                      key={`pend-${i}`}
                      m={{ seq: -(i + 1), rol: "sebi", texto: p, hora: "" }}
                      entregado
                    />
                  ))}
              </>
            ) : null
          }
        />

        <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 10) + teclado }]}>
          {detalle && !detalle.interactivo ? (
            <TouchableOpacity
              style={styles.continuarBtn}
              onPress={continuar}
              disabled={continuando || !detalle.mac_online}
            >
              {continuando ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                  <Text style={styles.continuarTxt}>Abriendo en tmux…</Text>
                </View>
              ) : (
                <Text style={styles.continuarTxt}>
                  {detalle.mac_online
                    ? "▶ Continuar desde el cel (se reabre en tmux)"
                    : "Mac offline"}
                </Text>
              )}
            </TouchableOpacity>
          ) : (
            <>
              <TextInput
                style={styles.input}
                value={texto}
                onChangeText={setTexto}
                placeholder="Escribile a Claude…"
                placeholderTextColor={colors.textDim}
                multiline
              />
              <TouchableOpacity
                style={[styles.enviarBtn, (!texto.trim() || enviando) && { opacity: 0.4 }]}
                onPress={enviar}
                disabled={!texto.trim() || enviando}
              >
                {enviando ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Icon name="send" size={18} color={colors.onPrimary} />
                )}
              </TouchableOpacity>
            </>
          )}
        </View>

        <DetalleModal
          pregunta={pregunta}
          token={token}
          responder={pregunta?.id === -1 ? responderNativa : undefined}
          soloLectura={pregunta?.id === -1 ? nativaBloqueada : undefined}
          onClose={() => {
            if (pregunta) descartadaRef.current = pregunta.id;
            setPregunta(null);
          }}
          onResuelta={() => {
            // La respuesta tarda unos seg en caer al transcript (estado sigue
            // "pregunta"): no re-abrir el popup mientras tanto.
            supresionRef.current = Date.now() + 10000;
            setPregunta(null);
            load();
          }}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Burbuja({ m, entregado }: { m: SesionMensaje; entregado?: boolean }) {
  if (m.rol === "tool") {
    return (
      <Text style={styles.tool} numberOfLines={2}>
        ⚙ {m.texto}
      </Text>
    );
  }
  const esSebi = m.rol === "sebi";
  return (
    <View style={[styles.burbuja, esSebi ? styles.burbujaSebi : styles.burbujaClaude]}>
      <Text style={esSebi ? styles.burbujaSebiTxt : styles.burbujaClaudeTxt}>{m.texto}</Text>
      <Text style={[styles.burbujaHora, esSebi && { color: "rgba(12,23,48,0.55)" }]}>
        {entregado ? "✓ enviado" : horaCorta(m.hora)}
      </Text>
    </View>
  );
}

// ── Nueva sesión ──────────────────────────────────────────────────────────────

function NuevaSesionModal({
  visible,
  proyectos,
  macOnline,
  onClose,
}: {
  visible: boolean;
  proyectos: { ruta: string; nombre: string }[];
  macOnline: boolean;
  onClose: (creada: boolean) => void;
}) {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [ruta, setRuta] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [creando, setCreando] = useState(false);
  const teclado = useAlturaTeclado();

  useEffect(() => {
    if (visible && !ruta && proyectos.length) setRuta(proyectos[0].ruta);
  }, [visible, proyectos, ruta]);

  const crear = async () => {
    if (!token || !ruta || !texto.trim() || creando) return;
    setCreando(true);
    try {
      await nuevaSesionClaude(token, ruta, texto.trim());
      setTexto("");
      onClose(true);
    } catch (e) {
      Alert.alert("No se pudo crear", e instanceof Error ? e.message : "Error");
    } finally {
      setCreando(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onClose(false)}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.modalBackdrop}
      >
        <View style={[styles.modalCard, { marginBottom: insets.bottom + 20 + teclado }]}>
          <Text style={styles.modalTitulo}>Nueva sesión de Claude</Text>
          {!macOnline ? (
            <Text style={styles.modalAviso}>La Mac está offline — no se puede crear ahora.</Text>
          ) : null}
          <Text style={styles.modalLabel}>Carpeta / proyecto</Text>
          <ScrollView style={styles.proyList} nestedScrollEnabled>
            {proyectos.map((p) => (
              <TouchableOpacity
                key={p.ruta}
                style={[styles.proyItem, ruta === p.ruta && styles.proyItemSel]}
                onPress={() => setRuta(p.ruta)}
              >
                <Text style={[styles.proyTxt, ruta === p.ruta && styles.proyTxtSel]} numberOfLines={1}>
                  {p.nombre}
                </Text>
                <Text style={styles.proyRuta} numberOfLines={1}>
                  {p.ruta}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={styles.modalLabel}>Primer mensaje (la tarea)</Text>
          <TextInput
            style={styles.modalInput}
            value={texto}
            onChangeText={setTexto}
            placeholder="¿Qué querés que haga Claude?"
            placeholderTextColor={colors.textDim}
            multiline
          />
          <View style={styles.modalBotones}>
            <TouchableOpacity style={styles.btnSec} onPress={() => onClose(false)}>
              <Text style={styles.btnSecTxt}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnPri, (!texto.trim() || !ruta || !macOnline || creando) && { opacity: 0.4 }]}
              onPress={crear}
              disabled={!texto.trim() || !ruta || !macOnline || creando}
            >
              {creando ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text style={styles.btnPriTxt}>Crear</Text>
              )}
            </TouchableOpacity>
          </View>
          {creando ? (
            <Text style={styles.modalAviso}>Arrancando Claude en la Mac… (puede tardar ~20 s)</Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Estilos ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  offline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.cardAlt,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  offlineTxt: { color: colors.amber, fontSize: 13, flex: 1 },
  vacio: { color: colors.textDim, fontSize: 14, textAlign: "center", marginTop: 40 },

  card: { backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  titulo: { color: colors.text, fontSize: 15, fontWeight: "700", flex: 1 },
  hora: { color: colors.textDim, fontSize: 12 },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 5 },
  estado: { fontSize: 12, fontWeight: "700" },
  proyecto: { color: colors.textDim, fontSize: 12, flex: 1 },
  badge: {
    backgroundColor: colors.cardAlt,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeTxt: { color: colors.primary, fontSize: 10, fontWeight: "700" },
  preview: { color: colors.textDim, fontSize: 13, marginTop: 7, lineHeight: 18 },

  fabVoz: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.primary,
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  fab: {
    position: "absolute",
    right: 20,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
  },

  chatWrap: { flex: 1, backgroundColor: colors.bg },
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chatTitulo: { color: colors.text, fontSize: 15, fontWeight: "700" },
  chatEstado: { fontSize: 12, fontWeight: "600", marginTop: 1 },
  preguntaBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primary,
    margin: 10,
    marginBottom: 0,
    borderRadius: 10,
    padding: 12,
  },
  preguntaBannerTxt: { color: colors.onPrimary, fontWeight: "700", fontSize: 13, flex: 1 },
  chatLista: { padding: 14, gap: 8 },

  burbuja: { maxWidth: "86%", borderRadius: 14, padding: 10, marginBottom: 2 },
  burbujaSebi: { alignSelf: "flex-end", backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  burbujaClaude: { alignSelf: "flex-start", backgroundColor: colors.card, borderBottomLeftRadius: 4 },
  burbujaSebiTxt: { color: colors.onPrimary, fontSize: 14, lineHeight: 20 },
  burbujaClaudeTxt: { color: colors.text, fontSize: 14, lineHeight: 20 },
  burbujaHora: { color: colors.textDim, fontSize: 10, marginTop: 4, alignSelf: "flex-end" },
  tool: {
    color: colors.textDim,
    fontSize: 11.5,
    alignSelf: "flex-start",
    marginVertical: 1,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: colors.text,
    fontSize: 14,
    maxHeight: 120,
  },
  enviarBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  continuarBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 13,
    alignItems: "center",
  },
  continuarTxt: { color: colors.onPrimary, fontWeight: "700", fontSize: 14 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
    padding: 14,
  },
  modalCard: { backgroundColor: colors.card, borderRadius: 16, padding: 16 },
  modalTitulo: { color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: 8 },
  modalAviso: { color: colors.amber, fontSize: 12, marginTop: 8 },
  modalLabel: { color: colors.textDim, fontSize: 12, fontWeight: "700", marginTop: 10, marginBottom: 6 },
  proyList: { maxHeight: 180 },
  proyItem: { backgroundColor: colors.cardAlt, borderRadius: 10, padding: 10, marginBottom: 6 },
  proyItemSel: { borderWidth: 1.5, borderColor: colors.primary },
  proyTxt: { color: colors.text, fontSize: 13, fontWeight: "600" },
  proyTxtSel: { color: colors.primary },
  proyRuta: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  modalInput: {
    backgroundColor: colors.cardAlt,
    borderRadius: 10,
    padding: 10,
    color: colors.text,
    fontSize: 14,
    minHeight: 70,
    textAlignVertical: "top",
  },
  modalBotones: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 14 },
  btnSec: { paddingHorizontal: 16, paddingVertical: 10 },
  btnSecTxt: { color: colors.textDim, fontWeight: "700" },
  btnPri: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minWidth: 80,
    alignItems: "center",
  },
  btnPriTxt: { color: colors.onPrimary, fontWeight: "700" },
});
