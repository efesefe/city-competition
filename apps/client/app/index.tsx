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
import { selectBannerEvent, selectSpotlightPlates } from "../lib/matchDayChrome";
import { useSession } from "../lib/session";

function idemKey() {
  return `spend_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

type DigestStatus = "loading" | "ready" | "error";

export default function MapScreen() {
  const router = useRouter();
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
  const fade = useRef(new Animated.Value(0)).current;
  const selectLock = useRef(false);
  const openedResume = useRef(false);

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

  const bannerEvent = useMemo(
    () => selectBannerEvent(matchDayEvents, user?.tribeId),
    [matchDayEvents, user?.tribeId],
  );
  const spotlightPlates = useMemo(
    () => selectSpotlightPlates(matchDayEvents),
    [matchDayEvents],
  );

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
              // Patch single-city support tallies without waiting for full digest.
              setDigest((prev) =>
                prev.map((c) =>
                  c.plate === msg.plate
                    ? {
                        ...c,
                        ownerTeamId: msg.ownerTeamId ?? c.ownerTeamId,
                        ownerAlias: msg.ownerAlias ?? c.ownerAlias,
                        ownerColor: msg.ownerColor ?? c.ownerColor,
                        leadSupport: msg.leadSupport,
                        rivalSupport: msg.rivalSupport,
                        leadMargin: msg.leadMargin,
                      }
                    : c,
                ),
              );
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
  return (
    <View style={styles.root}>
      <View style={styles.heroChrome}>
        <Text style={styles.brand}>City Competition</Text>
        <Text style={styles.tagline}>Türkiye paylaşılıyor. Kabileni seç, şehirler için savaş.</Text>
      </View>

      {bannerEvent ? (
        <MatchDayBanner
          event={bannerEvent}
          onPressSpotlight={() => {
            if (bannerEvent.spotlightPlate) void openCity(bannerEvent.spotlightPlate);
          }}
        />
      ) : null}

      <View style={styles.mapPane}>
        <TurkiyeMap
          digest={digest}
          selectedPlate={selected}
          pulsePlates={spotlight}
          spotlightPlates={spotlightPlates}
          onSelect={openCity}
        />
        {digestStatus === "loading" ? (
          <View style={styles.mapOverlay} pointerEvents="none">
            <ActivityIndicator color="#c8a96b" size="large" />
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

      <View style={styles.bar}>
        {user?.phoneVerified ? (
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
              ⚡ {user.energy.total}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.energyMuted}>Misafir</Text>
        )}
        <Pressable style={styles.link} onPress={() => router.push("/scoreboard")}>
          <Text style={styles.linkText}>Skor</Text>
        </Pressable>
        <Pressable style={styles.link} onPress={openShop}>
          <Text style={styles.linkText}>Dükkan</Text>
        </Pressable>
        <Pressable style={styles.link} onPress={() => router.push("/admin")}>
          <Text style={styles.linkText}>Admin</Text>
        </Pressable>
        <Pressable style={styles.play} onPress={goPlay}>
          <Text style={styles.playText}>
            {!token ? "Katıl" : !user?.phoneVerified ? "Doğrula" : user?.tribeId ? "Hesap" : "Kabile"}
          </Text>
        </Pressable>
      </View>

      <CitySheetModal
        sheet={sheet}
        loading={sheetLoading}
        loadError={sheetError}
        user={user}
        actionCost={actionCost}
        boost={boostFromUser(user)}
        onClose={closeSheet}
        onPlay={goPlay}
        onSpend={onSpend}
        onClaim={onClaim}
        onShop={onShop}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b1f17" },
  heroChrome: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  brand: {
    fontFamily: "Georgia",
    fontSize: 28,
    color: "#f4e7c5",
    fontWeight: "700",
  },
  tagline: { color: "#9bb0a3", fontSize: 13, marginTop: 2 },
  mapPane: { flex: 1, position: "relative" },
  mapOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10, 22, 32, 0.72)",
    paddingHorizontal: 24,
    gap: 10,
  },
  emptyBanner: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: "rgba(10, 22, 32, 0.85)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  errorBanner: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: "rgba(10, 22, 32, 0.92)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  errorCopy: { flex: 1, gap: 2 },
  overlayTitle: { color: "#f4e7c5", fontSize: 14, fontWeight: "700" },
  overlayText: { color: "#9bb0a3", fontSize: 13, textAlign: "center" },
  retry: {
    backgroundColor: "#c8a96b",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryText: { color: "#0b1f17", fontWeight: "700" },
  flipBanner: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    backgroundColor: "#c8a96b",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  flipText: { color: "#0b1f17", fontWeight: "700" },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#1e3329",
  },
  energy: { color: "#c8a96b", fontWeight: "700", minWidth: 56 },
  energyLit: {
    color: "#f4e7c5",
    textShadowColor: "#c8a96b",
    textShadowRadius: 6,
  },
  energyMuted: { color: "#6b7c72", minWidth: 56 },
  link: { paddingHorizontal: 8, paddingVertical: 6 },
  linkText: { color: "#9bb0a3" },
  play: {
    marginLeft: "auto",
    backgroundColor: "#c8a96b",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  playText: { color: "#0b1f17", fontWeight: "700" },
});
