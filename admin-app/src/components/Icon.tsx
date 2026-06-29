import React from "react";
import { StyleProp, Text, TextStyle, View } from "react-native";
import Svg, { Circle, Line, Path, Polyline, Rect } from "react-native-svg";

import { colors } from "../theme";

/** Íconos minimalistas estilo "línea" (Feather), monocromos y a tono con la
 *  paleta. Sin emojis 3D. Color por prop (default: gris niebla sutil). */
export type IconName =
  | "dashboard"
  | "bell"
  | "alert"
  | "list"
  | "lock"
  | "phone"
  | "mail"
  | "search"
  | "clock"
  | "calendar"
  | "star"
  | "send"
  | "message"
  | "flame"
  | "plus"
  | "tag"
  | "check"
  | "x"
  | "undo"
  | "flag"
  | "settings"
  | "pulse"
  | "info"
  | "refresh"
  | "user"
  | "trash";

export function Icon({
  name,
  size = 18,
  color = colors.textDim,
  strokeWidth = 2,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const p = { stroke: color, strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "dashboard" && (
        <>
          <Rect x="3" y="3" width="7" height="7" rx="1.5" {...p} />
          <Rect x="14" y="3" width="7" height="7" rx="1.5" {...p} />
          <Rect x="14" y="14" width="7" height="7" rx="1.5" {...p} />
          <Rect x="3" y="14" width="7" height="7" rx="1.5" {...p} />
        </>
      )}
      {name === "bell" && (
        <>
          <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" {...p} />
          <Path d="M13.73 21a2 2 0 0 1-3.46 0" {...p} />
        </>
      )}
      {name === "alert" && (
        <>
          <Path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" {...p} />
          <Line x1="12" y1="9" x2="12" y2="13" {...p} />
          <Line x1="12" y1="17" x2="12.01" y2="17" {...p} />
        </>
      )}
      {name === "list" && (
        <>
          <Line x1="8" y1="6" x2="21" y2="6" {...p} />
          <Line x1="8" y1="12" x2="21" y2="12" {...p} />
          <Line x1="8" y1="18" x2="21" y2="18" {...p} />
          <Line x1="3.5" y1="6" x2="3.51" y2="6" {...p} />
          <Line x1="3.5" y1="12" x2="3.51" y2="12" {...p} />
          <Line x1="3.5" y1="18" x2="3.51" y2="18" {...p} />
        </>
      )}
      {name === "lock" && (
        <>
          <Rect x="3" y="11" width="18" height="11" rx="2" {...p} />
          <Path d="M7 11V7a5 5 0 0 1 10 0v4" {...p} />
        </>
      )}
      {name === "phone" && (
        <Path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" {...p} />
      )}
      {name === "mail" && (
        <>
          <Rect x="2" y="4" width="20" height="16" rx="2" {...p} />
          <Polyline points="22,6 12,13 2,6" {...p} />
        </>
      )}
      {name === "search" && (
        <>
          <Circle cx="11" cy="11" r="8" {...p} />
          <Line x1="21" y1="21" x2="16.65" y2="16.65" {...p} />
        </>
      )}
      {name === "clock" && (
        <>
          <Circle cx="12" cy="12" r="10" {...p} />
          <Polyline points="12,6 12,12 16,14" {...p} />
        </>
      )}
      {name === "calendar" && (
        <>
          <Rect x="3" y="4" width="18" height="18" rx="2" {...p} />
          <Line x1="16" y1="2" x2="16" y2="6" {...p} />
          <Line x1="8" y1="2" x2="8" y2="6" {...p} />
          <Line x1="3" y1="10" x2="21" y2="10" {...p} />
        </>
      )}
      {name === "star" && (
        <Path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" {...p} />
      )}
      {name === "send" && (
        <>
          <Line x1="22" y1="2" x2="11" y2="13" {...p} />
          <Polyline points="22,2 15,22 11,13 2,9 22,2" {...p} />
        </>
      )}
      {name === "message" && (
        <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" {...p} />
      )}
      {name === "flame" && (
        <Path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" {...p} />
      )}
      {name === "plus" && (
        <>
          <Line x1="12" y1="5" x2="12" y2="19" {...p} />
          <Line x1="5" y1="12" x2="19" y2="12" {...p} />
        </>
      )}
      {name === "tag" && (
        <>
          <Path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.58a2 2 0 0 1 0 2.83z" {...p} />
          <Line x1="7" y1="7" x2="7.01" y2="7" {...p} />
        </>
      )}
      {name === "check" && <Polyline points="20,6 9,17 4,12" {...p} />}
      {name === "x" && (
        <>
          <Line x1="18" y1="6" x2="6" y2="18" {...p} />
          <Line x1="6" y1="6" x2="18" y2="18" {...p} />
        </>
      )}
      {name === "undo" && (
        <>
          <Polyline points="1,4 1,10 7,10" {...p} />
          <Path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" {...p} />
        </>
      )}
      {name === "flag" && (
        <>
          <Path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" {...p} />
          <Line x1="4" y1="22" x2="4" y2="15" {...p} />
        </>
      )}
      {name === "settings" && (
        <>
          <Circle cx="12" cy="12" r="3" {...p} />
          <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" {...p} />
        </>
      )}
      {name === "pulse" && (
        <Polyline points="22,12 18,12 15,21 9,3 6,12 2,12" {...p} />
      )}
      {name === "info" && (
        <>
          <Circle cx="12" cy="12" r="10" {...p} />
          <Line x1="12" y1="16" x2="12" y2="11" {...p} />
          <Line x1="12" y1="8" x2="12.01" y2="8" {...p} />
        </>
      )}
      {name === "refresh" && (
        <>
          <Polyline points="23,4 23,10 17,10" {...p} />
          <Polyline points="1,20 1,14 7,14" {...p} />
          <Path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" {...p} />
        </>
      )}
      {name === "user" && (
        <>
          <Circle cx="12" cy="8" r="4" {...p} />
          <Path d="M4 21c0-4 4-6 8-6s8 2 8 6" {...p} />
        </>
      )}
      {name === "trash" && (
        <>
          <Polyline points="3,6 21,6" {...p} />
          <Path d="M8 6V4h8v2M6 6l1 14h10l1-14" {...p} />
        </>
      )}
    </Svg>
  );
}

/** Ícono + texto en fila (para metadatos sutiles de las cards). */
export function IconText({
  name,
  text,
  color = colors.textDim,
  size = 13,
  textStyle,
}: {
  name: IconName;
  text: string;
  color?: string;
  size?: number;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Icon name={name} size={size} color={color} strokeWidth={1.9} />
      <Text style={[{ color, fontSize: 12, marginLeft: 4 }, textStyle]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}
