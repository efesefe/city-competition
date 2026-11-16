import React, { useRef } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  DEFAULT_BOOST,
  effectiveSupport,
  type BoostSnapshot,
} from "../lib/api";

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
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#13261d",
    borderRadius: 14,
    padding: 18,
    gap: 8,
  },
  title: {
    fontFamily: "Georgia",
    fontSize: 22,
    color: "#f4e7c5",
    fontWeight: "700",
  },
  tribe: { color: "#d8c9a3", fontSize: 15 },
  meta: { color: "#9bb0a3", fontSize: 13 },
  metaTr: { color: "#6b7c72", fontSize: 12 },
  boostBox: {
    marginTop: 4,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3d5a4c",
    backgroundColor: "#0f1c16",
    gap: 2,
  },
  boostLabel: { color: "#c8a96b", fontWeight: "700", fontSize: 13, letterSpacing: 0.3 },
  boostValue: { color: "#e8efe9", fontSize: 16, fontWeight: "600" },
  insuffBox: { marginTop: 6, gap: 8 },
  row: { flexDirection: "row", gap: 10, marginTop: 8 },
  flex: { flex: 1, marginTop: 0 },
  cta: {
    backgroundColor: "#c8a96b",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { color: "#0b1f17", fontWeight: "700", fontSize: 16 },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#3d5a4c",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  secondaryText: { color: "#d8c9a3" },
  linkBtn: { alignItems: "center", paddingVertical: 8 },
  linkText: { color: "#9bb0a3" },
  error: { color: "#e07070", marginTop: 4 },
  lockHint: { color: "#6b7c72", fontSize: 11, marginTop: 4 },
});
