import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CitySheetModal } from "../components/CitySheet";
import { TurkiyeMap } from "../components/TurkiyeMap";
import { api, type CitySheet, type DigestCity } from "../lib/api";
import { wsUrl } from "../lib/config";
import { useSession } from "../lib/session";

function idemKey() {
  return `spend_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function MapScreen() {
  const router = useRouter();
  const { user, token, updateUser, refresh } = useSession();
  const [digest, setDigest] = useState<DigestCity[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState<CitySheet | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [actionCost, setActionCost] = useState(15);
  const [pulse, setPulse] = useState<Set<string>>(new Set());
  const [flipBanner, setFlipBanner] = useState<string | null>(null);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    void api.meta().then((m) => setActionCost(m.actionCost));
    void api.digest().then((d) => setDigest(d.cities));
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    try {
      ws = new WebSocket(wsUrl());
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (msg.type === "digest" && Array.isArray(msg.cities)) {
            setDigest(msg.cities);
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
    } catch {
      /* ws optional for browse */
    }
    return () => {
      closed = true;
      ws?.close();
      void closed;
    };
  }, [fade]);

  const openCity = useCallback(async (plate: string) => {
    setSelected(plate);
    setSheetLoading(true);
    setSheet(null);
    try {
      const s = await api.city(plate);
      setSheet(s);
    } finally {
      setSheetLoading(false);
    }
  }, []);

  const goPlay = () => {
    if (!token) {
      router.push("/auth");
      return;
    }
    if (!user?.phoneVerified) {
      router.push("/auth");
      return;
    }
    if (!user.tribeId) {
      router.push("/pick-tribe");
      return;
    }
  };

  const onSpend = async (amount: number) => {
    if (!token || !selected) return;
    const res = await api.spend(token, selected, {
      confirmed: true,
      idempotencyKey: idemKey(),
      amount,
    });
    setSheet(res.sheet);
    setDigest(res.digest);
    updateUser(res.user);
  };

  return (
    <View style={styles.root}>
      <View style={styles.heroChrome}>
        <Text style={styles.brand}>City Competition</Text>
        <Text style={styles.tagline}>Türkiye paylaşılıyor. Kabileni seç, şehirler için savaş.</Text>
      </View>

      <View style={styles.mapPane}>
        <TurkiyeMap
          digest={digest}
          selectedPlate={selected}
          pulsePlates={pulse}
          onSelect={openCity}
        />
        {flipBanner ? (
          <Animated.View style={[styles.flipBanner, { opacity: fade }]}>
            <Text style={styles.flipText}>{flipBanner}</Text>
          </Animated.View>
        ) : null}
      </View>

      <View style={styles.bar}>
        {user?.phoneVerified ? (
          <Text style={styles.energy}>⚡ {user.energy.total}</Text>
        ) : (
          <Text style={styles.energyMuted}>Misafir</Text>
        )}
        <Pressable style={styles.link} onPress={() => router.push("/scoreboard")}>
          <Text style={styles.linkText}>Skor</Text>
        </Pressable>
        <Pressable style={styles.link} onPress={() => router.push("/shop")}>
          <Text style={styles.linkText}>Dükkan</Text>
        </Pressable>
        <Pressable style={styles.play} onPress={goPlay}>
          <Text style={styles.playText}>{user?.tribeId ? "Hesap" : "Katıl"}</Text>
        </Pressable>
      </View>

      <CitySheetModal
        sheet={sheet}
        loading={sheetLoading}
        user={user}
        actionCost={actionCost}
        onClose={() => {
          setSheet(null);
          setSelected(null);
        }}
        onPlay={goPlay}
        onSpend={onSpend}
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
