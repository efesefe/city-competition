import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GuestLoginWall } from "../components/GuestLoginWall";
import { PhoneVerifyWall } from "../components/PhoneVerifyWall";
import { api, boostFromUser, type ShopCatalog } from "../lib/api";
import { revenueCatAndroidApiKey, revenueCatIosApiKey } from "../lib/iapCatalog";
import { isGuest, needsPhoneVerify } from "../lib/play-gates";
import {
  configureRevenueCat,
  identifyRevenueCatUser,
  nativeBillingPlatform,
  purchaseNativeProduct,
  restoreNativePurchases,
} from "../lib/revenuecat";
import { useSession } from "../lib/session";
import { colors, fonts, radii, space, type as typeRoles } from "../lib/theme";

function productIdForSurface(
  pack: {
    productId: string;
    iosProductId?: string;
    androidProductId?: string;
    webProductId?: string;
  },
): string {
  if (Platform.OS === "android") return pack.androidProductId || pack.productId;
  if (Platform.OS === "ios") return pack.iosProductId || pack.productId;
  return pack.webProductId || pack.productId;
}

function newIdempotencyKey(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function ShopScreen() {
  const router = useRouter();
  const { token, user, updateUser, refresh } = useSession();
  const params = useLocalSearchParams<{
    iyzico?: string;
    checkoutId?: string;
    kind?: string;
  }>();
  const [shop, setShop] = useState<ShopCatalog | null>(null);
  const [stubEnabled, setStubEnabled] = useState(false);
  const [boostStubsEnabled, setBoostStubsEnabled] = useState(false);
  const [paymentsMock, setPaymentsMock] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rcReady, setRcReady] = useState(false);
  const platform = nativeBillingPlatform();
  const hasNativeKey =
    (platform === "android" && Boolean(revenueCatAndroidApiKey())) ||
    (platform === "ios" && Boolean(revenueCatIosApiKey()));

  useEffect(() => {
    void api.meta().then((m) => {
      setShop(m.shop);
      setStubEnabled(Boolean(m.iap?.stubEnabled));
      setBoostStubsEnabled(Boolean(m.iap?.unpaidBoostStubsEnabled));
      setPaymentsMock(Boolean(m.payments?.web?.mock ?? true));
    });
  }, []);

  useEffect(() => {
    if (isGuest(user, token)) {
      router.replace("/auth");
    }
  }, [token, user, router]);

  useEffect(() => {
    if (!platform) return;
    if (isGuest(user, token) || needsPhoneVerify(user)) return;
    void (async () => {
      const res = await configureRevenueCat(user?.id ?? null);
      setRcReady(res.ok);
      if (res.ok && user?.id) await identifyRevenueCatUser(user.id);
    })();
  }, [user?.id, platform, token, user]);

  // After iyzico CF / mock redirect back to /shop?iyzico=success&checkoutId=…
  useEffect(() => {
    if (!token || !params.checkoutId || params.iyzico !== "success") return;
    void (async () => {
      try {
        const res = await api.iyzicoStatus(token, String(params.checkoutId));
        updateUser(res.user);
        setNote(
          res.kind === "subscription"
            ? "Abonelik aktif (+50/gün gece yarısı TR)"
            : res.status === "succeeded"
              ? `+${res.energyGrant} enerji yüklendi`
              : `Ödeme durumu: ${res.status}`,
        );
        await refresh();
      } catch (e) {
        setNote((e as Error).message || "Ödeme durumu alınamadı");
      }
    })();
  }, [token, params.checkoutId, params.iyzico, updateUser, refresh]);

  useEffect(() => {
    if (params.iyzico === "failed") {
      setNote("Ödeme başarısız veya iptal edildi.");
    }
  }, [params.iyzico]);

  const goAuth = () => router.replace("/auth");

  const afterGrant = useCallback(
    (nextUser: typeof user, message: string) => {
      if (nextUser) updateUser(nextUser);
      setNote(message);
    },
    [updateUser],
  );

  const buyWeb = async (kind: "pack" | "subscription", sku: string, label: string) => {
    if (!token) {
      setNote("Giriş gerekli");
      return;
    }
    if (Platform.OS !== "web") {
      setNote("Web ödemeleri iyzico ile. Native için App Store / Play (RevenueCat).");
      return;
    }
    setBusy(sku);
    setNote(null);
    try {
      const returnUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/shop`
          : "http://localhost:8081/shop";
      const res = await api.iyzicoCheckout(token, {
        kind,
        sku,
        idempotencyKey: newIdempotencyKey(sku),
        returnUrl,
      });
      setNote(
        res.mock
          ? `Mock iyzico 3DS açılıyor (${label})…`
          : `iyzico Checkout Form açılıyor (${label})…`,
      );
      if (res.checkoutUrl) {
        if (typeof window !== "undefined") {
          window.location.assign(res.checkoutUrl);
        } else {
          await Linking.openURL(res.checkoutUrl);
        }
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      setNote(err.message || "Ödeme başlatılamadı");
    } finally {
      setBusy(null);
    }
  };

  const buy = async (productId: string, label: string, sku: string) => {
    if (!token) {
      setNote("Giriş gerekli");
      return;
    }
    if (Platform.OS === "web") {
      const kind = sku === "monthly" ? "subscription" : "pack";
      await buyWeb(kind, sku === "monthly" ? "monthly" : sku, label);
      return;
    }
    setBusy(productId);
    setNote(null);
    try {
      if (platform && hasNativeKey) {
        const payload = await purchaseNativeProduct(productId);
        const res = await api.iapSync(token, payload);
        afterGrant(
          res.user,
          res.kind === "subscription"
            ? "Abonelik aktif (+50/gün gece yarısı TR)"
            : `+${res.energyGranted} enerji yüklendi`,
        );
      } else if (stubEnabled) {
        const res = await api.iapStub(token, {
          productId,
          platform: platform ?? "android",
        });
        afterGrant(
          res.user,
          res.kind === "subscription"
            ? `Stub abonelik aktif (${label})`
            : `Stub: +${res.energyGranted} enerji (${label})`,
        );
      } else {
        setNote(
          platform === "android"
            ? "RevenueCat Android anahtarı yok (EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY)."
            : platform === "ios"
              ? "RevenueCat iOS anahtarı yok (EXPO_PUBLIC_REVENUECAT_IOS_API_KEY)."
              : "Native IAP için Android/iOS derlemesi + RC anahtarı; web = iyzico.",
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
      setNote("Giriş gerekli");
      return;
    }
    setBusy("restore");
    setNote(null);
    try {
      if (platform && hasNativeKey) {
        const { payloads, subActive } = await restoreNativePurchases();
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
        setNote("Restore için native platform + RevenueCat anahtarı gerekli.");
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

  const boost = boostFromUser(user);
  const boosted = boost.personalBoostPct !== 1 || boost.teamBoostPct !== 1;
  /**
   * Unpaid boost / fixture / daily-grant sim CTAs — never in release+prod.
   * Show when Expo __DEV__, or API unpaid-boost stubs / IAP stub flag is on.
   */
  const showStubCtas = __DEV__ || boostStubsEnabled || stubEnabled;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Dükkan</Text>
      <Text style={styles.sub}>
        {shop?.provider === "unified"
          ? "Season 0 SKUs: iOS / Android / web product ids. Native = RevenueCat; web checkout = iyzico leaf. TRY listing TBD."
          : Platform.OS === "web"
            ? "Web · iyzico Checkout Form (3DS). Paketler 200 / 600 / 1500 + aylık abonelik (+50/gün)."
            : "Native IAP · RevenueCat (Play Billing + App Store). Paketler 200 / 600 / 1500 + aylık abonelik (+50/gün)."}
      </Text>
      {Platform.OS === "web" ? (
        <Text style={styles.warn}>Native dijital mallar mağaza IAP / Play Billing.</Text>
      ) : !platform ? (
        <Text style={styles.warn}>Web önizleme — gerçek Play Billing Android derlemesinde; web product ids below.</Text>
      ) : null}
      {!shop ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          {shop.packs.map((p) => {
            const pid = productIdForSurface(p);
            return (
              <View key={p.sku} style={styles.card}>
                <Text style={styles.pack}>
                  {p.sku.toUpperCase()} — {p.energy} enerji
                </Text>
                <Text style={styles.price}>
                  ₺{p.tryPlaceholder} ({p.tryListingStatus === "tbd" ? "TBD" : "listing TBD"})
                </Text>
                <Text style={styles.sku}>
                  iOS {p.iosProductId ?? p.productId} · Android {p.androidProductId ?? "—"} · Web{" "}
                  {p.webProductId ?? "—"}
                </Text>
                <Text style={styles.sku}>surface: {pid}</Text>
                <Pressable
                  style={[styles.cta, busy && styles.ctaDisabled]}
                  disabled={Boolean(busy)}
                  onPress={() => void buy(pid, p.sku, p.sku)}
                >
                  <Text style={styles.ctaText}>
                    {busy === pid || busy === p.sku
                      ? "…"
                      : Platform.OS === "web"
                        ? "iyzico ile al"
                        : "Satın al"}
                  </Text>
                </Pressable>
              </View>
            );
          })}
          <View style={styles.card}>
            <Text style={styles.pack}>Aylık abonelik — +{shop.subscription.dailyBonus}/gün</Text>
            <Text style={styles.price}>
              ₺{shop.subscription.tryPlaceholder} (
              {shop.subscription.tryListingStatus === "tbd" ? "TBD" : "listing TBD"})
            </Text>
            <Text style={styles.sku}>
              iOS {shop.subscription.iosProductId ?? shop.subscription.productId} · Android{" "}
              {shop.subscription.androidProductId ?? "—"} · Web{" "}
              {shop.subscription.webProductId ?? "—"}
            </Text>
            <Text style={styles.sku}>surface: {productIdForSurface(shop.subscription)}</Text>
            <Pressable
              style={[styles.cta, busy && styles.ctaDisabled]}
              disabled={Boolean(busy)}
              onPress={() =>
                void buy(productIdForSurface(shop.subscription), "monthly", "monthly")
              }
            >
              <Text style={styles.ctaText}>
                {busy === productIdForSurface(shop.subscription) || busy === "monthly"
                  ? "…"
                  : Platform.OS === "web"
                    ? "Abone ol (iyzico)"
                    : "Abone ol"}
              </Text>
            </Pressable>
          </View>
        </>
      )}
      {Platform.OS !== "web" ? (
        <Pressable style={styles.secondary} disabled={Boolean(busy)} onPress={() => void restore()}>
          <Text style={styles.secondaryText}>
            {busy === "restore" ? "Geri yükleniyor…" : "Satın almaları geri yükle"}
          </Text>
        </Pressable>
      ) : null}
      {showStubCtas ? (
        <>
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
            <Text style={styles.secondaryText}>
              Maç günü fixture stub (+25% + İstanbul spotlight)
            </Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={() => void simGrant()}>
            <Text style={styles.secondaryText}>Günlük 100 enerjiyi simüle et</Text>
          </Pressable>
        </>
      ) : null}
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
          {Platform.OS === "web"
            ? paymentsMock
              ? " · iyzico mock"
              : " · iyzico live/sandbox"
            : ""}
          {rcReady ? " · RC hazır" : ""}
          {stubEnabled || boostStubsEnabled ? " · stub açık" : ""}
          {platform ? ` · ${platform}` : ""}
        </Text>
      ) : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: space.lg, gap: 10, backgroundColor: colors.bg },
  title: {
    ...typeRoles.title,
    fontFamily: fonts.display,
    fontSize: 24,
    fontWeight: "700",
    color: colors.ink,
  },
  sub: {
    ...typeRoles.body,
    fontFamily: fonts.body,
    color: colors.muted,
  },
  warn: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.inkDim,
  },
  card: {
    paddingVertical: space.md,
    gap: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.stroke,
  },
  pack: {
    fontFamily: fonts.body,
    color: colors.ink,
    fontWeight: "600",
  },
  price: {
    ...typeRoles.tabular,
    fontFamily: fonts.body,
    color: colors.inkDim,
  },
  sku: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.mutedDim,
    fontSize: 11,
  },
  cta: {
    marginTop: space.sm,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    padding: 10,
    alignItems: "center",
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: {
    ...typeRoles.cta,
    fontFamily: fonts.body,
    color: colors.ink,
  },
  secondary: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    padding: space.md,
    alignItems: "center",
  },
  secondaryText: {
    fontFamily: fonts.body,
    color: colors.ink,
    fontWeight: "600",
  },
  meta: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.muted,
  },
  note: {
    fontFamily: fonts.body,
    color: colors.success,
  },
});
