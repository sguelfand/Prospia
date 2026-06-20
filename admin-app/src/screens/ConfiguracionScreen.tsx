import React, { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Me, NotifEvento, changePassword, getMe, getNotifPrefs, setNotifPref, updateProfile } from "../api";
import { useAuth } from "../auth";
import { getCachedExpoToken } from "../push";
import { Loader } from "../components/ui";
import { colors } from "../theme";

type Msg = { ok: boolean; text: string } | null;

export default function ConfiguracionScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const expoToken = getCachedExpoToken();

  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  // Perfil
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<Msg>(null);

  // Contraseña
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [repeatPwd, setRepeatPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<Msg>(null);

  // Notificaciones (este dispositivo)
  const [eventos, setEventos] = useState<NotifEvento[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const m = await getMe(token);
      setMe(m);
      setNombre(m.nombre ?? "");
      setEmail(m.email ?? "");
      if (expoToken) {
        const prefs = await getNotifPrefs(token, expoToken);
        setEventos(prefs.eventos);
      }
    } catch {
      // si falla, igual mostramos lo que se pueda
    } finally {
      setLoading(false);
    }
  }, [token, expoToken]);

  useEffect(() => { load(); }, [load]);

  const saveProfile = async () => {
    if (!token) return;
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const m = await updateProfile(token, nombre.trim() || null, email.trim());
      setNombre(m.nombre ?? "");
      setEmail(m.email ?? "");
      setProfileMsg({ ok: true, text: "Datos guardados" });
    } catch (e) {
      setProfileMsg({ ok: false, text: e instanceof Error ? e.message : "Error al guardar" });
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (!token) return;
    setPwdMsg(null);
    if (newPwd.length < 6) { setPwdMsg({ ok: false, text: "La nueva contraseña debe tener al menos 6 caracteres" }); return; }
    if (newPwd !== repeatPwd) { setPwdMsg({ ok: false, text: "Las contraseñas no coinciden" }); return; }
    setSavingPwd(true);
    try {
      await changePassword(token, currentPwd, newPwd);
      setCurrentPwd(""); setNewPwd(""); setRepeatPwd("");
      setPwdMsg({ ok: true, text: "Contraseña actualizada" });
    } catch (e) {
      setPwdMsg({ ok: false, text: e instanceof Error ? e.message : "Error al cambiar la contraseña" });
    } finally {
      setSavingPwd(false);
    }
  };

  const onToggleNotif = async (evento: string, value: boolean) => {
    if (!token || !expoToken) return;
    setEventos((prev) => prev.map((e) => (e.evento === evento ? { ...e, enabled: value } : e)));
    try {
      await setNotifPref(token, expoToken, evento, value);
    } catch {
      setEventos((prev) => prev.map((e) => (e.evento === evento ? { ...e, enabled: !value } : e)));
    }
  };

  if (loading) return <Loader />;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        {/* ── Usuario ── */}
        <Text style={styles.cardTitle}>Usuario</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Nombre</Text>
          <TextInput style={styles.input} value={nombre} onChangeText={setNombre} placeholder="Tu nombre" placeholderTextColor={colors.textDim} />
          <Text style={styles.label}>Usuario</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} placeholder="usuario" placeholderTextColor={colors.textDim} />
          {profileMsg && <Text style={[styles.msg, { color: profileMsg.ok ? colors.green : colors.red }]}>{profileMsg.text}</Text>}
          <TouchableOpacity style={[styles.btn, savingProfile && styles.btnOff]} onPress={saveProfile} disabled={savingProfile}>
            <Text style={styles.btnText}>{savingProfile ? "Guardando…" : "Guardar"}</Text>
          </TouchableOpacity>
        </View>

        {/* ── Contraseña ── */}
        <Text style={styles.cardTitle}>Cambiar contraseña</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Contraseña actual</Text>
          <TextInput style={styles.input} value={currentPwd} onChangeText={setCurrentPwd} secureTextEntry={!showPwd} placeholder="••••••••" placeholderTextColor={colors.textDim} />
          <View style={styles.pwHeadRow}>
            <Text style={styles.label}>Nueva contraseña</Text>
            <TouchableOpacity onPress={() => setShowPwd((v) => !v)}>
              <Text style={styles.verText}>{showPwd ? "Ocultar" : "Ver"}</Text>
            </TouchableOpacity>
          </View>
          <TextInput style={styles.input} value={newPwd} onChangeText={setNewPwd} secureTextEntry={!showPwd} placeholder="Mínimo 6 caracteres" placeholderTextColor={colors.textDim} />
          <Text style={styles.label}>Repetir nueva contraseña</Text>
          <TextInput style={styles.input} value={repeatPwd} onChangeText={setRepeatPwd} secureTextEntry={!showPwd} placeholder="••••••••" placeholderTextColor={colors.textDim} />
          {pwdMsg && <Text style={[styles.msg, { color: pwdMsg.ok ? colors.green : colors.red }]}>{pwdMsg.text}</Text>}
          <TouchableOpacity style={[styles.btn, savingPwd && styles.btnOff]} onPress={savePassword} disabled={savingPwd}>
            <Text style={styles.btnText}>{savingPwd ? "Guardando…" : "Cambiar contraseña"}</Text>
          </TouchableOpacity>
        </View>

        {/* ── Notificaciones (este dispositivo) ── */}
        <Text style={styles.cardTitle}>Notificaciones</Text>
        {expoToken ? (
          <View style={styles.card}>
            <Text style={styles.intro}>Qué avisos te llegan a este dispositivo.</Text>
            {eventos.map((e, i) => (
              <View key={e.evento} style={[styles.notifRow, i > 0 && styles.notifBorder]}>
                <Text style={styles.notifLabel}>{e.label}</Text>
                <Switch value={e.enabled} onValueChange={(v) => onToggleNotif(e.evento, v)} trackColor={{ false: colors.cardAlt, true: colors.primary }} thumbColor="#fff" />
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.intro}>Este dispositivo todavía no está registrado para notificaciones. Reabrí la app con sesión iniciada y dale permiso.</Text>
          </View>
        )}

        {me ? <Text style={styles.footer}>Sesión: {me.email}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  cardTitle: { color: colors.textDim, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginTop: 8 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 20 },
  label: { color: colors.textDim, fontSize: 12, fontWeight: "700", marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontSize: 15 },
  pwHeadRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  verText: { color: colors.primary, fontSize: 12, fontWeight: "700", marginTop: 12 },
  msg: { fontSize: 13, marginTop: 12 },
  btn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 16 },
  btnOff: { opacity: 0.5 },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  intro: { color: colors.textDim, fontSize: 13, marginBottom: 6 },
  notifRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 },
  notifBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  notifLabel: { color: colors.text, fontSize: 15, flex: 1, marginRight: 12 },
  footer: { color: colors.textDim, fontSize: 12, textAlign: "center", marginTop: 4 },
});
