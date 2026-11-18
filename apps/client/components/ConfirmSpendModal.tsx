import React, { useRef } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  DEFAULT_BOOST,
  effectiveSupport,
  type BoostSnapshot,
} from "../lib/api";
import { colors, fonts, radii, space, type as typeRoles } from "../lib/theme";

type Props = {
  visible: boolean;
  cityName: string;
  tribeAlias: string | null;
  /** Attack vs Defend framing (wireframes §7 Support / Defend). */
  mode: "attack" | "defend";
  cost: number;
  energy: number;
  boost?: BoostSnapshot;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  /** Only fires after explicit Confirm — never from the sheet CTA. */
  onConfirm: () => void;
  onClaim?: () => void;
  onShop?: () => void;
};

/**
 * Locked UX (wireframes §7): always confirm before deduct.
 * Spend must not run until the player taps Confirm / Onayla.
 */
export function ConfirmSpendModal({
  visible,
  cityName,
  tribeAlias,
  mode,
  cost,
  energy,
  boost = DEFAULT_BOOST,
  busy,
  error,
  onCancel,
  onConfirm,
  onClaim,
  onShop,
}: Props) {
  const confirming = useRef(false);
  const credited = effectiveSupport(cost, boost);
  const boosted = boost.personalBoostPct !== 1 || boost.teamBoostPct !== 1;
  const insufficient = energy < cost;
  const titlePrefix = mode === "defend" ? "Defend" : "Support";

  const handleConfirm = () => {
    if (busy || confirming.current || insufficient) return;
    confirming.current = true;
    try {
      onConfirm();
    } finally {
      // Parent clears busy; allow retry after a tick if confirm stayed open.
      setTimeout(() => {
        confirming.current = false;
      }, 400);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <View style={styles.card} accessibilityRole="summary">
          <Text style={styles.title}>
            {titlePrefix} {cityName}
          </Text>
          <Text style={styles.tribe}>{tribeAlias || "—"}</Text>

          <Text style={styles.meta}>Cost: {cost} ⚡</Text>
          <Text style={styles.meta}>You have: {energy} ⚡</Text>
          <Text style={styles.metaTr}>
            Maliyet: {cost} ⚡ · Mevcut: {energy} ⚡
          </Text>

          {boosted ? (
            <View style={styles.boostBox}>
              <Text style={styles.boostLabel}>Boosted support</Text>
              <Text style={styles.boostValue}>
                Base {cost} → effective {Math.round(credited * 1000) / 1000}
              </Text>
              <Text style={styles.meta}>
                {boost.personalBoostPct !== 1
                  ? `personal +${Math.round((boost.personalBoostPct - 1) * 100)}%`
                  : null}
                {boost.personalBoostPct !== 1 && boost.teamBoostPct !== 1 ? " · " : null}
                {boost.teamBoostPct !== 1
                  ? `team +${Math.round((boost.teamBoostPct - 1) * 100)}%`
                  : null}
              </Text>
              <Text style={styles.metaTr}>(after multipliers)</Text>
            </View>
          ) : (
            <Text style={styles.meta}>Support credited: {cost}</Text>
          )}

          {insufficient ? (
            <View style={styles.insuffBox}>
              <Text style={styles.error}>Not enough energy</Text>
              <Text style={styles.metaTr}>Yetersiz enerji</Text>
              <View style={styles.row}>
                {onClaim ? (
                  <Pressable style={styles.secondary} onPress={onClaim} accessibilityRole="button">
                    <Text style={styles.secondaryText}>Claim daily</Text>
                  </Pressable>
                ) : null}
                {onShop ? (
                  <Pressable
                    style={[styles.cta, styles.flex]}
                    onPress={onShop}
                    accessibilityRole="button"
                  >
                    <Text style={styles.ctaText}>Shop / Dükkan</Text>
                  </Pressable>
                ) : null}
              </View>
              <Pressable style={styles.linkBtn} onPress={onCancel}>
                <Text style={styles.linkText}>Vazgeç / Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.row}>
              <Pressable
                style={styles.secondary}
                onPress={onCancel}
                disabled={busy}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryText}>Vazgeç / Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.cta, styles.flex, busy && styles.ctaDisabled]}
                onPress={handleConfirm}
                disabled={!!busy}
                accessibilityRole="button"
                accessibilityLabel="Confirm spend"
              >
                <Text style={styles.ctaText}>{busy ? "…" : "Onayla / Confirm"}</Text>
              </Pressable>
            </View>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.lockHint}>Always confirm — locked UX</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlayScrim,
    justifyContent: "center",
    padding: space.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.stroke,
    padding: space.lg,
    gap: space.sm,
  },
  title: {
    ...typeRoles.title,
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: "700",
    color: colors.ink,
  },
  tribe: {
    ...typeRoles.headline,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.inkDim,
  },
  meta: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.muted,
  },
  metaTr: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.mutedDim,
  },
  boostBox: {
    marginTop: space.xs,
    padding: space.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    gap: 2,
  },
  boostLabel: {
    fontFamily: fonts.body,
    color: colors.accent,
    fontWeight: "700",
    fontSize: 13,
    letterSpacing: 0.3,
  },
  boostValue: {
    fontFamily: fonts.body,
    color: colors.ink,
    fontSize: 16,
    fontWeight: "600",
  },
  insuffBox: { marginTop: space.sm, gap: space.sm },
  row: { flexDirection: "row", gap: 10, marginTop: space.sm },
  flex: { flex: 1, marginTop: 0 },
  cta: {
    backgroundColor: colors.accent,
    paddingVertical: 12,
    borderRadius: radii.md,
    alignItems: "center",
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: {
    ...typeRoles.cta,
    fontFamily: fonts.body,
    color: colors.ink,
  },
  secondary: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  secondaryText: {
    fontFamily: fonts.body,
    color: colors.inkDim,
    fontWeight: "600",
  },
  linkBtn: { alignItems: "center", paddingVertical: space.sm },
  linkText: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.muted,
  },
  error: { color: colors.danger, marginTop: space.xs, fontFamily: fonts.body },
  lockHint: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.mutedDim,
    fontSize: 11,
    marginTop: space.xs,
  },
});
