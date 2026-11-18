import React, { memo, useEffect, useMemo, useRef, useState } from "react";
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
import { colors, fonts, motion, type as typeRoles } from "../lib/theme";

export type TurkiyeMapProps = {
  digest: DigestCity[];
  selectedPlate?: string | null;
  pulsePlates?: Set<string>;
  /** Match-day timed-war / derby city plates (locked with banner). */
  spotlightPlates?: Set<string>;
  /** Guest-visible contested heat — soft accent pulse wash (2–3 plates). */
  contestedPlates?: Set<string>;
  onSelect: (plate: string) => void;
};

function useColorByPlate(digest: DigestCity[]) {
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const c of digest) {
      if (c?.plate) m.set(c.plate, c.ownerColor || colors.mapBase);
    }
    return m;
  }, [digest]);
}

/** Interpolate ownership fills when digest colors change (flip tween). */
function useTweenedColors(target: Map<string, string>): Map<string, string> {
  const [display, setDisplay] = useState(() => new Map(target));
  const fromRef = useRef(new Map(target));
  const toRef = useRef(new Map(target));
  const rafRef = useRef(0);

  useEffect(() => {
    const prev = fromRef.current;
    const changed: string[] = [];
    for (const [plate, color] of target) {
      if (prev.get(plate) !== color) changed.push(plate);
    }
    for (const plate of prev.keys()) {
      if (!target.has(plate)) changed.push(plate);
    }
    if (changed.length === 0) {
      fromRef.current = new Map(target);
      toRef.current = new Map(target);
      setDisplay(new Map(target));
      return;
    }

    const from = new Map(prev);
    for (const [plate, color] of target) {
      if (!from.has(plate)) from.set(plate, colors.mapBase);
    }
    fromRef.current = from;
    toRef.current = new Map(target);

    const start = performance.now();
    const duration = motion.flipTweenMs;
    cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Ease out — no bounce.
      const e = 1 - (1 - t) * (1 - t);
      const next = new Map<string, string>();
      for (const [plate, toColor] of toRef.current) {
        const fromColor = from.get(plate) ?? colors.mapBase;
        next.set(plate, t >= 1 ? toColor : mixHex(fromColor, toColor, e));
      }
      setDisplay(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = new Map(toRef.current);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target]);

  return display;
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return t < 0.5 ? a : b;
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, "0");
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

const SPOTLIGHT_PULSE_MS = 1600;

function spotlightGlowOpacity(phase: number): number {
  // Cool floodlight: ink at low alpha (visual-direction §2).
  return 0.18 + 0.22 * Math.sin(phase * Math.PI * 2);
}

function contestedWashOpacity(phase: number): number {
  // Soft accent pulse 0 → ~0.22 → 0 (visual-direction §5).
  return 0.22 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2));
}

function platesFeatures(plates?: Set<string>): ProvinceFeature[] {
  if (!plates?.size) return [];
  return atlas.features.filter((f) => plates.has(f.plate));
}

/**
 * Match-day cool halo pulse without re-rendering the 81-path province tree.
 * Web: rAF writes stroke-opacity on DOM path refs (no React state).
 * Native: local phase state — only this layer reconciles, not province fills.
 */
function SpotlightHaloWeb({ plates }: { plates?: Set<string> }) {
  const features = useMemo(() => platesFeatures(plates), [plates]);
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);

  useEffect(() => {
    pathRefs.current = pathRefs.current.slice(0, features.length);
  }, [features.length]);

  useEffect(() => {
    if (features.length === 0) return;
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const phase = ((t - start) % SPOTLIGHT_PULSE_MS) / SPOTLIGHT_PULSE_MS;
      const opacity = String(spotlightGlowOpacity(phase));
      for (const el of pathRefs.current) {
        if (el) el.setAttribute("stroke-opacity", opacity);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [features]);

  if (features.length === 0) return null;

  return (
    <>
      {features.map((f, i) => (
        <path
          key={`glow-${f.plate}`}
          ref={(el) => {
            pathRefs.current[i] = el;
          }}
          d={f.path}
          fill="none"
          stroke={colors.ink}
          strokeWidth={4.5}
          strokeOpacity={0.2}
          pointerEvents="none"
          vectorEffect="non-scaling-stroke"
          data-testid={`match-day-spotlight-${f.plate}`}
        />
      ))}
    </>
  );
}

function SpotlightHaloNative({ plates }: { plates?: Set<string> }) {
  const features = useMemo(() => platesFeatures(plates), [plates]);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (features.length === 0) {
      setPhase(0);
      return;
    }
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      setPhase(((t - start) % SPOTLIGHT_PULSE_MS) / SPOTLIGHT_PULSE_MS);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [features]);

  if (features.length === 0) return null;

  const glowOpacity = spotlightGlowOpacity(phase);
  return (
    <>
      {features.map((f) => (
        <Path
          key={`glow-${f.plate}`}
          d={f.path}
          fill="none"
          stroke={colors.ink}
          strokeWidth={4.5}
          strokeOpacity={glowOpacity}
          pointerEvents="none"
        />
      ))}
    </>
  );
}

/** Contested soft pulse — accent wash on 2–3 hot provinces (guest-visible). */
function ContestedPulseWeb({ plates }: { plates?: Set<string> }) {
  const features = useMemo(() => platesFeatures(plates), [plates]);
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);

  useEffect(() => {
    pathRefs.current = pathRefs.current.slice(0, features.length);
  }, [features.length]);

  useEffect(() => {
    if (features.length === 0) return;
    let raf = 0;
    let start = 0;
    const period = motion.contestedPulseMs;
    const tick = (t: number) => {
      if (!start) start = t;
      const phase = ((t - start) % period) / period;
      const opacity = String(contestedWashOpacity(phase));
      for (const el of pathRefs.current) {
        if (el) el.setAttribute("fill-opacity", opacity);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [features]);

  if (features.length === 0) return null;

  return (
    <>
      {features.map((f, i) => (
        <path
          key={`heat-${f.plate}`}
          ref={(el) => {
            pathRefs.current[i] = el;
          }}
          d={f.path}
          fill={colors.accent}
          fillOpacity={0.12}
          stroke="none"
          pointerEvents="none"
          data-testid={`contested-pulse-${f.plate}`}
        />
      ))}
    </>
  );
}

function ContestedPulseNative({ plates }: { plates?: Set<string> }) {
  const features = useMemo(() => platesFeatures(plates), [plates]);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (features.length === 0) {
      setPhase(0);
      return;
    }
    let raf = 0;
    let start = 0;
    const period = motion.contestedPulseMs;
    const tick = (t: number) => {
      if (!start) start = t;
      setPhase(((t - start) % period) / period);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [features]);

  if (features.length === 0) return null;

  const wash = contestedWashOpacity(phase);
  return (
    <>
      {features.map((f) => (
        <Path
          key={`heat-${f.plate}`}
          d={f.path}
          fill={colors.accent}
          fillOpacity={wash}
          stroke="none"
          pointerEvents="none"
        />
      ))}
    </>
  );
}

/**
 * Expo web: never mount react-native-svg Path with onPress — WebShape forwards
 * RN responder props into createElement and blank the map. DOM <svg>/<path> only.
 */
function TurkiyeMapWeb({
  digest,
  selectedPlate,
  pulsePlates,
  spotlightPlates,
  contestedPlates,
  onSelect,
}: TurkiyeMapProps) {
  const colorByPlate = useTweenedColors(useColorByPlate(digest));
  const vb = parseViewBox(atlas.viewBox);

  return (
    <View style={styles.wrap} testID="turkiye-map">
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
        <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={colors.mapBase} />
        {atlas.features.map((f) => (
          <ProvincePathWeb
            key={f.plate}
            feature={f}
            paint={provinceStyle(
              f.plate,
              colorByPlate,
              selectedPlate,
              pulsePlates,
              spotlightPlates,
            )}
            onSelect={onSelect}
          />
        ))}
        <ContestedPulseWeb plates={contestedPlates} />
        <SpotlightHaloWeb plates={spotlightPlates} />
      </svg>
    </View>
  );
}

function TurkiyeMapNative({
  digest,
  selectedPlate,
  pulsePlates,
  spotlightPlates,
  contestedPlates,
  onSelect,
}: TurkiyeMapProps) {
  const colorByPlate = useTweenedColors(useColorByPlate(digest));
  const vb = parseViewBox(atlas.viewBox);

  return (
    <View style={styles.wrap} collapsable={false} testID="turkiye-map">
      <Svg
        width="100%"
        height="100%"
        viewBox={atlas.viewBox}
        preserveAspectRatio="xMidYMid meet"
        accessibilityLabel="Türkiye illeri haritası"
      >
        <Rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={colors.mapBase} />
        {atlas.features.map((f) => (
          <ProvincePathNative
            key={f.plate}
            feature={f}
            paint={provinceStyle(
              f.plate,
              colorByPlate,
              selectedPlate,
              pulsePlates,
              spotlightPlates,
            )}
            onSelect={onSelect}
          />
        ))}
        <ContestedPulseNative plates={contestedPlates} />
        <SpotlightHaloNative plates={spotlightPlates} />
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
    backgroundColor: colors.mapBase,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  emptyTitle: {
    ...typeRoles.title,
    fontFamily: fonts.display,
    fontSize: 16,
    marginBottom: 6,
  },
  emptyBody: {
    ...typeRoles.meta,
    textAlign: "center",
    color: colors.muted,
  },
});
