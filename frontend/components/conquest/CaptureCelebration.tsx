"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCityData } from "@/context/CityDataContext";
import { useConquest } from "@/context/ConquestContext";
import {
  playCaptureSuccessSound,
  triggerCaptureHaptic,
} from "@/lib/conquest/captureSound";
import TribeCrestDisc from "@/components/conquest/TribeCrestDisc";
import styles from "./CaptureCelebration.module.css";

const HOLD_MS = 2400;

type Particle = {
  id: number;
  dx: number;
  dy: number;
  hue: number;
  delay: number;
};

function burstParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * 2 * i) / count + (i % 3) * 0.2;
    const dist = 42 + (i % 5) * 14;
    return {
      id: i,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      hue: 28 + (i * 17) % 80,
      delay: (i % 6) * 18,
    };
  });
}

function ParticleBurst({
  className,
  style,
}: {
  className: string;
  style?: CSSProperties;
}) {
  const particles = useMemo(() => burstParticles(18), []);
  return (
    <div className={className} style={style} aria-hidden>
      {particles.map((p) => (
        <span
          key={p.id}
          className={styles.particle}
          style={{
            ["--dx" as string]: `${p.dx}px`,
            ["--dy" as string]: `${p.dy}px`,
            ["--hue" as string]: String(p.hue),
            animationDelay: `${p.delay}ms`,
          }}
        />
      ))}
    </div>
  );
}

export default function CaptureCelebration() {
  const t = useTranslations("conquest");
  const pathname = usePathname();
  const { tribesById } = useCityData();
  const { celebration, clearCelebration, projectCity } = useConquest();
  const [mapPoint, setMapPoint] = useState<{ x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    if (!celebration) {
      setMapPoint(null);
      return;
    }
    playCaptureSuccessSound();
    triggerCaptureHaptic();
    if (pathname === "/map" || pathname.startsWith("/map/")) {
      setMapPoint(projectCity(celebration.il_code));
    } else {
      setMapPoint(null);
    }
    const timer = window.setTimeout(() => clearCelebration(), HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [celebration, clearCelebration, pathname, projectCity]);

  if (!celebration) {
    return null;
  }

  const tribe = tribesById[celebration.new_tribe_id];

  return (
    <div
      className={styles.overlay}
      data-testid="capture-celebration"
      data-il={celebration.il_code}
      data-log-id={celebration.id}
      role="status"
      aria-live="assertive"
    >
      <ParticleBurst className={styles.centerBurst} />
      {mapPoint ? (
        <ParticleBurst
          className={styles.mapBurst}
          style={{ left: mapPoint.x, top: mapPoint.y }}
        />
      ) : null}
      <div className={styles.card}>
        <TribeCrestDisc tribe={tribe} size="lg" />
        <p className={styles.kicker}>{t("celebrationKicker")}</p>
        <p className={styles.city}>{celebration.city_name}</p>
      </div>
    </div>
  );
}
