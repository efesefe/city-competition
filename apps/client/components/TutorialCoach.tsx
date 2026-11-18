import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { TutorialState } from "../lib/api";
import { colors, fonts, radii, space, type as typeRoles } from "../lib/theme";

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
            <ActivityIndicator color={colors.ink} />
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
    case "capture": {
      const needed = tutorial.captureConfirmsNeeded ?? 3;
      const confirms = tutorial.captureConfirms ?? 0;
      const progress =
        confirms > 0
          ? `Onay ${confirms}/${needed} (flip şart değil) / Confirms ${confirms}/${needed} (flip not required)`
          : tutorial.capturePlate
            ? `Plaka ${tutorial.capturePlate} — 3 onay veya flip`
            : null;
      return {
        title: tutorial.captureName
          ? `Ele geçir: ${tutorial.captureName}`
          : "Bir şehir ele geçir",
        body: "Spend energy. When your tribe leads, the city is yours — live. / Enerji harca. Kabilen öne geçince şehir senin olur — anında.",
        detail: progress,
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
    }
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
    left: space.md,
    right: space.md,
    bottom: 72,
    zIndex: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.stroke,
    padding: space.lg,
    gap: space.sm,
  },
  kicker: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.accent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  title: {
    ...typeRoles.headline,
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: "700",
    color: colors.ink,
  },
  body: {
    ...typeRoles.body,
    fontFamily: fonts.body,
    color: colors.inkDim,
    lineHeight: 20,
  },
  detail: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.muted,
  },
  cta: {
    marginTop: space.sm,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  ctaText: {
    ...typeRoles.cta,
    fontFamily: fonts.body,
    color: colors.ink,
  },
  skip: { alignItems: "center", paddingVertical: space.sm },
  skipText: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.muted,
    textDecorationLine: "underline",
  },
  disabled: { opacity: 0.55 },
});
