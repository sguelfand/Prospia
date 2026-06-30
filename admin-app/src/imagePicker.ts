import * as ImagePicker from "expo-image-picker";

export type PickedImage = { b64: string; mime: string; nombre: string };

/** Abre la galería y devuelve la imagen elegida en base64 (lista para mandar al
 *  backend). null si el usuario cancela. Lanza un Error con mensaje si falta permiso. */
export async function pickImageBase64(): Promise<PickedImage | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error("Necesito permiso para acceder a tus fotos (Ajustes → Prospia).");
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.7,
    base64: true,
  });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  if (!a.base64) throw new Error("No se pudo leer la imagen.");
  return {
    b64: a.base64,
    mime: a.mimeType || "image/jpeg",
    nombre: a.fileName || "captura.jpg",
  };
}
