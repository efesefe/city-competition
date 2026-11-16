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
import { isPhoneUnverifiedError, needsPhoneVerify, phoneGateMessage } from "../lib/play-gates";
import { GuestLoginWall } from "./GuestLoginWall";
import { PhoneVerifyWall } from "./PhoneVerifyWall";

type Props = {
  sheet: CitySheetData | null;
  loading?: boolean;
  /** Compose with map harden (#37) when present. */
  loadError?: string | null;
  user: PublicUser | null;
  actionCost: number;
  /** Optional boost snapshot; defaults to 1× / 1× until shop / match-day. */
  boost?: BoostSnapshot;
  onClose: () => void;
  onPlay: () => void;
  onSpend: (amount: number) => Promise<void>;
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
  onClose,
  onPlay,
  onSpend,
}: Props) {
  const cost = clampCost(actionCost);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setConfirmOpen(false);
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
    if (energy < cost) {
      setError("Yetersiz enerji / Not enough energy");
      return;
    }
    setConfirmOpen(true);
  };

  const doSpend = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSpend(cost);
      setConfirmOpen(false);
    } catch (e) {
      if (isPhoneUnverifiedError(e)) {
        setError(phoneGateMessage(e, "spend"));
        setConfirmOpen(false);
        return;
      }
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
            <ActivityIndicator color="#c8a96b" />
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
                <Text style={{ color: sheet.ownerColor || "#f4e7c5" }}>
                  {sheet.ownerAlias || "—"}
                </Text>
              </Text>
              <Text style={styles.ownerTr}>
                Sahip:{" "}
                <Text style={{ color: sheet.ownerColor || "#f4e7c5" }}>
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
                    Base {cost} → effective {Math.round(credited)}
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
                    style={[styles.cta, !canAfford && styles.ctaDisabled]}
                    disabled={!canAfford || busy}
                    onPress={openConfirm}
                    accessibilityRole="button"
                    accessibilityLabel={`${combatLabel} ${cost} energy`}
                  >
                    <Text style={styles.ctaText}>
                      {combatLabelTr} · {combatLabel} · {cost} ⚡
                    </Text>
                  </Pressable>
                  {!canAfford ? (
                    <Text style={styles.meta}>Yetersiz enerji — günlük al veya dükkan.</Text>
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
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </ScrollView>
          )}
        </View>
      </View>

      <Modal visible={confirmOpen} transparent animationType="fade">
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <Text style={styles.title}>
              {ownsCity ? "Defend" : "Support"} {sheet?.nameTr}
            </Text>
            <Text style={styles.ownerTr}>{user?.tribeAlias || "—"}</Text>
            <Text style={styles.meta}>Cost: {cost} ⚡</Text>
            <Text style={styles.meta}>You have: {energy} ⚡</Text>
            {boosted ? (
              <Text style={styles.meta}>Boosted support: {Math.round(credited)}</Text>
            ) : null}
            <Text style={styles.meta}>Always confirm — locked UX.</Text>
            <View style={styles.confirmRow}>
              <Pressable
                style={styles.secondary}
                onPress={() => setConfirmOpen(false)}
                disabled={busy}
              >
                <Text style={styles.secondaryText}>Vazgeç / Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.cta, styles.confirmCta]}
                onPress={doSpend}
                disabled={busy}
              >
                <Text style={styles.ctaText}>{busy ? "…" : "Onayla / Confirm"}</Text>
              </Pressable>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  sheet: {
    backgroundColor: "#13261d",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
    gap: 8,
    maxHeight: "78%",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#3d5a4c",
    marginBottom: 8,
  },
  scroll: { flexGrow: 0 },
  scrollContent: { gap: 6, paddingBottom: 8 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: {
    fontFamily: "Georgia",
    fontSize: 24,
    color: "#f4e7c5",
    fontWeight: "700",
    flexShrink: 1,
  },
  close: { color: "#9bb0a3", fontSize: 15 },
  owner: { color: "#d8c9a3", fontSize: 16, marginTop: 4 },
  ownerTr: { color: "#9bb0a3", fontSize: 13 },
  meta: { color: "#9bb0a3", fontSize: 13 },
  section: {
    marginTop: 12,
    color: "#c8a96b",
    fontSize: 13,
    letterSpacing: 0.4,
    fontWeight: "600",
  },
  sectionTr: { color: "#6b7c72", fontSize: 12, marginTop: -2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 },
  dot: { width: 10, height: 10, borderRadius: 2 },
  rank: { color: "#6b7c72", width: 22, fontSize: 13 },
  handleText: { color: "#e8efe9", fontWeight: "600", minWidth: 88 },
  tribeChip: { flex: 1, color: "#9bb0a3", fontSize: 13 },
  rowText: { flex: 1, color: "#e8efe9" },
  youText: { color: "#f4e7c5", fontWeight: "700" },
  rowVal: { color: "#c8a96b", fontVariant: ["tabular-nums"] },
  boostBox: { marginTop: 4, gap: 2 },
  boostLine: { color: "#e8efe9", fontSize: 15 },
  spendBox: { marginTop: 10, gap: 8 },
  energyLine: { color: "#c8a96b", fontWeight: "600" },
  cta: {
    backgroundColor: "#c8a96b",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 6,
  },
  confirmCta: { flex: 1, marginTop: 0 },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: "#0b1f17", fontWeight: "700", fontSize: 16 },
  ctaSub: { color: "#3d2e12", fontSize: 12, marginTop: 2 },
  error: { color: "#e07070", marginTop: 6 },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    padding: 24,
  },
  confirmCard: {
    backgroundColor: "#13261d",
    borderRadius: 14,
    padding: 18,
    gap: 10,
  },
  confirmRow: { flexDirection: "row", gap: 10, marginTop: 8 },
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
});
