import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { TutorialState } from "../lib/api";

type Props = {
  tutorial: TutorialState | null;
  busy?: boolean;
  onClaim: () => void;
  onOpenCapture: () => void;
  onOpenFight: () => void;
  onSkip: () => void;
  onDismissDone: () => void;
};

/**
 * One coach card at a time (wireframes §8). Skip allowed after verify/session.
 */
export function TutorialCoach({
  tutorial,
  busy,
  onClaim,
  onOpenCapture,
  onOpenFight,
  onSkip,
  onDismissDone,
}: Props) {
  if (!tutorial) return null;
  if (tutorial.skipped) return null;
  if (!tutorial.active && tutorial.step !== "done") return null;

  const copy = copyFor(tutorial);
  if (!copy) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none" testID="tutorial-coach">
      <View style={styles.card}>
        <Text style={styles.kicker}>Eğitim / Tutorial</Text>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>{copy.body}</Text>
        {copy.detail ? <Text style={styles.detail}>{copy.detail}</Text> : null}

        <Pressable
          style={[styles.cta, busy && styles.disabled]}
          onPress={copy.onPrimary({ onClaim, onOpenCapture, onOpenFight, onDismissDone })}
          disabled={busy}
          testID="tutorial-primary"
        >
          {busy ? (
            <ActivityIndicator color="#0b1f17" />
          ) : (
            <Text style={styles.ctaText}>{copy.cta}</Text>
          )}
        </Pressable>

        {tutorial.step !== "done" ? (
          <Pressable style={styles.skip} onPress={onSkip} disabled={busy} testID="tutorial-skip">
            <Text style={styles.skipText}>Eğitimi geç / Skip tutorial</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function copyFor(tutorial: TutorialState) {
  switch (tutorial.step) {
    case "claim":
      return {
        title: "Günlük enerjini al",
        body: "Claim your free energy — +100 ⚡. Resets 00:00 TR / 00:00 TR’de yenilenir.",
        detail: null as string | null,
        cta: "Al / Claim",
        onPrimary:
          (h: {
            onClaim: () => void;
            onOpenCapture: () => void;
            onOpenFight: () => void;
            onDismissDone: () => void;
          }) =>
          h.onClaim,
      };
    case "capture":
      return {
        title: tutorial.captureName
          ? `Ele geçir: ${tutorial.captureName}`
          : "Bir şehir ele geçir",
        body: "Spend energy. When your tribe leads, the city is yours — live. / Enerji harca. Kabilen öne geçince şehir senin olur — anında.",
        detail: tutorial.capturePlate ? `Plaka ${tutorial.capturePlate}` : null,
        cta: "Şehri aç / Open city",
        onPrimary:
          (h: {
            onClaim: () => void;
            onOpenCapture: () => void;
            onOpenFight: () => void;
            onDismissDone: () => void;
          }) =>
          h.onOpenCapture,
      };
    case "fight":
      return {
        title: tutorial.fightName ? `Savaşa katıl: ${tutorial.fightName}` : "Canlı savaşa katıl",
        body: "Hot cities move fast. Jump in while the fight is live. / Sıcak şehirler hızla değişir. Savaş varken gir.",
        detail: tutorial.fightPlate ? `Plaka ${tutorial.fightPlate}` : null,
        cta: "Savaşa katıl / Join fight",
        onPrimary:
          (h: {
            onClaim: () => void;
            onOpenCapture: () => void;
            onOpenFight: () => void;
            onDismissDone: () => void;
          }) =>
          h.onOpenFight,
      };
    case "done":
      if (tutorial.complete && !tutorial.skipped) {
        return {
          title: "Hazırsın / You’re in",
          body: "Claim energy every day at 00:00 TR. Flip cities. Climb the season board. / Her gün 00:00 TR’de enerji al. Şehir çevir. Sezon sıralamasına çık.",
          detail: null,
          cta: "Tamam / Got it",
          onPrimary:
            (h: {
              onClaim: () => void;
              onOpenCapture: () => void;
              onOpenFight: () => void;
              onDismissDone: () => void;
            }) =>
            h.onDismissDone,
        };
      }
      return null;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 72,
    zIndex: 20,
  },
  card: {
    backgroundColor: "#13261d",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#c8a96b",
    padding: 16,
    gap: 8,
  },
  kicker: {
    color: "#c8a96b",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: "Georgia",
    fontSize: 20,
    color: "#f4e7c5",
    fontWeight: "700",
  },
  body: { color: "#d8c9a3", fontSize: 14, lineHeight: 20 },
  detail: { color: "#9bb0a3", fontSize: 12 },
  cta: {
    marginTop: 6,
    backgroundColor: "#c8a96b",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  ctaText: { color: "#0b1f17", fontWeight: "700", fontSize: 16 },
  skip: { alignItems: "center", paddingVertical: 8 },
  skipText: { color: "#9bb0a3", fontSize: 13, textDecorationLine: "underline" },
  disabled: { opacity: 0.55 },
});
