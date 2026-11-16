import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { PhoneVerifyWall } from "../components/PhoneVerifyWall";
import { api, type Team } from "../lib/api";
import { isPhoneUnverifiedError, phoneGateMessage } from "../lib/play-gates";
import { useSession } from "../lib/session";

export default function PickTribeScreen() {
  const router = useRouter();
  const { token, user, setSession, updateUser } = useSession();
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      router.replace("/auth");
      return;
    }
    if (user && !user.phoneVerified) {
      // Stay on screen with verify wall — do not allow picker until verified.
      return;
    }
    void api.teams().then((r) => setTeams(r.teams));
  }, [token, user, router]);

  const pick = async (tribeId: string) => {
    if (!token) return;
    if (user && !user.phoneVerified) {
      setError(phoneGateMessage(undefined, "kabile"));
      return;
    }
    setError(null);
    try {
      const res = await api.pickTribe(token, tribeId);
      updateUser(res.user);
      await setSession(token, res.user);
      // Grant daily energy after tribe pick so spend works immediately in slice
      const grant = await api.grantSim(token);
      updateUser(grant.user);
      router.replace("/");
    } catch (e) {
      if (isPhoneUnverifiedError(e)) {
        setError(phoneGateMessage(e, "kabile"));
        return;
      }
      setError(e instanceof Error ? e.message : "pick_failed");
    }
  };

  if (token && user && !user.phoneVerified) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Kabile seçimi kilitli</Text>
        <Text style={styles.sub}>Telefon doğrulaması olmadan Kabile seçilemez.</Text>
        <PhoneVerifyWall kind="kabile" onVerify={() => router.replace("/auth")} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Kabileni seç</Text>
      <Text style={styles.sub}>Önce Big 4, sonra diğer Süper Lig kabileleri.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={teams}
        keyExtractor={(t) => t.internalId}
        contentContainerStyle={{ gap: 8, paddingBottom: 40 }}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => pick(item.internalId)}>
            <View style={[styles.swatch, { backgroundColor: item.primary }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.alias}>{item.publicAlias}</Text>
              {item.big4 ? <Text style={styles.badge}>Big 4</Text> : null}
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, backgroundColor: "#0b1f17" },
  title: { fontFamily: "Georgia", fontSize: 24, color: "#f4e7c5", fontWeight: "700" },
  sub: { color: "#9bb0a3", marginBottom: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#13261d",
    padding: 14,
    borderRadius: 10,
  },
  swatch: { width: 28, height: 28, borderRadius: 6 },
  alias: { color: "#f4e7c5", fontSize: 16, fontWeight: "600" },
  badge: { color: "#c8a96b", fontSize: 11, marginTop: 2 },
  error: { color: "#e07070", marginBottom: 8 },
});
