import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { GuestLoginWall } from "../components/GuestLoginWall";
import { PhoneVerifyWall } from "../components/PhoneVerifyWall";
import { api, boostFromUser, type ShopCatalog } from "../lib/api";
import { revenueCatIosApiKey } from "../lib/iapCatalog";
import { isGuest, needsPhoneVerify } from "../lib/play-gates";
import {
  configureRevenueCat,
  identifyRevenueCatUser,
  purchaseIosProduct,
  restoreIosPurchases,
} from "../lib/revenuecat";
import { useSession } from "../lib/session";

export default function ShopScreen() {
  const router = useRouter();
  const { token, user, updateUser } = useSession();
  const [shop, setShop] = useState<ShopCatalog | null>(null);
  const [stubEnabled, setStubEnabled] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rcReady, setRcReady] = useState(false);

  useEffect(() => {
    void api.meta().then((m) => {
      setShop(m.shop);
      setStubEnabled(Boolean(m.iap?.stubEnabled));
    });
  }, []);

  // Guests may not enter shop — redirect to login/signup (CC-23).
  useEffect(() => {
    if (isGuest(user, token)) {
      router.replace("/auth");
    }
  }, [token, user, router]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (isGuest(user, token) || needsPhoneVerify(user)) return;
    void (async () => {
      const res = await configureRevenueCat(user?.id ?? null);
      setRcReady(res.ok);
      if (res.ok && user?.id) await identifyRevenueCatUser(user.id);
    })();
  }, [user?.id, token, user]);

  const goAuth = () => router.replace("/auth");

  const afterGrant = useCallback(
    (nextUser: typeof user, message: string) => {
      if (nextUser) updateUser(nextUser);
      setNote(message);
    },
    [updateUser],
  );

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

  const buy = async (productId: string, label: string) => {
    if (!token) {
      goAuth();
      return;
    }
    setBusy(productId);
    setNote(null);
    try {
      if (Platform.OS === "ios" && revenueCatIosApiKey()) {
        const payload = await purchaseIosProduct(productId);
        const res = await api.iapSync(token, payload);
        afterGrant(
          res.user,
          res.kind === "subscription"
            ? "Abonelik aktif (+50/gün gece yarısı TR)"
            : `+${res.energyGranted} enerji yüklendi`,
        );
      } else if (stubEnabled) {
        const res = await api.iapStub(token, { productId });
        afterGrant(
          res.user,
          res.kind === "subscription"
            ? `Stub abonelik aktif (${label})`
            : `Stub: +${res.energyGranted} enerji (${label})`,
        );
      } else {
        setNote(
          Platform.OS === "ios"
            ? "RevenueCat iOS anahtarı yok (EXPO_PUBLIC_REVENUECAT_IOS_API_KEY)."
            : "App Store IAP yalnızca iOS. Android ayrı yaprak (CC-45).",
        );
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      setNote(err.code || err.message || "Satın alma başarısız");
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!token) {
      goAuth();
      return;
    }
    setBusy("restore");
    setNote(null);
    try {
      if (Platform.OS === "ios" && revenueCatIosApiKey()) {
        const { payloads, subActive } = await restoreIosPurchases();
        let lastUser = user;
        for (const p of payloads) {
          const res = await api.iapSync(token, p);
          lastUser = res.user;
        }
        if (lastUser) updateUser(lastUser);
        setNote(
          payloads.length
            ? `Geri yüklendi: ${payloads.length} işlem${subActive ? " (abonelik aktif)" : ""}`
            : "Geri yüklenecek satın alma yok",
        );
      } else if (stubEnabled) {
        setNote("Stub modunda Restore yok — paketi tekrar satınal (idempotent).");
      } else {
        setNote("Restore için iOS + RevenueCat anahtarı gerekli.");
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      setNote(err.code || err.message || "Restore başarısız");
    } finally {
      setBusy(null);
    }
  };

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
    setBusy("boost");
    setNote(null);
    try {
      const res = await api.activatePersonalBoostStub(token);
      updateUser(res.user);
      setNote("Kişisel boost +50% · 1 saat aktif (ödeme stub — Payments sonra)");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "boost_failed");
    } finally {
      setBusy(null);
    }
  };

  const activateMatchDayFixture = async () => {
    if (!token) {
      router.push("/auth");
      return;
    }
    setBusy("matchday");
    setNote(null);
    try {
      const res = await api.matchDayFixtureStub(token, { spotlightPlate: "34" });
      updateUser(res.user);
      const city = res.event.cityNameTr ?? res.event.spotlightPlate;
      setNote(`Maç günü chrome: +25% + spotlight ${city}.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "match_day_stub_failed");
    } finally {
      setBusy(null);
    }
  };

  const boost = boostFromUser(user);
  const boosted = boost.personalBoostPct !== 1 || boost.teamBoostPct !== 1;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Dükkan</Text>
      <Text style={styles.sub}>
        iOS App Store IAP · RevenueCat. Enerji paketleri 200 / 600 / 1500 + aylık abonelik (+50/gün).
      </Text>
      {Platform.OS !== "ios" ? (
        <Text style={styles.warn}>Bu ekran native satın almayı iOS için bağlar. Web’de stub / önizleme.</Text>
      ) : null}
      {!shop ? (
        <ActivityIndicator color="#c8a96b" />
      ) : (
        <>
          {shop.packs.map((p) => (
            <View key={p.productId} style={styles.card}>
              <Text style={styles.pack}>
                {p.sku.toUpperCase()} — {p.energy} enerji
              </Text>
              <Text style={styles.price}>₺{p.tryPlaceholder} (listing TBD)</Text>
              <Text style={styles.sku}>{p.productId}</Text>
              <Pressable
                style={[styles.cta, busy && styles.ctaDisabled]}
                disabled={Boolean(busy)}
                onPress={() => void buy(p.productId, p.sku)}
              >
                <Text style={styles.ctaText}>
                  {busy === p.productId ? "…" : "Satın al"}
                </Text>
              </Pressable>
            </View>
          ))}
          <View style={styles.card}>
            <Text style={styles.pack}>Aylık abonelik — +{shop.subscription.dailyBonus}/gün</Text>
            <Text style={styles.price}>₺{shop.subscription.tryPlaceholder} (listing TBD)</Text>
            <Text style={styles.sku}>{shop.subscription.productId}</Text>
            <Pressable
              style={[styles.cta, busy && styles.ctaDisabled]}
              disabled={Boolean(busy)}
              onPress={() => void buy(shop.subscription.productId, "monthly")}
            >
              <Text style={styles.ctaText}>
                {busy === shop.subscription.productId ? "…" : "Abone ol"}
              </Text>
            </Pressable>
          </View>
        </>
      )}
      <Pressable style={styles.secondary} disabled={Boolean(busy)} onPress={() => void restore()}>
        <Text style={styles.secondaryText}>
          {busy === "restore" ? "Geri yükleniyor…" : "Satın almaları geri yükle"}
        </Text>
      </Pressable>
      <Pressable
        style={[styles.cta, Boolean(busy) && styles.ctaDisabled]}
        disabled={Boolean(busy)}
        onPress={() => void activatePersonalBoost()}
      >
        <Text style={styles.ctaText}>Kişisel boost +50% / 1s (stub)</Text>
      </Pressable>
      <Pressable
        style={styles.secondary}
        onPress={() => void activateMatchDayFixture()}
        disabled={Boolean(busy)}
      >
        <Text style={styles.secondaryText}>Maç günü fixture stub (+25% + İstanbul spotlight)</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => void simGrant()}>
        <Text style={styles.secondaryText}>Günlük 100 enerjiyi simüle et</Text>
      </Pressable>
      {boosted ? (
        <Text style={styles.note}>
          Aktif boost · kişisel{" "}
          {boost.personalBoostPct !== 1
            ? `+${Math.round((boost.personalBoostPct - 1) * 100)}%`
            : "off"}
          {" · takım "}
          {boost.teamBoostPct !== 1
            ? `+${Math.round((boost.teamBoostPct - 1) * 100)}%`
            : "off"}
        </Text>
      ) : null}
      {user ? (
        <Text style={styles.meta}>
          Enerji: {user.energy.total}
          {user.subActive ? " · Abonelik aktif" : ""}
          {rcReady ? " · RC hazır" : ""}
          {stubEnabled ? " · stub açık" : ""}
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
  warn: { color: "#c8a96b", fontSize: 13 },
  card: {
    backgroundColor: "#13261d",
    padding: 14,
    borderRadius: 10,
    gap: 4,
  },
  pack: { color: "#f4e7c5", fontWeight: "600" },
  price: { color: "#c8a96b" },
  sku: { color: "#6d8578", fontSize: 11 },
  cta: {
    marginTop: 6,
    backgroundColor: "#c8a96b",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: "#0b1f17", fontWeight: "700" },
  secondary: {
    borderWidth: 1,
    borderColor: "#3d5a4c",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
  },
  secondaryText: { color: "#f4e7c5", fontWeight: "600" },
  meta: { color: "#9bb0a3" },
  note: { color: "#8fd4a0" },
});
