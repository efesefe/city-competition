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
import { colors, fonts, radii, space, type as typeRoles } from "../lib/theme";

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
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
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
              placeholderTextColor={colors.mutedDim}
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
  root: {
    flex: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.bg,
  },
  brand: {
    ...typeRoles.meta,
    fontFamily: fonts.display,
    fontSize: 13,
    color: colors.accent,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: space.xs,
  },
  title: {
    ...typeRoles.title,
    fontFamily: fonts.display,
    fontSize: 26,
    fontWeight: "700",
    color: colors.ink,
  },
  sub: {
    ...typeRoles.body,
    fontFamily: fonts.body,
    color: colors.muted,
    marginBottom: 10,
    marginTop: space.xs,
    lineHeight: 20,
  },
  list: { gap: space.sm, paddingBottom: space.xl },
  sectionBlock: { gap: space.sm, marginBottom: 10 },
  sectionTitle: {
    fontFamily: fonts.body,
    color: colors.inkDim,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: space.xs,
  },
  sectionRule: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.mutedDim,
    marginBottom: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: radii.md,
  },
  rowSelected: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  swatchPair: {
    flexDirection: "row",
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    overflow: "hidden",
  },
  swatch: { flex: 1, height: "100%" },
  swatchSecondary: { borderLeftWidth: 1, borderLeftColor: "rgba(0,0,0,0.25)" },
  alias: {
    fontFamily: fonts.body,
    color: colors.ink,
    fontSize: 16,
    fontWeight: "600",
  },
  badge: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.accent,
    fontSize: 11,
    marginTop: 2,
  },
  current: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.success,
    fontSize: 11,
    marginTop: 2,
  },
  check: {
    color: colors.accent,
    fontSize: 18,
    fontWeight: "700",
    fontFamily: fonts.body,
  },
  secondary: { paddingVertical: 14, alignItems: "center" },
  secondaryText: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.muted,
    textDecorationLine: "underline",
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.stroke,
    paddingTop: space.md,
    paddingBottom: space.lg,
    gap: space.sm,
  },
  preview: {
    fontFamily: fonts.body,
    color: colors.ink,
    fontWeight: "600",
  },
  previewMuted: {
    fontFamily: fonts.body,
    color: colors.mutedDim,
  },
  cta: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    borderRadius: radii.md,
    alignItems: "center",
  },
  ctaText: {
    ...typeRoles.cta,
    fontFamily: fonts.body,
    color: colors.ink,
  },
  disabled: { opacity: 0.5 },
  error: { color: colors.danger, marginBottom: space.sm, fontFamily: fonts.body },
  hint: {
    color: colors.success,
    marginBottom: space.sm,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.body,
  },
  ticketBox: {
    marginTop: space.md,
    gap: space.sm,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.stroke,
  },
  ticketTitle: {
    fontFamily: fonts.body,
    color: colors.inkDim,
    fontWeight: "700",
    fontSize: 14,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.stroke,
    borderRadius: radii.sm,
    color: colors.ink,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontFamily: fonts.body,
  },
  ticketCta: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.sm,
    paddingVertical: 10,
    alignItems: "center",
  },
  ticketCtaText: {
    fontFamily: fonts.body,
    color: colors.accent,
    fontWeight: "700",
    fontSize: 14,
  },
  ticketNote: {
    color: colors.success,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.body,
  },
});
