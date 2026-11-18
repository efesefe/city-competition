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
  type TeamAddTicket,
} from "../lib/api";
import { useSession } from "../lib/session";

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminOpsScreen() {
  const { token, user, updateUser } = useSession();
  const [teams, setTeams] = useState<Team[]>([]);
  const [windows, setWindows] = useState<MatchDayWindow[]>([]);
  const [tickets, setTickets] = useState<TeamAddTicket[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [otpEnrolled, setOtpEnrolled] = useState(false);
  const [otpCode, setOtpCode] = useState("");

  const [smallTry, setSmallTry] = useState("49.99");
  const [mediumTry, setMediumTry] = useState("129.99");
  const [largeTry, setLargeTry] = useState("249.99");
  const [freeGrant, setFreeGrant] = useState("100");
  const [actionCost, setActionCost] = useState("15");
  const [seasonStart, setSeasonStart] = useState("2026-11-27T12:00");
  const [seasonEnd, setSeasonEnd] = useState("2027-05-23T23:59");

  const [seedSummary, setSeedSummary] = useState<string | null>(null);
  const [metricsText, setMetricsText] = useState<string | null>(null);
  const [acceptAlias, setAcceptAlias] = useState("");

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
    const [matchDay, economy, seeds, ticketRes, metrics] = await Promise.all([
      api.adminListMatchDay(token, { includeCanceled: false }),
      api.adminEconomy(token),
      api.adminSeedStatus(token),
      api.adminListTickets(token, "open"),
      api.adminMetrics(token),
      api.adminOtpStatus(token).then((s) => setOtpEnrolled(s.enrolled)),
    ]);
    setWindows(matchDay.windows);
    setSmallTry(String(economy.prices.smallTry ?? ""));
    setMediumTry(String(economy.prices.mediumTry ?? ""));
    setLargeTry(String(economy.prices.largeTry ?? ""));
    setFreeGrant(String(economy.freeDailyGrant));
    setActionCost(String(economy.actionCost));
    setSeasonStart(toLocalInput(new Date(economy.season.season0StartsAt)));
    setSeasonEnd(toLocalInput(new Date(economy.season.season0EndsAt)));
    setSeedSummary(
      `${seeds.teams}/${seeds.expectedTeams} alias · ${seeds.cities}/${seeds.expectedCities} şehir · support ${seeds.supportRows}` +
        (seeds.confirmedAt ? ` · confirmed ${new Date(seeds.confirmedAt).toLocaleString()}` : " · not confirmed"),
    );
    setTickets(ticketRes.tickets);
    const m = metrics.metrics;
    setMetricsText(
      `DAU ${m.dau} · flips ${m.flipsToday}/${m.flips7d} (bugün/7g) · gelir ₺${m.revenueTodayTry}/₺${m.revenueMtdTry} · concurrent ${m.matchDay.currentConcurrent}${m.matchDay.inMatchWindow ? " (maç)" : ""} · açık ticket ${m.openTeamAddTickets}`,
    );
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

  const enroll = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await api.adminOtpEnroll(token);
      setOtpEnrolled(true);
      setNote("Admin telefon OTP kaydı tamam");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const savePrices = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const ch = await api.adminOtpChallenge(token, "pack_prices");
      const code = ch.code || otpCode;
      if (ch.code) setOtpCode(ch.code);
      await api.adminUpdatePackPrices(token, {
        otp: code || "",
        smallTry: Number(smallTry),
        mediumTry: Number(mediumTry),
        largeTry: Number(largeTry),
      });
      setNote("Paket fiyatları kaydedildi (OTP)");
      await refresh();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveTunables = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const ch = await api.adminOtpChallenge(token, "economy_tunables");
      const code = ch.code || otpCode;
      if (ch.code) setOtpCode(ch.code);
      await api.adminUpdateTunables(token, {
        otp: code || "",
        freeDailyGrant: Number(freeGrant),
        actionCost: Number(actionCost),
      });
      setNote("Enerji/cost tunables kaydedildi (OTP)");
      await refresh();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveSeason = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const ch = await api.adminOtpChallenge(token, "season_bounds");
      const code = ch.code || otpCode;
      if (ch.code) setOtpCode(ch.code);
      await api.adminUpdateSeason(token, {
        otp: code || "",
        season0StartsAt: new Date(seasonStart).toISOString(),
        season0EndsAt: new Date(seasonEnd).toISOString(),
      });
      setNote("Season 0 bounds kaydedildi (OTP)");
      await refresh();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadSeeds = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const ch = await api.adminOtpChallenge(token, "seed_write");
      const code = ch.code || otpCode;
      if (ch.code) setOtpCode(ch.code);
      await api.adminSeedLoad(token, { otp: code || "", resetSupport: true });
      setNote("Alias + 81 şehir seed matrix yüklendi (OTP)");
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

  const triage = async (id: string, action: "accept" | "reject" | "defer") => {
    if (!token) return;
    setBusy(true);
    try {
      await api.adminTriageTicket(token, id, {
        action,
        publicAlias: action === "accept" ? acceptAlias || undefined : undefined,
        adminNote:
          action === "reject" ? "pick existing alias" : action === "defer" ? "deferred" : null,
      });
      setNote(`Ticket ${action}`);
      setAcceptAlias("");
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
        <Text style={styles.title}>Admin — ops</Text>
        <Text style={styles.sub}>Oturum gerekli.</Text>
        <Link href="/auth" style={styles.link}>
          Giriş yap
        </Link>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Admin — Season 0 ops</Text>
      <Text style={styles.sub}>
        CC-50/51 maç günü · CC-52 OTP · CC-53 ticket · CC-54 seed · CC-55 metrics
      </Text>

      {!isAdmin ? (
        __DEV__ ? (
          <Pressable style={styles.cta} onPress={promote} disabled={busy}>
            <Text style={styles.ctaText}>Admin ol (sim)</Text>
          </Pressable>
        ) : (
          <Text style={styles.sub}>
            Admin rolü yok — soft launch’ta sim promote gizli; ops API ile bootstrap.
          </Text>
        )
      ) : (
        <Text style={styles.badge}>Rol: admin{otpEnrolled ? " · OTP enrolled" : " · OTP yok"}</Text>
      )}

      {isAdmin ? (
        <>
          <Text style={styles.section}>CC-55 — Metrics</Text>
          <Text style={styles.meta}>{metricsText || "…"}</Text>
          <Text style={styles.hint}>Watch-only — kill gate yok</Text>

          <Text style={styles.section}>CC-52 — OTP gate</Text>
          {!otpEnrolled ? (
            <Pressable style={styles.cta} onPress={enroll} disabled={busy}>
              <Text style={styles.ctaText}>Telefon OTP kaydet</Text>
            </Pressable>
          ) : (
            <Text style={styles.badge}>Gated: prices · grant/cost · season · seeds</Text>
          )}
          <Text style={styles.label}>OTP kodu (mock otomatik dolar)</Text>
          <TextInput
            style={styles.input}
            value={otpCode}
            onChangeText={setOtpCode}
            keyboardType="number-pad"
            maxLength={6}
          />

          <Text style={styles.section}>Paket fiyatları (TRY)</Text>
          <TextInput style={styles.input} value={smallTry} onChangeText={setSmallTry} />
          <TextInput style={styles.input} value={mediumTry} onChangeText={setMediumTry} />
          <TextInput style={styles.input} value={largeTry} onChangeText={setLargeTry} />
          <Pressable style={styles.cta} onPress={savePrices} disabled={busy || !otpEnrolled}>
            <Text style={styles.ctaText}>Fiyatları kaydet (OTP)</Text>
          </Pressable>

          <Text style={styles.section}>Enerji / action cost</Text>
          <Text style={styles.label}>Free grant</Text>
          <TextInput style={styles.input} value={freeGrant} onChangeText={setFreeGrant} />
          <Text style={styles.label}>Action cost (10–20)</Text>
          <TextInput style={styles.input} value={actionCost} onChangeText={setActionCost} />
          <Pressable style={styles.cta} onPress={saveTunables} disabled={busy || !otpEnrolled}>
            <Text style={styles.ctaText}>Tunables kaydet (OTP)</Text>
          </Pressable>

          <Text style={styles.section}>Season 0 bounds</Text>
          <Text style={styles.label}>Start (yerel)</Text>
          <TextInput style={styles.input} value={seasonStart} onChangeText={setSeasonStart} />
          <Text style={styles.label}>End (yerel) — 23 May 2027 23:59 TR</Text>
          <TextInput style={styles.input} value={seasonEnd} onChangeText={setSeasonEnd} />
          <Pressable style={styles.cta} onPress={saveSeason} disabled={busy || !otpEnrolled}>
            <Text style={styles.ctaText}>Season bounds kaydet (OTP)</Text>
          </Pressable>

          <Text style={styles.section}>CC-54 — Aliases + seed matrix</Text>
          <Text style={styles.meta}>{seedSummary || "…"}</Text>
          <Pressable style={styles.ctaSecondary} onPress={loadSeeds} disabled={busy || !otpEnrolled}>
            <Text style={styles.ctaSecondaryText}>Yükle / confirm (OTP)</Text>
          </Pressable>

          <Text style={styles.section}>CC-53 — Team-add tickets</Text>
          <Text style={styles.label}>Accept alias (*… Kabilesi*)</Text>
          <TextInput
            style={styles.input}
            value={acceptAlias}
            onChangeText={setAcceptAlias}
            placeholder="Örn. Zeytin Kabilesi"
            placeholderTextColor="#5a7266"
          />
          {tickets.length === 0 ? (
            <Text style={styles.sub}>Açık ticket yok.</Text>
          ) : (
            tickets.map((t) => (
              <View key={t.id} style={styles.card}>
                <Text style={styles.pack}>{t.requestedClub}</Text>
                <Text style={styles.meta}>
                  {t.requesterHandle || t.userId} · {new Date(t.createdAt).toLocaleString()}
                </Text>
                <View style={styles.row}>
                  <Pressable style={styles.mini} onPress={() => triage(t.id, "accept")} disabled={busy}>
                    <Text style={styles.miniText}>Accept</Text>
                  </Pressable>
                  <Pressable style={styles.mini} onPress={() => triage(t.id, "reject")} disabled={busy}>
                    <Text style={styles.miniText}>Reject</Text>
                  </Pressable>
                  <Pressable style={styles.mini} onPress={() => triage(t.id, "defer")} disabled={busy}>
                    <Text style={styles.miniText}>Defer</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}

          <Text style={styles.section}>Takım (maç günü)</Text>
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
  hint: { color: "#6a8576", fontSize: 11 },
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
  row: { flexDirection: "row", gap: 8, marginTop: 6 },
  mini: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#3d5a4c",
  },
  miniText: { color: "#c8a96b", fontSize: 12 },
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
