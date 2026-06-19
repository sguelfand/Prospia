import React from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";

import { colors } from "../theme";

/** Isotipo "La señal": campo de nodos con la señal ámbar al centro. */
export function ProspiaMark({ size = 26 }: { size?: number }) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <Line x1="50" y1="52" x2="22" y2="24" stroke={"#43577B"} strokeWidth={2.5} />
      <Line x1="50" y1="52" x2="82" y2="22" stroke={"#43577B"} strokeWidth={2.5} />
      <Line x1="50" y1="52" x2="76" y2="78" stroke={"#43577B"} strokeWidth={2.5} />
      <Circle cx="22" cy="24" r="5.5" fill={"#43577B"} />
      <Circle cx="82" cy="22" r="5.5" fill={"#43577B"} />
      <Circle cx="76" cy="78" r="5.5" fill={"#43577B"} />
      <Circle cx="24" cy="74" r="5.5" fill={"#43577B"} />
      <Circle cx="50" cy="52" r="13" fill={colors.primary} />
    </Svg>
  );
}

/** Lockup: isotipo + "Prospia" en tipografía Sora. */
export function ProspiaLogo({
  markSize = 26,
  color = colors.text,
}: {
  markSize?: number;
  color?: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <ProspiaMark size={markSize} />
      <Text
        style={{
          fontFamily: "Sora_700Bold",
          fontSize: markSize * 0.92,
          color,
          marginLeft: markSize * 0.34,
          letterSpacing: -0.5,
          includeFontPadding: false,
        }}
      >
        Prospia
      </Text>
    </View>
  );
}
