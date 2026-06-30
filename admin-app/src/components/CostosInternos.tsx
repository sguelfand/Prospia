import React from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";

import { AnthUsage } from "../api";
import { colors } from "../theme";

const PALETTE = ["#F5B23D", "#6CB6FF", "#5AD8A6", "#C792EA", "#FF9F7E", "#8294B4", "#E0A02E", "#9FE0FF"];
const usd = (n: number) => "$" + (n ?? 0).toFixed((n ?? 0) < 1 ? 3 : 2);
const corto = (f: string) => f.split(" (")[0];

export default function CostosInternos({ data }: { data: AnthUsage }) {
  const nombres = Array.from(new Set([
    ...data.por_funcion.map((f) => f.funcion),
    ...data.meses.flatMap((m) => Object.keys(m.por_funcion)),
  ])).sort();
  const color = (f: string) => PALETTE[nombres.indexOf(f) % PALETTE.length];

  const fs = data.por_funcion;
  const total = data.total_mes || fs.reduce((s, f) => s + f.costo_usd, 0);
  const maxFn = Math.max(0.000001, ...fs.map((f) => f.costo_usd));
  const delta = data.delta_pct;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Costos internos · API Anthropic</Text>
      <Text style={styles.sub}>Funciones de Prospia (Especialista, intake, clasificación…), NO Camila.</Text>

      {/* Mes actual */}
      <Text style={styles.secTitle}>Mes actual · {data.mes_nombre}</Text>
      <View style={styles.kpis}>
        <Kpi label="Costo del mes" value={usd(total)} amber />
        <Kpi label="Prom. por día" value={usd(total / Math.max(1, data.dias_transcurridos))} />
        <Kpi label="vs mes ant." value={delta == null ? "—" : `${delta <= 0 ? "▼" : "▲"} ${Math.abs(delta)}%`} tone={delta == null ? undefined : delta <= 0 ? "down" : "up"} />
      </View>

      {fs.length === 0 ? <Text style={styles.empty}>Sin uso este mes todavía.</Text> : fs.map((f) => (
        <View key={f.funcion} style={{ marginTop: 10 }}>
          <View style={styles.barTop}>
            <Text style={styles.fn}>{corto(f.funcion)}</Text>
            <Text style={[styles.amt, { color: color(f.funcion) }]}>{usd(f.costo_usd)}</Text>
          </View>
          <View style={styles.track}>
            <View style={{ height: "100%", borderRadius: 5, width: `${(f.costo_usd / maxFn * 100).toFixed(1)}%` as any, backgroundColor: color(f.funcion) }} />
          </View>
          <Text style={styles.pct}>{total > 0 ? (f.costo_usd / total * 100).toFixed(0) : 0}% del mes</Text>
        </View>
      ))}

      {/* Histórico apilado */}
      <Text style={[styles.secTitle, { marginTop: 18 }]}>Histórico mensual</Text>
      {data.meses.length === 0 ? <Text style={styles.empty}>Sin histórico todavía.</Text> : (
        <Stacked meses={data.meses} nombres={nombres} color={color} />
      )}
      <View style={styles.legend}>
        {nombres.map((n) => (
          <View key={n} style={styles.legIt}>
            <View style={[styles.dot, { backgroundColor: color(n) }]} />
            <Text style={styles.legTxt}>{corto(n)}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.nota}>Precio oficial de Anthropic (key directa, sin el 10% off de MyClaw). Camila va por MyClaw, se mide aparte.</Text>
    </View>
  );
}

function Kpi({ label, value, amber, tone }: { label: string; value: string; amber?: boolean; tone?: "up" | "down" }) {
  const c = tone === "up" ? colors.red : tone === "down" ? colors.green : amber ? colors.amber : colors.text;
  return (
    <View style={styles.kpi}>
      <Text style={[styles.kpiVal, { color: c }]}>{value}</Text>
      <Text style={styles.kpiLbl}>{label}</Text>
    </View>
  );
}

function Stacked({ meses, nombres, color }: { meses: AnthUsage["meses"]; nombres: string[]; color: (f: string) => string }) {
  const W = Dimensions.get("window").width - 64;
  const H = 230, padL = 44, padR = 6, padT = 18, padB = 28;
  const cw = W - padL - padR, ch = H - padT - padB, n = meses.length;
  const maxT = Math.max(0.000001, ...meses.map((m) => m.total));
  const gap = cw / n, bw = Math.min(40, gap * 0.6);
  const y = (v: number) => padT + ch - (v / maxT) * ch;
  const grid = [0, 0.5, 1].map((p) => maxT * p);

  return (
    <Svg width={W} height={H}>
      {grid.map((v, i) => (
        <React.Fragment key={i}>
          <Line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke={colors.border} strokeWidth={1} />
          <SvgText x={padL - 6} y={y(v) + 3} textAnchor="end" fill={colors.textDim} fontSize={9}>{usd(v)}</SvgText>
        </React.Fragment>
      ))}
      {meses.map((m, i) => {
        const cx = padL + gap * i + gap / 2;
        let yb = padT + ch;
        return (
          <React.Fragment key={m.mes}>
            {nombres.filter((nm) => (m.por_funcion[nm] ?? 0) > 0).map((nm) => {
              const h = (m.por_funcion[nm] / maxT) * ch;
              yb -= h;
              return <Rect key={nm} x={cx - bw / 2} y={yb} width={bw} height={h} rx={2} fill={color(nm)} />;
            })}
            <SvgText x={cx} y={y(m.total) - 5} textAnchor="middle" fill={colors.text} fontSize={9.5} fontWeight="700">{usd(m.total)}</SvgText>
            <SvgText x={cx} y={H - padB + 15} textAnchor="middle" fill={colors.textDim} fontSize={10}>{m.nombre}</SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: 13, fontWeight: "700", textTransform: "uppercase" },
  sub: { color: colors.textDim, fontSize: 11, marginTop: 3 },
  secTitle: { color: colors.text, fontSize: 12, fontWeight: "700", marginTop: 14, marginBottom: 8 },
  kpis: { flexDirection: "row", gap: 8 },
  kpi: { flex: 1, backgroundColor: colors.cardAlt, borderRadius: 10, padding: 10 },
  kpiVal: { fontSize: 17, fontWeight: "700" },
  kpiLbl: { color: colors.textDim, fontSize: 10, marginTop: 2 },
  barTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 },
  fn: { color: colors.text, fontSize: 13 },
  amt: { fontSize: 13, fontWeight: "700" },
  track: { height: 8, borderRadius: 5, backgroundColor: colors.cardAlt, overflow: "hidden" },
  pct: { color: colors.textDim, fontSize: 10, marginTop: 2 },
  empty: { color: colors.textDim, fontSize: 13, marginTop: 8 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  legIt: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 9, height: 9, borderRadius: 2 },
  legTxt: { color: colors.textDim, fontSize: 11 },
  nota: { color: colors.textDim, fontSize: 10, marginTop: 12 },
});
