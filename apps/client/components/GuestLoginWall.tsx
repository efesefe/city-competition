import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GUEST_LOGIN_WALL, GUEST_SUPPORT_CTA } from "../lib/play-gates";
import { colors, fonts, radii, space, type as typeRoles } from "../lib/theme";

type Props = {
  /** City-sheet support CTA vs generic action wall. */
  variant?: "support" | "action";
  onLogin: () => void;
};

/** Guests browse only — other actions redirect to login/signup (CC-23). */
export function GuestLoginWall({ variant = "action", onLogin }: Props) {
  const headline = variant === "support" ? GUEST_SUPPORT_CTA : GUEST_LOGIN_WALL;
  return (
    <View style={styles.box} accessibilityRole="summary">
      <Text style={styles.tr}>{headline.tr}</Text>
      <Text style={styles.en}>{headline.en}</Text>
      {variant === "action" ? (
        <Text style={styles.note}>Harita, şehir kartı ve skor tablosu serbest.</Text>
      ) : null}
      <Pressable style={styles.cta} onPress={onLogin} accessibilityRole="button">
        <Text style={styles.ctaText}>Giriş / Sign up</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: space.md,
    gap: space.sm,
    paddingVertical: space.md,
  },
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
