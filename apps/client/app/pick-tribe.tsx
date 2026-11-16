import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { GuestLoginWall } from "../components/GuestLoginWall";
import { PhoneVerifyWall } from "../components/PhoneVerifyWall";
import { api, type Team } from "../lib/api";
import { isPhoneUnverifiedError, phoneGateMessage } from "../lib/play-gates";
import { useSession } from "../lib/session";

type Section = { key: "big4" | "rest"; title: string; data: Team[] };

/**
 * Post-verify Kabile picker (CC-63).
 * Phone verified only → Big 4 first, then rest → select → confirm Join/Katıl.
 * Aliases from docs/team-aliases.md (`public_alias` only).
 */
export default function PickTribeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ resume?: string }>();
  const { token, user, setSession, updateUser } = useSession();
  const [big4, setBig4] = useState<Team[]>([]);
  const [rest, setRest] = useState<Team[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ticketClub, setTicketClub] = useState("");
  const [ticketNote, setTicketNote] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const isSwitch = Boolean(user?.tribeId);
  const selected = useMemo(
    () => [...big4, ...rest].find((t) => t.internalId === selectedId) ?? null,
    [big4, rest, selectedId],
  );

  useEffect(() => {
    if (!token || !user) {
      setLoading(false);
      return;
    }
    if (!user.phoneVerified) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.teams();
        if (cancelled) return;
        setBig4(r.big4?.length ? r.big4 : r.teams.filter((t) => t.big4));
        setRest(r.rest?.length ? r.rest : r.teams.filter((t) => !t.big4));
        if (user.tribeId) setSelectedId(user.tribeId);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "teams_failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, user]);

  const submitTicket = async () => {
    if (!token || !ticketClub.trim()) return;
    setTicketNote(null);
    try {
      await api.submitTeamAddTicket(token, ticketClub.trim());
      setTicketNote("Talep alındı — admin inceleyecek.");
      setTicketClub("");
      setHint(null);
    } catch (e) {
      setTicketNote(e instanceof Error ? e.message : "ticket_failed");
    }
  };

  const resumeHome = () => {
    const resume = typeof params.resume === "string" ? params.resume : "";
    if (resume && resume !== "/" && /^\d{2}$/.test(resume)) {
      router.replace({ pathname: "/", params: { openPlate: resume } });
      return;
    }
    router.replace("/");
  };

  const confirm = async () => {
    if (!token || !selected || busy) return;
    if (user && !user.phoneVerified) {
      setError(phoneGateMessage(undefined, "kabile"));
      return;
    }
    if (user?.tribeId === selected.internalId) {
      resumeHome();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await api.pickTribe(token, selected.internalId);
      updateUser(res.user);
      await setSession(token, res.user);
      // First join: seed daily energy so map spend works in the slice immediately.
      if (!isSwitch) {
        try {
          const grant = await api.grantSim(token);
          updateUser(grant.user);
        } catch {
          /* claim path still available on map */
        }
      }
      resumeHome();
    } catch (e) {
      if (isPhoneUnverifiedError(e)) {
        setError(phoneGateMessage(e, "kabile"));
        return;
      }
      const msg = e instanceof Error ? e.message : "pick_failed";
      if (msg === "switch_cooldown" || msg.includes("switch_cooldown")) {
        setError("Kabile değiştirme 1 gün beklemeli. / Team switch: 1-day cooldown.");
        return;
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (!token || !user) {
    return (
      <View style={styles.root}>
        <Text style={styles.brand}>City Competition</Text>
        <Text style={styles.title}>Kabileni seç</Text>
        <Text style={styles.sub}>Pick your tribe — after login + phone verify.</Text>
        <GuestLoginWall onLogin={() => router.replace("/auth")} />
      </View>
    );
  }

  if (!user.phoneVerified) {
    return (
      <View style={styles.root}>
        <Text style={styles.brand}>City Competition</Text>
        <Text style={styles.title}>Kabile seçimi kilitli</Text>
        <Text style={styles.sub}>Telefon doğrulaması olmadan Kabile seçilemez.</Text>
        <PhoneVerifyWall kind="kabile" onVerify={() => router.replace("/auth")} />
      </View>
    );
  }

  const sections: Section[] = [
    { key: "big4", title: "Big 4", data: big4 },
    { key: "rest", title: "Diğer Süper Lig", data: rest },
  ];

  return (
    <View style={styles.root}>
      <Text style={styles.brand}>City Competition</Text>
      <Text style={styles.title}>{isSwitch ? "Kabile değiştir" : "Kabileni seç"}</Text>
      <Text style={styles.sub}>
        {isSwitch
          ? "Sonra değiştirebilirsin (1 gün bekleme). / Switch later (1-day cooldown)."
          : "Sonra değiştirebilirsin (1 gün bekleme). / You can switch later (1-day cooldown)."}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {loading ? (
        <ActivityIndicator color="#c8a96b" style={{ marginTop: 24 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {sections.map((section) => (
            <View key={section.key} style={styles.sectionBlock}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.key === "rest" ? (
                <Text style={styles.sectionRule}>── Big 4 sonrası / then rest ──</Text>
              ) : null}
              {section.data.map((item) => {
                const active = selectedId === item.internalId;
                const current = user.tribeId === item.internalId;
                return (
                  <Pressable
                    key={item.internalId}
                    style={[styles.row, active && styles.rowSelected]}
                    onPress={() => setSelectedId(item.internalId)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    testID={`kabile-${item.internalId}`}
                  >
                    <View style={styles.swatchPair}>
                      <View style={[styles.swatch, { backgroundColor: item.primary }]} />
                      <View
                        style={[
                          styles.swatch,
                          styles.swatchSecondary,
                          { backgroundColor: item.secondary },
                        ]}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.alias}>{item.publicAlias}</Text>
                      {section.key === "big4" ? (
                        <Text style={styles.badge}>Big 4</Text>
                      ) : null}
                      {current ? <Text style={styles.current}>Mevcut / Current</Text> : null}
                    </View>
                    {active ? <Text style={styles.check}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          ))}

          <View style={styles.ticketBox} testID="kabile-request-add">
            <Text style={styles.ticketTitle}>Takım ekle talebi / Request add-team</Text>
            <Text style={styles.sub}>Listede yoksa ops’a ilet (resmi isim admin’de kalır).</Text>
            <TextInput
              style={styles.input}
              value={ticketClub}
              onChangeText={setTicketClub}
              placeholder="İstediğin kulüp (ops notu)"
              placeholderTextColor="#5a7266"
            />
            <Pressable style={styles.ticketCta} onPress={submitTicket}>
              <Text style={styles.ticketCtaText}>Ticket gönder</Text>
            </Pressable>
            {ticketNote ? <Text style={styles.ticketNote}>{ticketNote}</Text> : null}
          </View>
        </ScrollView>
      )}

      <View style={styles.footer}>
        {selected ? (
          <Text style={styles.preview}>
            Seçili: {selected.publicAlias}
          </Text>
        ) : (
          <Text style={styles.previewMuted}>Bir Kabile seç / Pick a tribe</Text>
        )}
        <Pressable
          style={[styles.cta, (!selected || busy) && styles.disabled]}
          onPress={confirm}
          disabled={!selected || busy}
          testID="kabile-confirm"
        >
          <Text style={styles.ctaText}>
            {busy
              ? "…"
              : selected
                ? `Katıl ${selected.publicAlias} / Join`
                : "Katıl / Join"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: "#0b1f17" },
  brand: {
    fontFamily: "Georgia",
    fontSize: 14,
    color: "#c8a96b",
    fontWeight: "600",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  title: { fontFamily: "Georgia", fontSize: 26, color: "#f4e7c5", fontWeight: "700" },
  sub: { color: "#9bb0a3", marginBottom: 10, marginTop: 4, lineHeight: 20 },
  list: { gap: 8, paddingBottom: 24 },
  sectionBlock: { gap: 8, marginBottom: 10 },
  sectionTitle: {
    color: "#c8a96b",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 4,
  },
  sectionRule: { color: "#6b7c72", fontSize: 12, marginBottom: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#13261d",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1e3329",
  },
  rowSelected: {
    borderColor: "#c8a96b",
    backgroundColor: "#1a3226",
  },
  swatchPair: { flexDirection: "row", width: 28, height: 28, borderRadius: 6, overflow: "hidden" },
  swatch: { flex: 1, height: "100%" },
  swatchSecondary: { borderLeftWidth: 1, borderLeftColor: "rgba(0,0,0,0.25)" },
  alias: { color: "#f4e7c5", fontSize: 16, fontWeight: "600" },
  badge: { color: "#c8a96b", fontSize: 11, marginTop: 2 },
  current: { color: "#8fd4a0", fontSize: 11, marginTop: 2 },
  check: { color: "#c8a96b", fontSize: 18, fontWeight: "700" },
  secondary: { paddingVertical: 14, alignItems: "center" },
  secondaryText: { color: "#9bb0a3", fontSize: 13, textDecorationLine: "underline" },
  footer: {
    borderTopWidth: 1,
    borderTopColor: "#1e3329",
    paddingTop: 12,
    paddingBottom: 16,
    gap: 8,
  },
  preview: { color: "#f4e7c5", fontWeight: "600" },
  previewMuted: { color: "#6b7c72" },
  cta: {
    backgroundColor: "#c8a96b",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  ctaText: { color: "#0b1f17", fontWeight: "700", fontSize: 16 },
  disabled: { opacity: 0.5 },
  error: { color: "#e07070", marginBottom: 8 },
  hint: { color: "#8fd4a0", marginBottom: 8, fontSize: 13, lineHeight: 18 },
  ticketBox: {
    marginTop: 12,
    gap: 8,
    backgroundColor: "#13261d",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1e3329",
  },
  ticketTitle: { color: "#c8a96b", fontWeight: "700", fontSize: 14 },
  input: {
    backgroundColor: "#0b1f17",
    borderWidth: 1,
    borderColor: "#1e3329",
    borderRadius: 8,
    color: "#f4e7c5",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  ticketCta: {
    backgroundColor: "#1a3226",
    borderWidth: 1,
    borderColor: "#c8a96b",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  ticketCtaText: { color: "#c8a96b", fontWeight: "700", fontSize: 14 },
  ticketNote: { color: "#8fd4a0", fontSize: 13, lineHeight: 18 },
});
