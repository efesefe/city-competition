import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GUEST_LOGIN_WALL, GUEST_SUPPORT_CTA } from "../lib/play-gates";

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
    marginTop: 10,
    gap: 6,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3d5a4c",
    backgroundColor: "#0f1c16",
  },
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
