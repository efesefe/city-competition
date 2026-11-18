import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  DEFAULT_BOOST,
  effectiveSupport,
  type BoostSnapshot,
  type CitySheet as CitySheetData,
  type PublicUser,
} from "../lib/api";
import { needsPhoneVerify } from "../lib/play-gates";
import { colors, fonts, radii, space, type as typeRoles } from "../lib/theme";
import { ConfirmSpendModal } from "./ConfirmSpendModal";
import { GuestLoginWall } from "./GuestLoginWall";
import { PhoneVerifyWall } from "./PhoneVerifyWall";

type Props = {
  sheet: CitySheetData | null;
  loading?: boolean;
  /** Compose with map harden (#37) when present. */
  loadError?: string | null;
  user: PublicUser | null;
  actionCost: number;
  /** Live boost snapshot from /v1/me (personal × team). */
  boost?: BoostSnapshot;
  /** Logged-in support share CTA (CC-59). */
  shareAvailable?: boolean;
  /** Show accomplishment share after a successful flip. */
  flippedShareAvailable?: boolean;
  onClose: () => void;
  onPlay: () => void;
  onSpend: (amount: number) => Promise<void | { flipped: boolean } | undefined>;
  onClaim?: () => void;
  onShop?: () => void;
  onShareSupport?: () => Promise<void>;
  onShareFlip?: () => Promise<void>;
};

function displayHandle(handle: string): string {
  const trimmed = handle.trim();
  if (!trimmed) return "@—";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function clampCost(n: number): number {
  if (!Number.isFinite(n)) return 15;
  return Math.min(20, Math.max(10, Math.round(n)));
}

export function CitySheetModal({
  sheet,
  loading,
  loadError,
  user,
  actionCost,
  boost = DEFAULT_BOOST,
  shareAvailable,
  flippedShareAvailable,
  onClose,
  onPlay,
  onSpend,
  onClaim,
  onShop,
  onShareSupport,
  onShareFlip,
}: Props) {
  const cost = clampCost(actionCost);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setConfirmOpen(false);
    setBusy(false);
  }, [sheet?.plate]);

  const unverified = needsPhoneVerify(user);
  const readyToSpend = Boolean(user?.phoneVerified && user.tribeId);
  const energy = user?.energy.total ?? 0;
  const canAfford = readyToSpend && energy >= cost;

  const ownsCity = Boolean(
    user?.tribeId && sheet?.ownerTeamId && user.tribeId === sheet.ownerTeamId,
  );
  const combatLabel = ownsCity ? "Defend" : "Attack";
  const combatLabelTr = ownsCity ? "Savun" : "Saldır";

  const credited = useMemo(() => effectiveSupport(cost, boost), [cost, boost]);
  const boosted =
    boost.personalBoostPct !== 1 || boost.teamBoostPct !== 1;
  const canShare = !!(user?.phoneVerified && user.tribeId);

  const runShare = async (fn?: () => Promise<void>) => {
    if (!fn || !canShare) return;
    setShareBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "share_failed");
    } finally {
      setShareBusy(false);
    }
  };

  /** Sheet CTA never spends — only opens the always-confirm modal (or auth). */
  const openConfirm = () => {
    setError(null);
    if (!user) {
      onPlay();
      return;
    }
    if (!user.phoneVerified || !user.tribeId) {
      onPlay();
      return;
    }
    // Always open confirm — even when underfunded (wireframes insufficient path).
    setConfirmOpen(true);
  };

  const doSpend = async () => {
    if (!confirmOpen) {
      setError("confirm_required");
      return;
    }
    if (busy) return;
    if (energy < cost) {
      setError("Yetersiz enerji / Not enough energy");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSpend(cost);
      setConfirmOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "spend_failed");
    } finally {
      setBusy(false);
    }
  };

  const visible = !!sheet || !!loading || !!loadError;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} accessibilityLabel="sheet handle" />
          {loading ? (
            <ActivityIndicator color={colors.accent} />
          ) : loadError || !sheet ? (
            <>
              <View style={styles.header}>
                <Text style={styles.title}>Şehir</Text>
                <Pressable onPress={onClose} hitSlop={12}>
                  <Text style={styles.close}>Kapat</Text>
                </Pressable>
              </View>
              <Text style={styles.error}>{loadError || "Şehir yüklenemedi"}</Text>
            </>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.header}>
                <Text style={styles.title}>{sheet.nameTr}</Text>
                <Pressable onPress={onClose} hitSlop={12}>
                  <Text style={styles.close}>Kapat</Text>
                </Pressable>
              </View>

              <Text style={styles.owner}>
                Owner:{" "}
                <Text style={{ color: sheet.ownerColor || colors.ink }}>
                  {sheet.ownerAlias || "—"}
                </Text>
              </Text>
              <Text style={styles.ownerTr}>
                Sahip:{" "}
                <Text style={{ color: sheet.ownerColor || colors.ink }}>
                  {sheet.ownerAlias || "—"}
                </Text>
              </Text>

              <Text style={styles.section}>Lead</Text>
              {sheet.support.length === 0 ? (
                <Text style={styles.meta}>Henüz destek yok.</Text>
              ) : (
                sheet.support.slice(0, 3).map((s) => {
                  const isYou = Boolean(user?.tribeId && s.teamId === user.tribeId);
                  return (
                    <View key={s.teamId} style={styles.row}>
                      <View style={[styles.dot, { backgroundColor: s.color }]} />
                      <Text style={[styles.rowText, isYou && styles.youText]}>
                        {s.alias}
                        {isYou ? "  ← you" : ""}
                      </Text>
                      <Text style={styles.rowVal}>{Math.round(s.support)}</Text>
                    </View>
                  );
                })
              )}
              {sheet.support.length > 0 ? (
                <Text style={styles.meta}>Fark: {Math.round(sheet.leadMargin)} destek</Text>
              ) : null}


                  {shareAvailable && onShareSupport ? (
                    <Pressable
                      style={[styles.shareBtn, shareBusy && styles.ctaDisabled]}
                      disabled={shareBusy}
                      onPress={() => void runShare(onShareSupport)}
                    >
                      <Text style={styles.shareText}>
                        {shareBusy ? "…" : "Paylaş — destek"}
                      </Text>
                    </Pressable>
                  ) : null}
                  {flippedShareAvailable && onShareFlip ? (
                    <Pressable
                      style={[styles.shareBtn, shareBusy && styles.ctaDisabled]}
                      disabled={shareBusy}
                      onPress={() => void runShare(onShareFlip)}
                    >
                      <Text style={styles.shareText}>
                        {shareBusy ? "…" : "Paylaş — aldık!"}
                      </Text>
                    </Pressable>
                  ) : null}
              <Text style={styles.section}>Top contributors</Text>
              <Text style={styles.sectionTr}>En çok katkı (gerçek handle)</Text>
              {sheet.topContributors.length === 0 ? (
                <Text style={styles.meta}>Henüz oyuncu harcaması yok (tohumlar aktif).</Text>
              ) : (
                sheet.topContributors.map((c, i) => (
                  <View key={`${c.handle}-${i}`} style={styles.row}>
                    <Text style={styles.rank}>{i + 1}.</Text>
                    <Text style={styles.handleText}>{displayHandle(c.handle)}</Text>
                    <Text style={styles.tribeChip} numberOfLines={1}>
                      {c.alias || "—"}
                    </Text>
                    <Text style={styles.rowVal}>{Math.round(c.support)}</Text>
                  </View>
                ))
              )}

              {boosted ? (
                <View style={styles.boostBox}>
                  <Text style={styles.section}>Boosted support</Text>
                  <Text style={styles.boostLine}>
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
                </View>
              ) : null}

              {readyToSpend ? (
                <View style={styles.spendBox}>
                  <Text style={styles.energyLine}>⚡ {energy} mevcut</Text>
                  <Pressable
                    style={[styles.cta, busy && styles.ctaDisabled]}
                    disabled={busy}
                    onPress={openConfirm}
                    accessibilityRole="button"
                    accessibilityLabel={`${combatLabel} ${cost} energy — opens confirm`}
                  >
                    <Text style={styles.ctaText}>
                      {combatLabelTr} · {combatLabel} · {cost} ⚡
                    </Text>
                  </Pressable>
                  {!canAfford ? (
                    <View style={styles.insuffRow}>
                      <Text style={styles.meta}>Yetersiz enerji — günlük al veya dükkan.</Text>
                      <View style={styles.insuffActions}>
                        {onClaim ? (
                          <Pressable style={styles.chip} onPress={onClaim}>
                            <Text style={styles.chipText}>Claim</Text>
                          </Pressable>
                        ) : null}
                        {onShop ? (
                          <Pressable style={styles.chip} onPress={onShop}>
                            <Text style={styles.chipText}>Dükkan</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : unverified ? (
                <PhoneVerifyWall kind="spend" onVerify={onPlay} compact />
              ) : !user ? (
                <GuestLoginWall variant="support" onLogin={onPlay} />
              ) : (
                <Pressable style={styles.cta} onPress={onPlay}>
                  <Text style={styles.ctaText}>Kabile seç</Text>
                  <Text style={styles.ctaSub}>Pick your tribe</Text>
                </Pressable>
              )}
              {error && !confirmOpen ? <Text style={styles.error}>{error}</Text> : null}
            </ScrollView>
          )}
        </View>
      </View>

      <ConfirmSpendModal
        visible={confirmOpen}
        cityName={sheet?.nameTr || ""}
        tribeAlias={user?.tribeAlias ?? null}
        mode={ownsCity ? "defend" : "attack"}
        cost={cost}
        energy={energy}
        boost={boost}
        busy={busy}
        error={error}
        onCancel={() => {
          if (!busy) {
            setConfirmOpen(false);
            setError(null);
          }
        }}
        onConfirm={() => {
          void doSpend();
        }}
        onClaim={
          onClaim
            ? () => {
                setConfirmOpen(false);
                onClaim();
              }
            : undefined
        }
        onShop={
          onShop
            ? () => {
                setConfirmOpen(false);
                onShop();
              }
            : undefined
        }
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: colors.overlayScrim,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.stroke,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.xl,
    gap: space.sm,
    maxHeight: "78%",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.stroke,
    marginBottom: space.sm,
  },
  scroll: { flexGrow: 0 },
  scrollContent: { gap: space.sm, paddingBottom: space.sm },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: {
    ...typeRoles.title,
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: "700",
    color: colors.ink,
    flexShrink: 1,
  },
  close: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.muted,
    fontSize: 15,
  },
  owner: {
    ...typeRoles.headline,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.inkDim,
    marginTop: space.xs,
  },
  ownerTr: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.muted,
  },
  meta: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.muted,
  },
  section: {
    marginTop: space.md,
    fontFamily: fonts.body,
    color: colors.inkDim,
    fontSize: 13,
    letterSpacing: 0.3,
    fontWeight: "600",
  },
  sectionTr: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.mutedDim,
    marginTop: -2,
  },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 3 },
  dot: { width: 10, height: 10, borderRadius: 2 },
  rank: { color: colors.mutedDim, width: 22, fontSize: 13, fontFamily: fonts.body },
  handleText: {
    fontFamily: fonts.body,
    color: colors.ink,
    fontWeight: "600",
    minWidth: 88,
  },
  tribeChip: { flex: 1, color: colors.muted, fontSize: 13, fontFamily: fonts.body },
  rowText: { flex: 1, color: colors.ink, fontFamily: fonts.body },
  youText: { color: colors.accent, fontWeight: "700" },
  rowVal: {
    ...typeRoles.tabular,
    fontFamily: fonts.body,
    color: colors.inkDim,
  },
  boostBox: { marginTop: space.xs, gap: 2 },
  boostLine: {
    fontFamily: fonts.body,
    color: colors.ink,
    fontSize: 15,
  },
  spendBox: { marginTop: space.md, gap: space.sm },
  energyLine: {
    ...typeRoles.tabular,
    fontFamily: fonts.body,
    color: colors.inkDim,
  },
  insuffRow: { gap: space.sm },
  insuffActions: { flexDirection: "row", gap: space.sm },
  chip: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: {
    fontFamily: fonts.body,
    color: colors.inkDim,
    fontSize: 13,
    fontWeight: "600",
  },
  cta: {
    backgroundColor: colors.accent,
    paddingVertical: 12,
    borderRadius: radii.md,
    alignItems: "center",
    marginTop: space.sm,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: {
    ...typeRoles.cta,
    fontFamily: fonts.body,
    color: colors.ink,
  },
  ctaSub: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.ink,
    opacity: 0.85,
    marginTop: 2,
  },
  shareBtn: {
    paddingVertical: 10,
    alignItems: "center",
    marginTop: space.sm,
  },
  shareText: {
    fontFamily: fonts.body,
    color: colors.accent,
    fontWeight: "700",
    fontSize: 14,
  },
  error: { color: colors.danger, marginTop: space.sm, fontFamily: fonts.body },
});
