"use client";

import { useCallback, useEffect, useState } from "react";
import type { MapProjectFn } from "@/context/ConquestContext";
import {
  CITY_SUPPORT_SHEET_TEST_ID,
  CREDIT_BALANCE_TEST_ID,
  CREDIT_FLOW_DURATION_MS,
  CREDIT_FLOW_STAGGER_MS,
  MAP_CANVAS_TEST_ID,
  decideCreditFlow,
  defaultSheetRect,
  rectCenter,
  type CoinSpec,
  type Point,
} from "@/lib/creditFlow";
import type { Rect } from "@/lib/map/ambientAssets";
import { shouldReduceMotion } from "@/lib/reduceMotion";
import styles from "./CreditFlowAnimation.module.css";

export const BALANCE_TICK_COLOR = "#e8c547";
export const BALANCE_TICK_REST_COLOR = "#e8efe9";
export const BALANCE_TICK_MS = 220;

type Burst = {
  id: number;
  origin: Point;
  coins: CoinSpec[];
};

type BurstListener = (burst: Burst) => void;

const listeners = new Set<BurstListener>();
let nextBurstId = 1;

function emitBurst(burst: Burst): void {
  listeners.forEach((listener) => listener(burst));
}

export function subscribeCreditFlow(listener: BurstListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readRect(testId: string): Rect | null {
  if (typeof document === "undefined") {
    return null;
  }
  const el = document.querySelector(`[data-testid="${testId}"]`);
  if (!el) {
    return null;
  }
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

export function tickBalanceElement(el: Element | null): boolean {
  if (!el || typeof (el as HTMLElement).animate !== "function") {
    return false;
  }
  (el as HTMLElement).animate(
    [{ color: BALANCE_TICK_COLOR }, { color: BALANCE_TICK_REST_COLOR }],
    { duration: BALANCE_TICK_MS, easing: "ease-out" },
  );
  return true;
}

/**
 * Fire-and-forget visual for a successful support spend. Never awaits,
 * never calls wallet optimistic/reconcile helpers.
 */
export function playCreditFlow(input: {
  ilCode: string;
  projectCity: MapProjectFn;
}): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const originRect = readRect(CREDIT_BALANCE_TEST_ID);
  const mapRect = readRect(MAP_CANVAS_TEST_ID);
  const sheetFromDom = readRect(CITY_SUPPORT_SHEET_TEST_ID);
  const sheetRect =
    sheetFromDom ?? defaultSheetRect(window.innerWidth, window.innerHeight);
  const decision = decideCreditFlow({
    reduceMotion: shouldReduceMotion(),
    origin: originRect ? rectCenter(originRect) : null,
    mapPoint: input.projectCity(input.ilCode),
    mapRect,
    sheetRect,
  });
  if (decision.kind === "skip") {
    return;
  }
  if (decision.kind === "tick") {
    tickBalanceElement(
      document.querySelector(`[data-testid="${CREDIT_BALANCE_TEST_ID}"]`),
    );
    return;
  }
  emitBurst({
    id: nextBurstId,
    origin: decision.origin,
    coins: decision.coins,
  });
  nextBurstId += 1;
}

function CoinSvg() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden focusable="false">
      <circle cx="8" cy="8" r="7" fill="#e0b44a" stroke="#f5e6a8" strokeWidth="1.2" />
      <circle cx="6.1" cy="5.8" r="2.1" fill="rgba(255,255,255,0.38)" />
    </svg>
  );
}

function BurstCoins({
  burst,
  onDone,
}: {
  burst: Burst;
  onDone: (id: number) => void;
}) {
  const lastDelay = burst.coins.reduce(
    (max, coin) => Math.max(max, coin.delayMs),
    0,
  );

  useEffect(() => {
    const wait = CREDIT_FLOW_DURATION_MS + lastDelay + CREDIT_FLOW_STAGGER_MS;
    const timer = window.setTimeout(() => onDone(burst.id), wait);
    return () => window.clearTimeout(timer);
  }, [burst.id, lastDelay, onDone]);

  return (
    <div data-testid="credit-flow-burst" data-burst-id={burst.id}>
      {burst.coins.map((coin) => (
        <span
          key={coin.id}
          className={styles.coin}
          data-testid="credit-flow-coin"
          style={{
            left: burst.origin.x,
            top: burst.origin.y,
            ["--delay" as string]: `${coin.delayMs}ms`,
            ["--mx" as string]: `${coin.mx}px`,
            ["--my" as string]: `${coin.my}px`,
            ["--dx" as string]: `${coin.dx}px`,
            ["--dy" as string]: `${coin.dy}px`,
          }}
        >
          <CoinSvg />
        </span>
      ))}
    </div>
  );
}

export default function CreditFlowAnimation() {
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(() => {
    return subscribeCreditFlow((burst) => {
      setBursts((prev) => [...prev, burst]);
    });
  }, []);

  const removeBurst = useCallback((id: number) => {
    setBursts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  if (bursts.length === 0) {
    return null;
  }

  return (
    <div
      className={styles.layer}
      aria-hidden
      data-testid="credit-flow-layer"
    >
      {bursts.map((burst) => (
        <BurstCoins key={burst.id} burst={burst} onDone={removeBurst} />
      ))}
    </div>
  );
}
