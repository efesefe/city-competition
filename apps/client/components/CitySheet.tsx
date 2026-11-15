import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { CitySheet as CitySheetData, PublicUser } from "../lib/api";

type Props = {
  sheet: CitySheetData | null;
  loading?: boolean;
  user: PublicUser | null;
  actionCost: number;
  onClose: () => void;
  onPlay: () => void;
  onSpend: (amount: number) => Promise<void>;
};

export function CitySheetModal({
  sheet,
  loading,
  user,
  actionCost,
  onClose,
  onPlay,
  onSpend,
}: Props) {
  const [amount, setAmount] = useState(String(actionCost));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSpend =
    user?.phoneVerified && user.tribeId && (user.energy.total ?? 0) >= Number(amount || 0);

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
    setConfirmOpen(true);
  };

  const doSpend = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSpend(Number(amount));
      setConfirmOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "spend_failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={!!sheet || !!loading} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {loading || !sheet ? (
            <ActivityIndicator color="#c8a96b" />
          ) : (
            <>
              <View style={styles.header}>
                <Text style={styles.title}>{sheet.nameTr}</Text>
                <Pressable onPress={onClose} hitSlop={12}>
                  <Text style={styles.close}>Kapat</Text>
                </Pressable>
              </View>
              <Text style={styles.owner}>
                Sahip:{" "}
                <Text style={{ color: sheet.ownerColor || "#f4e7c5" }}>
                  {sheet.ownerAlias || "—"}
                </Text>
              </Text>
              <Text style={styles.meta}>Fark: {Math.round(sheet.leadMargin)} destek</Text>

              <Text style={styles.section}>Destek</Text>
              {sheet.support.slice(0, 3).map((s) => (
                <View key={s.teamId} style={styles.row}>
                  <View style={[styles.dot, { backgroundColor: s.color }]} />
                  <Text style={styles.rowText}>{s.alias}</Text>
                  <Text style={styles.rowVal}>{Math.round(s.support)}</Text>
                </View>
              ))}

              <Text style={styles.section}>Katkı (gerçek handle)</Text>
              {sheet.topContributors.length === 0 ? (
                <Text style={styles.meta}>Henüz oyuncu harcaması yok (tohumlar aktif).</Text>
              ) : (
                sheet.topContributors.map((c) => (
                  <View key={c.handle} style={styles.row}>
                    <Text style={styles.rowText}>{c.handle}</Text>
                    <Text style={styles.rowVal}>{Math.round(c.support)}</Text>
                  </View>
                ))
              )}

              {user?.phoneVerified && user.tribeId ? (
                <View style={styles.spendBox}>
                  <Text style={styles.section}>Enerji harca ({user.energy.total} mevcut)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="number-pad"
                    value={amount}
                    onChangeText={setAmount}
                    placeholder="10–20"
                    placeholderTextColor="#6b7c72"
                  />
                  <Pressable
                    style={[styles.cta, !canSpend && styles.ctaDisabled]}
                    disabled={!canSpend}
                    onPress={openConfirm}
                  >
                    <Text style={styles.ctaText}>Harca / Spend</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable style={styles.cta} onPress={onPlay}>
                  <Text style={styles.ctaText}>
                    {user ? "Kabile seç / doğrula" : "Katıl / Play"}
                  </Text>
                </Pressable>
              )}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </>
          )}
        </View>
      </View>

      <Modal visible={confirmOpen} transparent animationType="fade">
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <Text style={styles.title}>Onayla</Text>
            <Text style={styles.meta}>
              {amount} enerji → {sheet?.nameTr}. Bu işlem geri alınamaz.
            </Text>
            <Text style={styles.meta}>Always confirm — locked UX.</Text>
            <View style={styles.confirmRow}>
              <Pressable style={styles.secondary} onPress={() => setConfirmOpen(false)}>
                <Text style={styles.secondaryText}>Vazgeç</Text>
              </Pressable>
              <Pressable style={styles.cta} onPress={doSpend} disabled={busy}>
                <Text style={styles.ctaText}>{busy ? "…" : "Onayla"}</Text>
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
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    backgroundColor: "#13261d",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    gap: 8,
    maxHeight: "78%",
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: {
    fontFamily: "Georgia",
    fontSize: 24,
    color: "#f4e7c5",
    fontWeight: "700",
  },
  close: { color: "#9bb0a3", fontSize: 15 },
  owner: { color: "#d8c9a3", fontSize: 16 },
  meta: { color: "#9bb0a3", fontSize: 13 },
  section: { marginTop: 10, color: "#c8a96b", fontSize: 13, letterSpacing: 0.4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 },
  dot: { width: 10, height: 10, borderRadius: 2 },
  rowText: { flex: 1, color: "#e8efe9" },
  rowVal: { color: "#c8a96b" },
  spendBox: { marginTop: 8, gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#2f4a3c",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#f4e7c5",
    backgroundColor: "#0f1c16",
  },
  cta: {
    backgroundColor: "#c8a96b",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 6,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: "#0b1f17", fontWeight: "700", fontSize: 16 },
  error: { color: "#e07070", marginTop: 6 },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
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
