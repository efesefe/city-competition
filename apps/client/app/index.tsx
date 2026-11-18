import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CitySheetModal } from "../components/CitySheet";
import { MatchDayBanner } from "../components/MatchDayBanner";
import { TutorialCoach } from "../components/TutorialCoach";
import { TurkiyeMap } from "../components/TurkiyeMap";
import {
  api,
  boostFromUser,
  type CitySheet,
  type DigestCity,
  type MatchDayEvent,
  type TutorialState,
} from "../lib/api";
import { wsUrl } from "../lib/config";
import { selectContestedPlates } from "../lib/mapAtlas";
import { selectBannerEvent, selectSpotlightPlates } from "../lib/matchDayChrome";
import { useSession } from "../lib/session";
import { colors, fonts, motion, radii, space, type as typeRoles } from "../lib/theme";

function idemKey() {
  return `spend_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

type DigestStatus = "loading" | "ready" | "error";

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ openPlate?: string }>();
  const { user, token, updateUser, refresh } = useSession();
  const [digest, setDigest] = useState<DigestCity[]>([]);
  const [digestStatus, setDigestStatus] = useState<DigestStatus>("loading");
  const [digestError, setDigestError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState<CitySheet | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [actionCost, setActionCost] = useState(15);
  const [pulse, setPulse] = useState<Set<string>>(new Set());
  const [flipBanner, setFlipBanner] = useState<string | null>(null);
  const [matchDayEvents, setMatchDayEvents] = useState<MatchDayEvent[]>([]);
  const [tutorial, setTutorial] = useState<TutorialState | null>(null);
  const [tutorialBusy, setTutorialBusy] = useState(false);
  const [showDoneCard, setShowDoneCard] = useState(false);
  const [shareAvailable, setShareAvailable] = useState(false);
  const [flippedShareAvailable, setFlippedShareAvailable] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  const ctaOpacity = useRef(new Animated.Value(0)).current;
  const ctaRise = useRef(new Animated.Value(14)).current;
  const selectLock = useRef(false);
  const openedResume = useRef(false);

  const isGuest = !token || !user;
  const isVerifiedPlayer = !!user?.phoneVerified && !!user?.tribeId;

  const loadDigest = useCallback(async () => {
    setDigestStatus("loading");
    setDigestError(null);
    try {
      const d = await api.digest();
      setDigest(Array.isArray(d.cities) ? d.cities : []);
      setDigestStatus("ready");
    } catch (e) {
      setDigestError(e instanceof Error ? e.message : "Harita verisi alınamadı");
      setDigestStatus("error");
    }
  }, []);

  const loadMatchDay = useCallback(async () => {
    try {
      const res = await api.matchDayActive();
      setMatchDayEvents(Array.isArray(res.events) ? res.events : []);
    } catch {
      /* chrome optional — map still works */
    }
  }, []);

  const loadTutorial = useCallback(async () => {
    if (!token || !user?.phoneVerified || !user.tribeId) {
      setTutorial(null);
      return;
    }
    try {
      const res = await api.tutorial(token);
      updateUser(res.user);
      setTutorial(res.tutorial);
      if (res.tutorial.complete && !res.tutorial.skipped) {
        setShowDoneCard(true);
      }
    } catch {
      /* guest / tribe gate — ignore */
    }
  }, [token, user?.phoneVerified, user?.tribeId, updateUser]);

  useEffect(() => {
    void api.meta().then((m) => setActionCost(m.actionCost)).catch(() => undefined);
    void loadDigest();
    void loadMatchDay();
    void refresh();
  }, [loadDigest, loadMatchDay, refresh]);

  useEffect(() => {
    const id = setInterval(() => void loadMatchDay(), 60_000);
    return () => clearInterval(id);
  }, [loadMatchDay]);

  // CTA / lower-third enter — fade + short rise (Floodlight Night motion budget).
  useEffect(() => {
    Animated.parallel([
      Animated.timing(ctaOpacity, {
        toValue: 1,
        duration: motion.sheetEnterMs,
        useNativeDriver: true,
      }),
      Animated.timing(ctaRise, {
        toValue: 0,
        duration: motion.sheetEnterMs,
        useNativeDriver: true,
      }),
    ]).start();
  }, [ctaOpacity, ctaRise]);

  const bannerEvent = useMemo(
    () => selectBannerEvent(matchDayEvents, user?.tribeId),
    [matchDayEvents, user?.tribeId],
  );
  const spotlightPlates = useMemo(
    () => selectSpotlightPlates(matchDayEvents),
    [matchDayEvents],
  );
  const contestedPlates = useMemo(() => selectContestedPlates(digest, 3), [digest]);

  useEffect(() => {
    void loadTutorial();
  }, [loadTutorial]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(wsUrl());
        ws.onopen = () => {
          // Guests + logged-in share the same digest channel (no auth on subscribe).
          ws?.send(JSON.stringify({ type: "subscribe", channel: "digest" }));
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data));
            if (msg.type === "digest" && Array.isArray(msg.cities)) {
              setDigest(msg.cities);
              setDigestStatus("ready");
              setDigestError(null);
            }
            if (msg.type === "support" && msg.plate) {
              // Delta fan-out: support ticks patch one city (full digest only on
              // subscribe/reconnect/flip). Avoid remapping when plate is unknown.
              setDigest((prev) => {
                const idx = prev.findIndex((c) => c.plate === msg.plate);
                if (idx < 0) return prev;
                const cur = prev[idx]!;
                const next = {
                  ...cur,
                  ownerTeamId: msg.ownerTeamId ?? cur.ownerTeamId,
                  ownerAlias: msg.ownerAlias ?? cur.ownerAlias,
                  ownerColor: msg.ownerColor ?? cur.ownerColor,
                  leadSupport: msg.leadSupport,
                  rivalSupport: msg.rivalSupport,
                  leadMargin: msg.leadMargin,
                };
                if (
                  next.ownerTeamId === cur.ownerTeamId &&
                  next.ownerAlias === cur.ownerAlias &&
                  next.ownerColor === cur.ownerColor &&
                  next.leadSupport === cur.leadSupport &&
                  next.rivalSupport === cur.rivalSupport &&
                  next.leadMargin === cur.leadMargin
                ) {
                  return prev;
                }
                const copy = prev.slice();
                copy[idx] = next;
                return copy;
              });
            }
            if (msg.type === "flip") {
              setPulse((prev) => new Set(prev).add(msg.plate));
              setFlipBanner(`${msg.toAlias} aldı: ${msg.plate}`);
              setTimeout(() => {
                setPulse((prev) => {
                  const n = new Set(prev);
                  n.delete(msg.plate);
                  return n;
                });
              }, 2500);
              Animated.sequence([
                Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }),
                Animated.delay(1800),
                Animated.timing(fade, { toValue: 0, duration: 400, useNativeDriver: true }),
              ]).start(() => setFlipBanner(null));
            }
          } catch {
            /* ignore */
          }
        };
        ws.onclose = () => {
          if (closed) return;
          retry = setTimeout(connect, 2000);
        };
      } catch {
        /* ws optional for browse */
      }
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [fade]);

  const openCity = useCallback(async (plate: string) => {
    if (!plate || selectLock.current) return;
    selectLock.current = true;
    setSelected(plate);
    setSheetLoading(true);
    setSheet(null);
    setSheetError(null);
    setShareAvailable(false);
    setFlippedShareAvailable(false);
    try {
      const s = await api.city(plate);
      setSheet(s);
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : "Şehir yüklenemedi");
    } finally {
      setSheetLoading(false);
      // Brief lock so double-tap / touch+click does not stack requests.
      setTimeout(() => {
        selectLock.current = false;
      }, 280);
    }
  }, []);

  // Resume city sheet after post-verify Kabile pick (CC-63).
  useEffect(() => {
    const plate = typeof params.openPlate === "string" ? params.openPlate : "";
    if (!plate || openedResume.current) return;
    if (!/^\d{2}$/.test(plate)) return;
    openedResume.current = true;
    void openCity(plate);
  }, [params.openPlate, openCity]);

  const spotlight = useMemo(() => {
    const next = new Set(pulse);
    if (tutorial?.active && tutorial.step === "capture" && tutorial.capturePlate) {
      next.add(tutorial.capturePlate);
    }
    if (tutorial?.active && tutorial.step === "fight" && tutorial.fightPlate) {
      next.add(tutorial.fightPlate);
    }
    return next;
  }, [pulse, tutorial]);

  const goLogin = () => {
    router.push("/auth");
  };

  const goPlay = () => {
    // Guests → login; unverified → phone wall on /auth; then Kabile (CC-21/23).
    if (!token || !user) {
      goLogin();
      return;
    }
    if (!user.phoneVerified) {
      goLogin();
      return;
    }
    if (!user.tribeId) {
      router.push({
        pathname: "/pick-tribe",
        params: selected ? { resume: selected } : undefined,
      });
      return;
    }
  };

  const openShop = () => {
    if (!token || !user) {
      goLogin();
      return;
    }
    router.push("/shop");
  };

  const onSpend = async (amount: number) => {
    if (!token || !selected) {
      goLogin();
      return;
    }
    // confirmed: true only after ConfirmSpendModal — API rejects otherwise.
    const res = await api.spend(token, selected, {
      confirmed: true,
      idempotencyKey: idemKey(),
      amount,
    });
    setSheet(res.sheet);
    setDigest(res.digest);
    setDigestStatus("ready");
    updateUser(res.user);
    if (res.user.tutorial) {
      setTutorial((prev) => ({
        ...(prev ?? res.user.tutorial!),
        ...res.user.tutorial!,
        captureName: prev?.captureName ?? null,
        fightName: prev?.fightName ?? null,
      }));
      if (res.user.tutorial.complete && !res.user.tutorial.skipped) {
        setShowDoneCard(true);
      }
    } else {
      void loadTutorial();
    }
    // Logged-in share entry points only (no guest map share).
    setShareAvailable(true);
    setFlippedShareAvailable(!!res.flipped);
    return { flipped: res.flipped };
  };

  const onShareSupport = async () => {
    if (!token || !sheet) return;
    const { shareCardNative } = await import("../lib/share");
    const { card } = await api.createShareCard(token, {
      kind: "support",
      plate: sheet.plate,
      cityName: sheet.nameTr,
    });
    await shareCardNative(card);
  };

  const onShareFlip = async () => {
    if (!token || !sheet) return;
    const { shareCardNative } = await import("../lib/share");
    const { card } = await api.createShareCard(token, {
      kind: "accomplishment",
      variant: "took_city",
      plate: sheet.plate,
      cityName: sheet.nameTr,
    });
    await shareCardNative(card);
  };

  const closeSheet = () => {
    setSheet(null);
    setSheetError(null);
    setSelected(null);
  };

  const onClaim = async () => {
    closeSheet();
    if (!token) {
      goLogin();
      return;
    }
    setTutorialBusy(true);
    try {
      const res = await api.claimEnergy(token);
      updateUser(res.user);
      await loadTutorial();
    } catch {
      goPlay();
    } finally {
      setTutorialBusy(false);
    }
  };

  const onShop = () => {
    closeSheet();
    router.push("/shop");
  };

  const onSkip = async () => {
    if (!token) return;
    setTutorialBusy(true);
    try {
      const res = await api.skipTutorial(token);
      updateUser(res.user);
      setTutorial(res.user.tutorial ?? { ...tutorial!, skipped: true, complete: true, active: false, step: "done" });
      setShowDoneCard(false);
    } finally {
      setTutorialBusy(false);
    }
  };

  const coachTutorial =
    tutorial && (tutorial.active || (showDoneCard && tutorial.complete && !tutorial.skipped))
      ? tutorial.step === "done" && !showDoneCard
        ? null
        : tutorial.step === "done" && showDoneCard
          ? { ...tutorial, active: false, step: "done" as const }
          : tutorial
      : null;

  const playLabel = !token
    ? "Play / Katıl"
    : !user?.phoneVerified
      ? "Doğrula"
      : user?.tribeId
        ? "Hesap"
        : "Kabile";

  return (
    <View style={styles.root}>
      {/* Full-bleed map plane — edge-to-edge visual anchor */}
      <View style={styles.mapPlane} pointerEvents="box-none">
        <TurkiyeMap
          digest={digest}
          selectedPlate={selected}
          pulsePlates={spotlight}
          spotlightPlates={spotlightPlates}
          contestedPlates={contestedPlates}
          onSelect={openCity}
        />
        {/* Cool night vignette — atmosphere, not decorative abstract alone */}
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(7,11,18,0.72)", "transparent", "transparent", "rgba(7,11,18,0.45)"]}
          locations={[0, 0.22, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        {digestStatus === "loading" ? (
          <View style={styles.mapOverlay} pointerEvents="none">
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={styles.overlayText}>Harita yükleniyor…</Text>
          </View>
        ) : null}
        {digestStatus === "error" ? (
          <View style={styles.errorBanner}>
            <View style={styles.errorCopy}>
              <Text style={styles.overlayTitle}>Harita verisi alınamadı</Text>
              <Text style={styles.overlayText}>{digestError}</Text>
            </View>
            <Pressable style={styles.retry} onPress={() => void loadDigest()}>
              <Text style={styles.retryText}>Yenile</Text>
            </Pressable>
          </View>
        ) : null}
        {digestStatus === "ready" && digest.length === 0 ? (
          <View style={styles.emptyBanner} pointerEvents="none">
            <Text style={styles.overlayText}>Sahiplik verisi yok — iller varsayılan renkte.</Text>
          </View>
        ) : null}
        {flipBanner ? (
          <Animated.View style={[styles.flipBanner, { opacity: fade }]}>
            <Text style={styles.flipText}>{flipBanner}</Text>
          </Animated.View>
        ) : null}
        <TutorialCoach
          tutorial={coachTutorial}
          busy={tutorialBusy}
          onClaim={onClaim}
          onOpenCapture={() => {
            if (tutorial?.capturePlate) void openCity(tutorial.capturePlate);
          }}
          onOpenFight={() => {
            if (tutorial?.fightPlate) void openCity(tutorial.fightPlate);
          }}
          onSkip={onSkip}
          onDismissDone={() => setShowDoneCard(false)}
        />
      </View>

      {/* Top chrome: brand as hero signal + muted scoreboard */}
      <View
        style={[styles.topChrome, { paddingTop: Math.max(insets.top, space.sm) }]}
        pointerEvents="box-none"
      >
        <View style={styles.brandRow}>
          <Text style={styles.brand} accessibilityRole="header">
            City Competition
          </Text>
          <Pressable
            style={styles.scoreboardBtn}
            onPress={() => router.push("/scoreboard")}
            accessibilityLabel="Scoreboard"
            hitSlop={8}
          >
            <Text style={styles.scoreboardIcon}>Skor</Text>
          </Pressable>
        </View>
        {isVerifiedPlayer && user ? (
          <View style={styles.playerMeta}>
            <Pressable
              onPress={() => {
                if (tutorial?.active && tutorial.step === "claim") void onClaim();
              }}
              testID="energy-pill"
            >
              <Text
                style={[
                  styles.energy,
                  tutorial?.active && tutorial.step === "claim" ? styles.energyLit : null,
                ]}
              >
                {user.energy.total} ⚡
              </Text>
            </Pressable>
            {user.tribeAlias ? (
              <Text style={styles.tribeChip} numberOfLines={1}>
                {user.tribeAlias}
              </Text>
            ) : null}
          </View>
        ) : null}
        {bannerEvent ? (
          <MatchDayBanner
            event={bannerEvent}
            onPressSpotlight={() => {
              if (bannerEvent.spotlightPlate) void openCity(bannerEvent.spotlightPlate);
            }}
          />
        ) : null}
      </View>

      {/* Lower-third: wireframe copy + one CTA group (guest first viewport) */}
      <LinearGradient
        pointerEvents="box-none"
        colors={["transparent", colors.overlayScrim, "rgba(7,11,18,0.92)"]}
        locations={[0, 0.35, 1]}
        style={[styles.lowerThird, { paddingBottom: Math.max(insets.bottom, space.lg) }]}
      >
        <Animated.View
          style={{
            opacity: ctaOpacity,
            transform: [{ translateY: ctaRise }],
          }}
        >
          {(isGuest || !isVerifiedPlayer) && (
            <View style={styles.copyBlock}>
              <Text style={styles.headline}>Türkiye is contested.</Text>
              <Text style={styles.support}>Pick a tribe and fight for cities.</Text>
              <Text style={styles.supportTr}>Türkiye paylaşılıyor.</Text>
              <Text style={styles.supportTr}>Kabileni seç, şehirler için savaş.</Text>
            </View>
          )}

          <View style={styles.ctaRow}>
            {/* Logged-in secondary chrome — not in guest first viewport */}
            {isVerifiedPlayer ? (
              <Pressable style={styles.link} onPress={openShop}>
                <Text style={styles.linkText}>Dükkan</Text>
              </Pressable>
            ) : null}
            {user?.role === "admin" ? (
              <Pressable style={styles.link} onPress={() => router.push("/admin")}>
                <Text style={styles.linkText}>Admin</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[styles.play, isVerifiedPlayer ? styles.playCompact : null]}
              onPress={goPlay}
              testID="guest-play-cta"
            >
              <Text style={styles.playText}>{playLabel}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </LinearGradient>

      <CitySheetModal
        sheet={sheet}
        loading={sheetLoading}
        loadError={sheetError}
        user={user}
        actionCost={actionCost}
        boost={boostFromUser(user)}
        shareAvailable={shareAvailable}
        flippedShareAvailable={flippedShareAvailable}
        onClose={() => {
          closeSheet();
          setShareAvailable(false);
          setFlippedShareAvailable(false);
        }}
        onPlay={goPlay}
        onSpend={onSpend}
        onClaim={onClaim}
        onShop={onShop}
        onShareSupport={onShareSupport}
        onShareFlip={onShareFlip}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  mapPlane: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.mapBase,
  },
  topChrome: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: space.lg,
    gap: space.sm,
    zIndex: 2,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.md,
  },
  brand: {
    ...typeRoles.brand,
    fontFamily: fonts.display,
    fontSize: 32,
    fontWeight: "800",
    color: colors.ink,
    letterSpacing: -0.5,
    flexShrink: 1,
  },
  scoreboardBtn: {
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    marginTop: 4,
  },
  scoreboardIcon: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  playerMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  energy: {
    ...typeRoles.tabular,
    color: colors.inkDim,
    minWidth: 48,
  },
  energyLit: {
    color: colors.accent,
  },
  tribeChip: {
    ...typeRoles.meta,
    color: colors.muted,
    flexShrink: 1,
  },
  lowerThird: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.xxl,
    zIndex: 2,
  },
  copyBlock: {
    gap: 4,
    marginBottom: space.lg,
    maxWidth: 360,
  },
  headline: {
    ...typeRoles.headline,
    fontFamily: fonts.body,
    fontSize: 19,
    fontWeight: "600",
    color: colors.ink,
  },
  support: {
    ...typeRoles.body,
    fontFamily: fonts.body,
    color: colors.inkDim,
    marginBottom: space.sm,
  },
  supportTr: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.muted,
    fontSize: 13,
  },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  link: {
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  linkText: {
    ...typeRoles.meta,
    color: colors.muted,
  },
  play: {
    marginLeft: "auto",
    backgroundColor: colors.accent,
    paddingHorizontal: space.xl,
    paddingVertical: 14,
    borderRadius: radii.md,
    minWidth: 148,
    alignItems: "center",
  },
  playCompact: {
    minWidth: 112,
    paddingVertical: 12,
  },
  playText: {
    ...typeRoles.cta,
    fontFamily: fonts.body,
    color: colors.ink,
  },
  mapOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7, 11, 18, 0.72)",
    paddingHorizontal: 24,
    gap: 10,
  },
  emptyBanner: {
    position: "absolute",
    left: space.md,
    right: space.md,
    bottom: 160,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radii.sm,
  },
  errorBanner: {
    position: "absolute",
    left: space.md,
    right: space.md,
    bottom: 160,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radii.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  errorCopy: { flex: 1, gap: 2 },
  overlayTitle: {
    ...typeRoles.meta,
    color: colors.ink,
    fontWeight: "700",
  },
  overlayText: {
    ...typeRoles.meta,
    color: colors.muted,
    textAlign: "center",
  },
  retry: {
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.md,
  },
  retryText: {
    ...typeRoles.cta,
    fontSize: 14,
    color: colors.ink,
  },
  flipBanner: {
    position: "absolute",
    top: 96,
    alignSelf: "center",
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.stroke,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.sm,
  },
  flipText: {
    ...typeRoles.meta,
    color: colors.ink,
    fontWeight: "700",
  },
});
