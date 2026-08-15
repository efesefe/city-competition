"use client";

import { useEffect, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";
import {
  ambientSpritesEnabled,
  CREATURE_SVGS,
  dayNightTint,
  fadeOpacity,
  isAmbientDebugEnabled,
  istanbulHour,
  nextAmbientDelayMs,
  pickAmbientSpawn,
  pointInRect,
  rectToMapSpace,
  sampleCubicLngLat,
  screenTangentRad,
  supportSheetViewportRect,
  CITY_CLEARANCE_PX,
  type CreatureKind,
  type DayNightTint,
  type LngLat,
} from "@/lib/map/ambientAssets";
import { shouldReduceMotion } from "@/lib/reduceMotion";
import styles from "./AmbientLayer.module.css";

type AmbientLayerProps = {
  map: maplibregl.Map;
  selectedCentroid?: LngLat | null;
  sheetOpen?: boolean;
  perfModeEnabled?: boolean;
};

const TINT_REFRESH_MS = 60_000;

function CreatureSvg({ kind }: { kind: CreatureKind }) {
  const def = CREATURE_SVGS[kind];
  return (
    <svg
      className={styles.spriteSvg}
      viewBox={def.viewBox}
      width={def.width}
      height={def.height}
      aria-hidden="true"
      focusable="false"
    >
      {def.paths.map((p) => (
        <path key={p.d} d={p.d} fill={p.fill} />
      ))}
    </svg>
  );
}

function currentTint(): DayNightTint {
  return dayNightTint(istanbulHour(new Date()));
}

export default function AmbientLayer({
  map,
  selectedCentroid = null,
  sheetOpen = false,
  perfModeEnabled = false,
}: AmbientLayerProps) {
  const [tint, setTint] = useState<DayNightTint>(currentTint);
  const [spriteKind, setSpriteKind] = useState<CreatureKind | null>(null);
  const spriteRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef(selectedCentroid);
  const sheetOpenRef = useRef(sheetOpen);
  const perfRef = useRef(perfModeEnabled);

  selectedRef.current = selectedCentroid;
  sheetOpenRef.current = sheetOpen;
  perfRef.current = perfModeEnabled;

  useEffect(() => {
    const refresh = () => setTint(currentTint());
    refresh();
    const id = window.setInterval(refresh, TINT_REFRESH_MS);
    const onVis = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeoutId = 0;
    let rafId = 0;
    let flying = false;

    const hideSprite = () => {
      flying = false;
      if (!cancelled) {
        setSpriteKind(null);
      }
      const el = spriteRef.current;
      if (el) {
        el.style.opacity = "0";
      }
    };

    const spritesOn = () =>
      ambientSpritesEnabled({
        reduceMotion: shouldReduceMotion(),
        perfMode: perfRef.current,
      });

    const sheetRectInMapSpace = () => {
      if (!sheetOpenRef.current) return null;
      const container = map.getContainer();
      const c = container.getBoundingClientRect();
      const viewport = supportSheetViewportRect(
        window.innerWidth,
        window.innerHeight,
      );
      return rectToMapSpace(viewport, {
        left: c.left,
        top: c.top,
        right: c.right,
        bottom: c.bottom,
      });
    };

    const project = (p: LngLat) => {
      const pt = map.project([p.lng, p.lat]);
      return { x: pt.x, y: pt.y };
    };

    const schedule = () => {
      if (cancelled || !spritesOn()) return;
      const delay = nextAmbientDelayMs(Math.random, isAmbientDebugEnabled());
      timeoutId = window.setTimeout(trySpawn, delay);
    };

    const trySpawn = () => {
      if (cancelled || !spritesOn() || document.hidden) {
        schedule();
        return;
      }
      const spawn = pickAmbientSpawn({
        selectedCentroid: selectedRef.current,
        sheetRect: sheetRectInMapSpace(),
        project,
      });
      if (!spawn) {
        schedule();
        return;
      }
      setSpriteKind(spawn.kind);
      flying = true;
      const start = performance.now();

      const frame = (now: number) => {
        if (cancelled || document.hidden || !spritesOn()) {
          hideSprite();
          schedule();
          return;
        }
        const t = Math.min(1, (now - start) / spawn.durationMs);
        const lngLat = sampleCubicLngLat(spawn.points, t);
        const pos = project(lngLat);
        const city = selectedRef.current;
        if (city) {
          const c = project(city);
          if (Math.hypot(pos.x - c.x, pos.y - c.y) < CITY_CLEARANCE_PX) {
            hideSprite();
            schedule();
            return;
          }
        }
        const sheet = sheetRectInMapSpace();
        if (sheet && pointInRect(pos, sheet)) {
          hideSprite();
          schedule();
          return;
        }
        const tA = Math.max(0, t - 0.02);
        const tB = Math.min(1, t + 0.02);
        const a = project(sampleCubicLngLat(spawn.points, tA));
        const b = project(sampleCubicLngLat(spawn.points, tB));
        const rot = screenTangentRad(a, b);
        const flip = b.x < a.x;
        const el = spriteRef.current;
        if (el) {
          const scaleX = flip ? -1 : 1;
          const heading = flip ? rot + Math.PI : rot;
          el.style.opacity = String(fadeOpacity(t));
          el.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%) rotate(${heading}rad) scaleX(${scaleX})`;
        }
        if (t < 1) {
          rafId = window.requestAnimationFrame(frame);
        } else {
          hideSprite();
          schedule();
        }
      };

      rafId = window.requestAnimationFrame(frame);
    };

    if (spritesOn()) {
      schedule();
    } else {
      hideSprite();
    }

    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const onMotion = () => {
      if (!spritesOn()) {
        window.clearTimeout(timeoutId);
        window.cancelAnimationFrame(rafId);
        hideSprite();
      }
    };
    mq?.addEventListener("change", onMotion);
    const onVis = () => {
      if (document.hidden && flying) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
        hideSprite();
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      window.cancelAnimationFrame(rafId);
      mq?.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onVis);
      hideSprite();
    };
  }, [map, perfModeEnabled]);

  const motionOn = ambientSpritesEnabled({
    reduceMotion: shouldReduceMotion(),
    perfMode: perfModeEnabled,
  });

  return (
    <div
      className={styles.overlay}
      aria-hidden="true"
      data-testid="map-ambient-layer"
      data-ambient-tint={tint.kind}
      data-ambient-motion={motionOn ? "on" : "off"}
    >
      <div
        className={styles.tint}
        style={{ background: tint.cssBackground }}
        data-testid="map-ambient-tint"
      />
      <div
        ref={spriteRef}
        className={styles.sprite}
        data-testid="map-ambient-sprite"
        data-creature={spriteKind ?? "none"}
      >
        {spriteKind ? <CreatureSvg kind={spriteKind} /> : null}
      </div>
    </div>
  );
}
