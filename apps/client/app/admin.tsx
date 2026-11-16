import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link } from "expo-router";
import {
  api,
  type MatchDayWindow,
  type Team,
} from "../lib/api";
import { useSession } from "../lib/session";

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminMatchDayScreen() {
  const { token, user, updateUser } = useSession();
  const [teams, setTeams] = useState<Team[]>([]);
  const [windows, setWindows] = useState<MatchDayWindow[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [teamId, setTeamId] = useState("sl_galatasaray");
  const [kickoffAt, setKickoffAt] = useState(() =>
    toLocalInput(new Date(Date.now() + 2 * 60 * 60 * 1000)),
  );
  const [fullTimeAt, setFullTimeAt] = useState(() =>
    toLocalInput(new Date(Date.now() + 4 * 60 * 60 * 1000)),
  );
  const [boostNotes, setBoostNotes] = useState("Aslan home GW");
  const [spotlightPlate, setSpotlightPlate] = useState("34");
  const [involved, setInvolved] = useState("Aslan Kabilesi, Kartal Kabilesi");
  const [warLabel, setWarLabel] = useState("İstanbul derbi");

  const isAdmin = user?.role === "admin";

  const refresh = useCallback(async () => {
    if (!token || !isAdmin) return;
    const res = await api.adminListMatchDay(token, { includeCanceled: false });
    setWindows(res.windows);
  }, [token, isAdmin]);

  useEffect(() => {
    void api.teams().then((r) => {
      setTeams(r.teams);
      if (r.teams[0]) setTeamId(r.teams[0].internalId);
    });
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setNote(e.message));
  }, [refresh]);

  const promote = async () => {
    if (!token) {
      setNote("Giriş gerekli");
      return;
    }
    setBusy(true);
    try {
      const res = await api.adminPromoteSim(token);
      updateUser(res.user);
      setNote("Admin rolü verildi (sim)");
      await refresh();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const scheduleBoost = async () => {
    if (!token) return;
    setBusy(true);
    setNote(null);
    try {
      await api.adminScheduleTeamBoost(token, {
        teamId,
        kickoffAt: new Date(kickoffAt).toISOString(),
        fullTimeAt: new Date(fullTimeAt).toISOString(),
        notes: boostNotes,
      });
      setNote("Takım boost penceresi planlandı (+25%, KO−1s → MS+30dk)");
      await refresh();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const scheduleWar = async () => {
    if (!token) return;
    setBusy(true);
    setNote(null);
    try {
      await api.adminScheduleDerbyWar(token, {
        teamId,
        spotlightPlate,
        kickoffAt: new Date(kickoffAt).toISOString(),
        fullTimeAt: new Date(fullTimeAt).toISOString(),
        label: warLabel,
        involvedAliases: involved,
        notes: warLabel,
      });
      setNote(`Derbi savaşı planlandı (il ${spotlightPlate})`);
      await refresh();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    if (!token) return;
    setBusy(true);
    try {
      await api.adminCancelMatchDay(token, id);
      await refresh();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Admin — maç günü</Text>
        <Text style={styles.sub}>Oturum gerekli.</Text>
        <Link href="/auth" style={styles.link}>
          Giriş yap
        </Link>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Admin — maç günü</Text>
      <Text style={styles.sub}>
        CC-50 takım +25% (KO−1s → MS+30dk) · CC-51 derbi şehir savaşı
      </Text>

      {!isAdmin ? (
        <Pressable style={styles.cta} onPress={promote} disabled={busy}>
          <Text style={styles.ctaText}>Admin ol (sim)</Text>
        </Pressable>
      ) : (
        <Text style={styles.badge}>Rol: admin</Text>
      )}

      {isAdmin ? (
        <>
          <Text style={styles.section}>Takım</Text>
          <ScrollView horizontal style={styles.teamRow}>
            {teams.map((t) => (
              <Pressable
                key={t.internalId}
                style={[styles.chip, teamId === t.internalId && styles.chipOn]}
                onPress={() => setTeamId(t.internalId)}
              >
                <Text style={styles.chipText}>{t.publicAlias}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={styles.label}>Kickoff (yerel)</Text>
          <TextInput
            style={styles.input}
            value={kickoffAt}
            onChangeText={setKickoffAt}
            autoCapitalize="none"
          />
          <Text style={styles.label}>FT / beklenen bitiş (yerel)</Text>
          <TextInput
            style={styles.input}
            value={fullTimeAt}
            onChangeText={setFullTimeAt}
            autoCapitalize="none"
          />

          <Text style={styles.section}>CC-50 — Takım boost</Text>
          <TextInput
            style={styles.input}
            value={boostNotes}
            onChangeText={setBoostNotes}
            placeholder="Ops notu"
            placeholderTextColor="#5a7266"
          />
          <Pressable style={styles.cta} onPress={scheduleBoost} disabled={busy}>
            <Text style={styles.ctaText}>+25% pencere planla</Text>
          </Pressable>

          <Text style={styles.section}>CC-51 — Derbi savaşı</Text>
          <Text style={styles.label}>Şehir plaka (ör. 34)</Text>
          <TextInput
            style={styles.input}
            value={spotlightPlate}
            onChangeText={setSpotlightPlate}
            maxLength={3}
          />
          <Text style={styles.label}>Etiket</Text>
          <TextInput style={styles.input} value={warLabel} onChangeText={setWarLabel} />
          <Text style={styles.label}>İlgili aliasler (ops)</Text>
          <TextInput style={styles.input} value={involved} onChangeText={setInvolved} />
          <Pressable style={styles.ctaSecondary} onPress={scheduleWar} disabled={busy}>
            <Text style={styles.ctaSecondaryText}>Derbi savaşı planla</Text>
          </Pressable>

          <Text style={styles.section}>Planlı pencereler</Text>
          {windows.length === 0 ? (
            <Text style={styles.sub}>Henüz yok.</Text>
          ) : (
            windows.map((w) => (
              <View key={w.id} style={styles.card}>
                <Text style={styles.pack}>
                  {w.kind === "derby_war" ? "Derbi" : "Boost"} · {w.teamAlias}
                </Text>
                <Text style={styles.meta}>
                  {new Date(w.startsAt).toLocaleString()} →{" "}
                  {new Date(w.endsAt).toLocaleString()}
                </Text>
                <Text style={styles.meta}>
                  ×{w.boostPct}
                  {w.spotlightPlate ? ` · il ${w.spotlightPlate}` : ""}
                  {w.label ? ` · ${w.label}` : ""}
                </Text>
                <Pressable style={styles.cancel} onPress={() => cancel(w.id)} disabled={busy}>
                  <Text style={styles.cancelText}>İptal</Text>
                </Pressable>
              </View>
            ))
          )}
        </>
      ) : null}

      {note ? <Text style={styles.note}>{note}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b1f17" },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  title: { fontFamily: "Georgia", fontSize: 24, color: "#f4e7c5", fontWeight: "700" },
  sub: { color: "#9bb0a3", marginBottom: 4 },
  section: {
    marginTop: 12,
    fontFamily: "Georgia",
    fontSize: 18,
    color: "#c8a96b",
    fontWeight: "700",
  },
  label: { color: "#9bb0a3", fontSize: 12, marginTop: 4 },
  input: {
    backgroundColor: "#13261d",
    borderWidth: 1,
    borderColor: "#3d5a4c",
    borderRadius: 8,
    padding: 10,
    color: "#f4e7c5",
  },
  teamRow: { maxHeight: 44 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#13261d",
    marginRight: 6,
    borderWidth: 1,
    borderColor: "#3d5a4c",
  },
  chipOn: { borderColor: "#c8a96b", backgroundColor: "#1a3326" },
  chipText: { color: "#f4e7c5", fontSize: 12 },
  cta: {
    backgroundColor: "#c8a96b",
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 8,
  },
  ctaText: { color: "#0b1f17", fontWeight: "700" },
  ctaSecondary: {
    borderWidth: 1,
    borderColor: "#c8a96b",
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 8,
  },
  ctaSecondaryText: { color: "#c8a96b", fontWeight: "700" },
  badge: { color: "#8fd4a0", fontWeight: "600" },
  card: {
    backgroundColor: "#13261d",
    padding: 14,
    borderRadius: 10,
    gap: 4,
  },
  pack: { color: "#f4e7c5", fontWeight: "600" },
  meta: { color: "#9bb0a3", fontSize: 12 },
  cancel: {
    marginTop: 6,
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#8a4a4a",
  },
  cancelText: { color: "#e8a0a0", fontSize: 12 },
  note: { color: "#8fd4a0", marginTop: 8 },
  link: { color: "#c8a96b", marginTop: 12 },
});
