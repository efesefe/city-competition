import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PHONE_KABILE_WALL, PHONE_SPEND_WALL, PHONE_VERIFY_WALL } from "../lib/play-gates";

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
    marginTop: 10,
    gap: 6,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3d5a4c",
    backgroundColor: "#0f1c16",
  },
  compact: { padding: 12 },
  tr: { color: "#f4e7c5", fontSize: 15, fontWeight: "600", lineHeight: 22 },
  en: { color: "#9bb0a3", fontSize: 13, lineHeight: 18 },
  note: { color: "#6b7c72", fontSize: 12, marginTop: 2 },
  cta: {
    marginTop: 8,
    backgroundColor: "#c8a96b",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  ctaText: { color: "#0b1f17", fontWeight: "700", fontSize: 16 },
});
