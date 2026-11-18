import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PHONE_KABILE_WALL, PHONE_SPEND_WALL, PHONE_VERIFY_WALL } from "../lib/play-gates";
import { colors, fonts, radii, space, type as typeRoles } from "../lib/theme";

type Kind = "play" | "spend" | "kabile";

type Props = {
  kind?: Kind;
  onVerify?: () => void;
  compact?: boolean;
  /** When true, copy only (e.g. already on /auth with OTP form below). */
  hideCta?: boolean;
};

function copy(kind: Kind) {
  if (kind === "spend") return PHONE_SPEND_WALL;
  if (kind === "kabile") return PHONE_KABILE_WALL;
  return PHONE_VERIFY_WALL;
}

/** Clear UX wall for logged-in users who still need phone verification. */
export function PhoneVerifyWall({ kind = "play", onVerify, compact, hideCta }: Props) {
  const wall = copy(kind);
  return (
    <View style={[styles.box, compact && styles.compact]} accessibilityRole="summary">
      <Text style={styles.tr}>{wall.tr}</Text>
      <Text style={styles.en}>{wall.en}</Text>
      {!compact ? (
        <Text style={styles.note}>Atlanamaz. Harita arkasında gezinmeye devam edilebilir.</Text>
      ) : null}
      {!hideCta && onVerify ? (
        <Pressable style={styles.cta} onPress={onVerify} accessibilityRole="button">
          <Text style={styles.ctaText}>Doğrula / Verify</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: space.md,
    gap: space.sm,
    paddingVertical: space.md,
  },
  compact: { paddingVertical: space.sm },
  tr: {
    ...typeRoles.headline,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
    lineHeight: 22,
  },
  en: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.muted,
    lineHeight: 18,
  },
  note: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.mutedDim,
    marginTop: 2,
  },
  cta: {
    marginTop: space.sm,
    backgroundColor: colors.accent,
    paddingVertical: 12,
    borderRadius: radii.md,
    alignItems: "center",
  },
  ctaText: {
    ...typeRoles.cta,
    fontFamily: fonts.body,
    color: colors.ink,
  },
});
