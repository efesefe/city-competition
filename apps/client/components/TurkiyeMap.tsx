import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import type { DigestCity } from "../lib/api";
import provinces from "../assets/turkiye-provinces.json";

type Props = {
  digest: DigestCity[];
  selectedPlate?: string | null;
  pulsePlates?: Set<string>;
  onSelect: (plate: string) => void;
};

export function TurkiyeMap({ digest, selectedPlate, pulsePlates, onSelect }: Props) {
  const colorByPlate = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of digest) {
      m.set(c.plate, c.ownerColor || "#3d5a4c");
    }
    return m;
  }, [digest]);

  return (
    <View style={styles.wrap}>
      <Svg
        width="100%"
        height="100%"
        viewBox={provinces.viewBox}
        preserveAspectRatio="xMidYMid meet"
      >
        <Rect x={0} y={0} width={1000} height={480} fill="#0a1620" />
        {provinces.features.map((f) => {
          const fill = colorByPlate.get(f.plate) || "#2a3f36";
          const selected = selectedPlate === f.plate;
          const pulse = pulsePlates?.has(f.plate);
          return (
            <Path
              key={f.plate}
              d={f.path}
              fill={fill}
              fillOpacity={selected ? 1 : pulse ? 0.95 : 0.88}
              stroke={selected ? "#f4e7c5" : "#0a1620"}
              strokeWidth={selected ? 2.2 : 0.6}
              onPress={() => onSelect(f.plate)}
              accessibilityRole="button"
              accessibilityLabel={f.nameTr}
            />
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minHeight: 280,
    backgroundColor: "#0a1620",
  },
});
