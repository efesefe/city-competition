import React, { memo, useMemo, useRef } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import type { DigestCity } from "../lib/api";
import {
  atlas,
  atlasReady,
  paintEquals,
  parseViewBox,
  provinceStyle,
  type ProvinceFeature,
  type ProvincePaint,
} from "../lib/mapAtlas";

export type TurkiyeMapProps = {
  digest: DigestCity[];
  selectedPlate?: string | null;
  pulsePlates?: Set<string>;
  onSelect: (plate: string) => void;
};

function useColorByPlate(digest: DigestCity[]) {
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const c of digest) {
      if (c?.plate) m.set(c.plate, c.ownerColor || "#3d5a4c");
    }
    return m;
  }, [digest]);
}

function MapEmpty() {
  return (
    <View style={[styles.wrap, styles.empty]} accessibilityRole="text">
      <Text style={styles.emptyTitle}>Harita yüklenemedi</Text>
      <Text style={styles.emptyBody}>İl sınırları bulunamadı. Uygulamayı yeniden başlatın.</Text>
    </View>
  );
}

type PathRowProps = {
  feature: ProvinceFeature;
  paint: ProvincePaint;
  onSelect: (plate: string) => void;
};

const ProvincePathWeb = memo(
  function ProvincePathWeb({ feature, paint, onSelect }: PathRowProps) {
    const touchHandledAt = useRef(0);
    const select = () => onSelect(feature.plate);
    return (
      <path
        d={feature.path}
        fill={paint.fill}
        fillOpacity={paint.fillOpacity}
        stroke={paint.stroke}
        strokeWidth={paint.strokeWidth}
        vectorEffect="non-scaling-stroke"
        role="button"
        aria-label={feature.nameTr}
        tabIndex={0}
        style={{ cursor: "pointer", touchAction: "manipulation" }}
        onClick={(e) => {
          e.stopPropagation();
          // Skip the synthetic click that follows a touch pointerup.
          if (Date.now() - touchHandledAt.current < 500) return;
          select();
        }}
        onPointerUp={(e) => {
          if (e.pointerType !== "touch") return;
          e.preventDefault();
          e.stopPropagation();
          touchHandledAt.current = Date.now();
          select();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            select();
          }
        }}
      />
    );
  },
  (prev, next) =>
    prev.feature.plate === next.feature.plate &&
    prev.feature.path === next.feature.path &&
    prev.onSelect === next.onSelect &&
    paintEquals(prev.paint, next.paint),
);

const ProvincePathNative = memo(
  function ProvincePathNative({ feature, paint, onSelect }: PathRowProps) {
    return (
      <Path
        d={feature.path}
        fill={paint.fill}
        fillOpacity={paint.fillOpacity}
        stroke={paint.stroke}
        strokeWidth={paint.strokeWidth}
        strokeLinejoin="round"
        onPress={() => onSelect(feature.plate)}
        // Faster press recognition on dense SVG maps.
        delayPressIn={0}
        accessibilityLabel={feature.nameTr}
      />
    );
  },
  (prev, next) =>
    prev.feature.plate === next.feature.plate &&
    prev.feature.path === next.feature.path &&
    prev.onSelect === next.onSelect &&
    paintEquals(prev.paint, next.paint),
);

/**
 * Expo web: never mount react-native-svg Path with onPress — WebShape forwards
 * RN responder props into createElement and blank the map. DOM <svg>/<path> only.
 */
function TurkiyeMapWeb({ digest, selectedPlate, pulsePlates, onSelect }: TurkiyeMapProps) {
  const colorByPlate = useColorByPlate(digest);
  const vb = parseViewBox(atlas.viewBox);

  return (
    <View style={styles.wrap}>
      {/* eslint-disable-next-line react/no-unknown-property -- DOM svg */}
      <svg
        width="100%"
        height="100%"
        viewBox={atlas.viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Türkiye illeri haritası"
        style={{ display: "block", width: "100%", height: "100%" }}
      >
        <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#0a1620" />
        {atlas.features.map((f) => (
          <ProvincePathWeb
            key={f.plate}
            feature={f}
            paint={provinceStyle(f.plate, colorByPlate, selectedPlate, pulsePlates)}
            onSelect={onSelect}
          />
        ))}
      </svg>
    </View>
  );
}

function TurkiyeMapNative({ digest, selectedPlate, pulsePlates, onSelect }: TurkiyeMapProps) {
  const colorByPlate = useColorByPlate(digest);
  const vb = parseViewBox(atlas.viewBox);

  return (
    <View style={styles.wrap} collapsable={false}>
      <Svg
        width="100%"
        height="100%"
        viewBox={atlas.viewBox}
        preserveAspectRatio="xMidYMid meet"
        accessibilityLabel="Türkiye illeri haritası"
      >
        <Rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#0a1620" />
        {atlas.features.map((f) => (
          <ProvincePathNative
            key={f.plate}
            feature={f}
            paint={provinceStyle(f.plate, colorByPlate, selectedPlate, pulsePlates)}
            onSelect={onSelect}
          />
        ))}
      </Svg>
    </View>
  );
}

export function TurkiyeMap(props: TurkiyeMapProps) {
  if (!atlasReady) {
    return <MapEmpty />;
  }
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
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: "#f4e7c5",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 6,
  },
  emptyBody: {
    color: "#9bb0a3",
    fontSize: 13,
    textAlign: "center",
  },
});
