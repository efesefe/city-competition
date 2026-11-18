import React, { memo, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MatchDayEvent } from "../lib/api";
import { boostPctLabel, formatCountdown } from "../lib/matchDayChrome";
import { colors, fonts, radii, space } from "../lib/theme";

type Props = {
  event: MatchDayEvent;
  onPressSpotlight?: () => void;
};

/**
 * Thin match-day team-boost banner (wireframes §5). Locked with map spotlight —
 * do not ship banner-only / spotlight-only chrome.
 *
 * Countdown state stays local (memo) so parent map screen is not thrashing every tick.
 */
export const MatchDayBanner = memo(function MatchDayBanner({
  event,
  onPressSpotlight,
}: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const arm = () => {
      if (id) clearInterval(id);
      // Coarse while plenty of time left; 1s only in the last two minutes.
      const msLeft = new Date(event.endsAt).getTime() - Date.now();
      const period = msLeft > 120_000 ? 5_000 : 1_000;
      id = setInterval(() => {
        const t = Date.now();
        setNow(t);
        if (period > 1_000 && new Date(event.endsAt).getTime() - t <= 120_000) {
          arm();
        }
      }, period);
    };
    arm();
    return () => {
      if (id) clearInterval(id);
    };
  }, [event.endsAt]);

  const pct = boostPctLabel(event.boostPct);
  const city = event.cityNameTr;
  const remaining = formatCountdown(event.endsAt, now);
  const accent = event.teamColor || colors.accent;

  return (
    <Pressable
      style={[styles.banner, { borderColor: accent }]}
      onPress={onPressSpotlight}
      accessibilityRole="button"
      accessibilityLabel={`Maç günü ${event.teamAlias} ${pct}${city ? `, ${city}` : ""}`}
      testID="match-day-banner"
    >
      <View style={[styles.pip, { backgroundColor: accent }]} />
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>
          Maç günü {pct} takım boost
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {event.teamAlias}
          {city ? ` · ${city}` : ""}
          {` · ${remaining}`}
        </Text>
      </View>
      {city ? (
        <Text style={styles.cta} numberOfLines={1}>
          Spotlight
        </Text>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  pip: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  copy: { flex: 1, gap: 1 },
  title: {
    fontFamily: fonts.body,
    color: colors.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  meta: {
    fontFamily: fonts.body,
    color: colors.muted,
    fontSize: 12,
  },
  cta: {
    fontFamily: fonts.body,
    color: colors.inkDim,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
});
