import React, { useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

import { Icon, IconName } from "./Icon";

export type SwipeAction = { icon: IconName; color: string; onTrigger: () => void };

/** Fila deslizable reutilizable. Deslizar a la derecha dispara `left`, a la
 *  izquierda dispara `right`. Se cierra sola tras disparar (así una confirmación
 *  cancelada no deja la fila abierta). */
export function SwipeRow({
  left,
  right,
  children,
}: {
  left: SwipeAction;
  right: SwipeAction;
  children: React.ReactNode;
}) {
  const ref = useRef<Swipeable>(null);

  const render = (a: SwipeAction, align: "flex-start" | "flex-end") => () => (
    <View style={[styles.action, { backgroundColor: a.color, alignItems: align }]}>
      <Icon name={a.icon} size={24} color="#fff" />
    </View>
  );

  return (
    <Swipeable
      ref={ref}
      renderLeftActions={render(left, "flex-start")}
      renderRightActions={render(right, "flex-end")}
      leftThreshold={70}
      rightThreshold={70}
      onSwipeableOpen={(direction) => {
        if (direction === "right") left.onTrigger();
        else right.onTrigger();
        ref.current?.close();
      }}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: { flex: 1, justifyContent: "center", paddingHorizontal: 24, borderRadius: 12, marginBottom: 10 },
});
