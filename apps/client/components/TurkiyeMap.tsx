import React, { useMemo } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import type { DigestCity } from "../lib/api";
import provinces from "../assets/turkiye-provinces.json";

type Props = {
  digest: DigestCity[];
  selectedPlate?: string | null;
  pulsePlates?: Set<string>;
  onSelect: (plate: string) => void;
};

type ProvinceFeature = {
  plate: string;
  nameTr: string;
  path: string;
};

type ProvincesAtlas = {
  viewBox: string;
  features: ProvinceFeature[];
};

const atlas = provinces as ProvincesAtlas;

function useColorByPlate(digest: DigestCity[]) {
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const c of digest) {
      m.set(c.plate, c.ownerColor || "#3d5a4c");
    }
    return m;
  }, [digest]);
}

function provinceStyle(
  plate: string,
  colorByPlate: Map<string, string>,
  selectedPlate?: string | null,
  pulsePlates?: Set<string>,
) {
  const fill = colorByPlate.get(plate) || "#2a3f36";
  const selected = selectedPlate === plate;
  const pulse = pulsePlates?.has(plate);
  return {
    fill,
    fillOpacity: selected ? 1 : pulse ? 0.95 : 0.88,
    stroke: selected ? "#f4e7c5" : "#0a1620",
    strokeWidth: selected ? 2.2 : 0.6,
  };
}

/**
 * Expo web: react-native-svg WebShape forwards RN touch/a11y props into
 * unstable_createElement for <path>, which React DOM rejects ("Unknown
 * event handler property") and blank the map. Render a real DOM <svg>
 * on web; keep react-native-svg on native.
 */
function TurkiyeMapWeb({ digest, selectedPlate, pulsePlates, onSelect }: Props) {
  const colorByPlate = useColorByPlate(digest);

  return (
    <View style={styles.wrap}>
      {/* eslint-disable-next-line react/no-unknown-property -- DOM svg */}
      <svg
        width="100%"
        height="100%"
        viewBox={atlas.viewBox}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", width: "100%", height: "100%" }}
      >
        <rect x={0} y={0} width={1000} height={480} fill="#0a1620" />
        {atlas.features.map((f) => {
          if (!f.path) return null;
          const s = provinceStyle(f.plate, colorByPlate, selectedPlate, pulsePlates);
          return (
            <path
              key={f.plate}
              d={f.path}
              fill={s.fill}
              fillOpacity={s.fillOpacity}
              stroke={s.stroke}
              strokeWidth={s.strokeWidth}
              role="button"
              aria-label={f.nameTr}
              tabIndex={0}
              style={{ cursor: "pointer" }}
              onClick={() => onSelect(f.plate)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(f.plate);
                }
              }}
            />
          );
        })}
      </svg>
    </View>
  );
}

function TurkiyeMapNative({ digest, selectedPlate, pulsePlates, onSelect }: Props) {
  const colorByPlate = useColorByPlate(digest);

  return (
    <View style={styles.wrap}>
      <Svg
        width="100%"
        height="100%"
        viewBox={atlas.viewBox}
        preserveAspectRatio="xMidYMid meet"
      >
        <Rect x={0} y={0} width={1000} height={480} fill="#0a1620" />
        {atlas.features.map((f) => {
          if (!f.path) return null;
          const s = provinceStyle(f.plate, colorByPlate, selectedPlate, pulsePlates);
          return (
            <Path
              key={f.plate}
              d={f.path}
              fill={s.fill}
              fillOpacity={s.fillOpacity}
              stroke={s.stroke}
              strokeWidth={s.strokeWidth}
              onPress={() => onSelect(f.plate)}
              accessibilityLabel={f.nameTr}
            />
          );
        })}
      </Svg>
    </View>
  );
}

export function TurkiyeMap(props: Props) {
  if (Platform.OS === "web") {
    return <TurkiyeMapWeb {...props} />;
  }
  return <TurkiyeMapNative {...props} />;
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minHeight: 280,
    backgroundColor: "#0a1620",
  },
});
