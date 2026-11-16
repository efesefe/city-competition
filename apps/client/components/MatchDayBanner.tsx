import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MatchDayEvent } from "../lib/api";
import { boostPctLabel, formatCountdown } from "../lib/matchDayChrome";

type Props = {
  event: MatchDayEvent;
  onPressSpotlight?: () => void;
};

/**
 * Thin match-day team-boost banner (wireframes §5). Locked with map spotlight —
 * do not ship banner-only / spotlight-only chrome.
 */
export function MatchDayBanner({ event, onPressSpotlight }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const pct = boostPctLabel(event.boostPct);
  const city = event.cityNameTr;
  const remaining = formatCountdown(event.endsAt, now);
  const accent = event.teamColor || "#c8a96b";

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
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: "rgba(12, 28, 22, 0.92)",
  },
  pip: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  copy: { flex: 1, gap: 1 },
  title: {
    color: "#f4e7c5",
    fontSize: 13,
    fontWeight: "700",
  },
  meta: {
    color: "#9bb0a3",
    fontSize: 12,
  },
  cta: {
    color: "#c8a96b",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
});
