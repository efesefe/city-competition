import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GuestLoginWall } from "../components/GuestLoginWall";
import { PhoneVerifyWall } from "../components/PhoneVerifyWall";
import { api, boostFromUser } from "../lib/api";
import { isGuest, needsPhoneVerify } from "../lib/play-gates";
import { useSession } from "../lib/session";

type Pack = { sku: string; energy: number; tryPlaceholder: number };
type PersonalBoostMeta = {
  sku: string;
  effect: string;
  durationMinutes: number;
  tryPlaceholder: number | null;
  purchase: string;
};

export default function ShopScreen() {
  const router = useRouter();
  const { token, user, updateUser } = useSession();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [personalBoost, setPersonalBoost] = useState<PersonalBoostMeta | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.meta().then((m) => {
      const shop = m.shop as {
        packs?: Pack[];
        personalBoost?: PersonalBoostMeta;
      };
      setPacks(shop.packs ?? []);
      setPersonalBoost(shop.personalBoost ?? null);
    });
  }, []);

  // Guests may not enter shop — redirect to login/signup (CC-23).
  useEffect(() => {
    if (isGuest(user, token)) {
      router.replace("/auth");
    }
  }, [token, user, router]);

  const goAuth = () => router.replace("/auth");

  if (isGuest(user, token)) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Dükkan</Text>
        <GuestLoginWall variant="action" onLogin={goAuth} />
      </View>
    );
  }

  if (needsPhoneVerify(user)) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Dükkan</Text>
        <Text style={styles.sub}>Satın alma ve enerji grant için telefon doğrula.</Text>
        <PhoneVerifyWall kind="play" onVerify={goAuth} />
      </View>
    );
  }

  const simGrant = async () => {
    if (!token) {
      goAuth();
      return;
    }
    try {
      const res = await api.grantSim(token);
      updateUser(res.user);
      setNote(`Simüle günlük grant: +${res.amount} (00:00 TR yerine)`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "grant_failed");
    }
  };

  const activatePersonalBoost = async () => {
    if (!token) {
      setNote("Giriş gerekli");
      router.push("/auth");
      return;
    }
    if (!user?.phoneVerified) {
      setNote("Telefon doğrula / Verify phone");
      router.push("/auth");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const res = await api.activatePersonalBoostStub(token);
      updateUser(res.user);
      setNote("Kişisel boost +50% · 1 saat aktif (ödeme stub — Payments sonra)");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "boost_failed");
    } finally {
      setBusy(false);
    }
  };

  const simulateTeamBoost = async () => {
    if (!token) {
      router.push("/auth");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const res = await api.simulateTeamBoost(token);
      updateUser(res.user);
      setNote("Takım boost +25% simüle edildi (match-day admin sonra)");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "team_boost_failed");
    } finally {
      setBusy(false);
    }
  };

  const activateMatchDayFixture = async () => {
    if (!token) {
      router.push("/auth");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const res = await api.matchDayFixtureStub(token, { spotlightPlate: "34" });
      updateUser(res.user);
      const city = res.event.cityNameTr ?? res.event.spotlightPlate;
      setNote(
        `Maç günü chrome: +25% + spotlight ${city}. Haritaya dön — banner ve spotlight birlikte.`,
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : "match_day_stub_failed");
    } finally {
      setBusy(false);
    }
  };

  const boost = boostFromUser(user);
  const boosted = boost.personalBoostPct !== 1 || boost.teamBoostPct !== 1;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Dükkan</Text>
      <Text style={styles.sub}>
        iyzico / IAP bu dilimde stub. Enerji paketleri gösterim amaçlı. Kişisel boost display path
        gerçek — satın alma stub.
      </Text>

      {packs.map((p) => (
        <View key={p.sku} style={styles.card}>
          <Text style={styles.pack}>
            {p.sku.toUpperCase()} — {p.energy} enerji
          </Text>
          <Text style={styles.price}>₺{p.tryPlaceholder} (placeholder)</Text>
          <Pressable style={styles.disabled} disabled>
            <Text style={styles.disabledText}>Satın al (yakında)</Text>
          </Pressable>
        </View>
      ))}

      {personalBoost ? (
        <View style={styles.card}>
          <Text style={styles.pack}>Personal boost</Text>
          <Text style={styles.price}>
            {personalBoost.effect} · {personalBoost.durationMinutes} dk
          </Text>
          <Text style={styles.meta}>TRY listing TBD · purchase = stub</Text>
          <Pressable
            style={[styles.cta, busy && styles.ctaDisabled]}
            onPress={activatePersonalBoost}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>
              {busy ? "…" : "Aktifleştir (stub) / Activate stub"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable style={styles.secondary} onPress={simulateTeamBoost} disabled={busy}>
        <Text style={styles.secondaryText}>Simüle takım +25% (dev)</Text>
      </Pressable>

      <Pressable
        style={styles.secondary}
        onPress={activateMatchDayFixture}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryText}>Maç günü fixture stub (+25% + İstanbul spotlight)</Text>
      </Pressable>
      <Pressable style={styles.cta} onPress={simGrant}>
        <Text style={styles.ctaText}>Günlük 100 enerjiyi simüle et</Text>
      </Pressable>

      {user ? <Text style={styles.meta}>Enerji: {user.energy.total}</Text> : null}
      {boosted ? (
        <Text style={styles.boostNote}>
          Boosted support aktif — personal{" "}
          {boost.personalBoostPct !== 1
            ? `+${Math.round((boost.personalBoostPct - 1) * 100)}%`
            : "off"}
          {" · "}
          team{" "}
          {boost.teamBoostPct !== 1
            ? `+${Math.round((boost.teamBoostPct - 1) * 100)}%`
            : "off"}
        </Text>
      ) : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 10, backgroundColor: "#0b1f17" },
  title: { fontFamily: "Georgia", fontSize: 24, color: "#f4e7c5", fontWeight: "700" },
  sub: { color: "#9bb0a3" },
  card: {
    backgroundColor: "#13261d",
    padding: 14,
    borderRadius: 10,
    gap: 4,
  },
  pack: { color: "#f4e7c5", fontWeight: "600" },
  price: { color: "#c8a96b" },
  disabled: {
    marginTop: 6,
    opacity: 0.5,
    borderWidth: 1,
    borderColor: "#3d5a4c",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  disabledText: { color: "#9bb0a3" },
  secondary: {
    borderWidth: 1,
    borderColor: "#3d5a4c",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  secondaryText: { color: "#c8a96b", fontWeight: "600" },
  cta: {
    backgroundColor: "#c8a96b",
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 8,
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { color: "#0b1f17", fontWeight: "700" },
  secondary: {
    borderWidth: 1,
    borderColor: "#3d5a4c",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  secondaryText: { color: "#d8c9a3", fontWeight: "600" },
  meta: { color: "#9bb0a3" },
  boostNote: { color: "#8fd4a0", fontWeight: "600" },
  note: { color: "#8fd4a0" },
});
