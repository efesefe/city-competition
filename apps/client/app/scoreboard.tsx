import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  api,
  type PlayerScoreboardEntry,
  type SeasonInfo,
  type TeamScoreboardEntry,
} from "../lib/api";
import { shareCardNative } from "../lib/share";
import { useSession } from "../lib/session";
import { colors, fonts, space, type as typeRoles } from "../lib/theme";

type TabId = "teams" | "players";

export default function ScoreboardScreen() {
  const { token, user } = useSession();
  const [tab, setTab] = useState<TabId>("teams");
  const [season, setSeason] = useState<SeasonInfo | null>(null);
  const [teams, setTeams] = useState<TeamScoreboardEntry[]>([]);
  const [players, setPlayers] = useState<PlayerScoreboardEntry[]>([]);
  const [you, setYou] = useState<PlayerScoreboardEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const canShare = !!(token && user?.phoneVerified && user.tribeId);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.scoreboards(token);
      setSeason(data.teams.season);
      setTeams(data.teams.teams);
      setPlayers(data.players.players);
      setYou(data.players.you);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const myTeamId = user?.tribeId ?? null;
  const myUserId = user?.id ?? null;
  const isGuest = !token;

  const shareMyTribe = async () => {
    if (!token || !user?.tribeId) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const mine = teams.find((t) => t.teamId === user.tribeId);
      const { card } = await api.createShareCard(token, {
        kind: "accomplishment",
        variant: "cities_owned",
        citiesOwned: mine?.citiesOwned,
      });
      await shareCardNative(card);
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "share_failed");
    } finally {
      setShareBusy(false);
    }
  };

  return (
    <View style={styles.root} testID="scoreboard-screen">
      <Text style={styles.season}>{season?.label ?? "Season 0"}</Text>
      <Text style={styles.metricHint}>
        {tab === "teams" ? "Rank by cities owned" : "Metric: total support spent (season)"}
      </Text>

      <View style={styles.tabs} accessibilityRole="tablist">
        <Pressable
          style={[styles.tab, tab === "teams" && styles.tabActive]}
          onPress={() => setTab("teams")}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === "teams" }}
          testID="scoreboard-tab-teams"
        >
          <Text style={[styles.tabText, tab === "teams" && styles.tabTextActive]}>Team</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === "players" && styles.tabActive]}
          onPress={() => setTab("players")}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === "players" }}
          testID="scoreboard-tab-players"
        >
          <Text style={[styles.tabText, tab === "players" && styles.tabTextActive]}>Players</Text>
        </Pressable>
      </View>

      {isGuest ? (
        <Text style={styles.guestNote} testID="scoreboard-guest-note">
          Misafirler skor tablolarını serbestçe gezebilir — giriş gerekmez.
        </Text>
      ) : null}

      {canShare ? (
        <Pressable
          style={[styles.shareBtn, shareBusy && styles.shareDisabled]}
          disabled={shareBusy}
          onPress={() => void shareMyTribe()}
          accessibilityRole="button"
        >
          <Text style={styles.shareText}>
            {shareBusy ? "…" : "Paylaş — kabile skoru"}
          </Text>
        </Pressable>
      ) : null}
      {shareError ? <Text style={styles.error}>{shareError}</Text> : null}

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : error ? (
        <Text style={styles.error} testID="scoreboard-error">
          {error}
        </Text>
      ) : tab === "teams" ? (
        <FlatList
          data={teams}
          keyExtractor={(t) => t.teamId}
          testID="scoreboard-teams-list"
          ListFooterComponent={
            season ? (
              <Text style={styles.ends} testID="scoreboard-season-end">
                Ends {season.endsAtLabelTr}
              </Text>
            ) : (
              <View />
            )
          }
          renderItem={({ item }) => {
            const mine = myTeamId != null && item.teamId === myTeamId;
            return (
              <View
                style={[styles.row, mine && styles.rowMine]}
                testID={mine ? "scoreboard-team-you" : undefined}
              >
                <Text style={styles.rank}>{item.rank}</Text>
                <View style={[styles.dot, { backgroundColor: item.color }]} />
                <Text style={styles.alias}>{item.alias}</Text>
                <Text style={styles.val}>{item.citiesOwned}</Text>
                {mine ? <Text style={styles.youTag}>←you</Text> : null}
              </View>
            );
          }}
        />
      ) : (
        <FlatList
          data={players}
          keyExtractor={(p) => p.userId}
          testID="scoreboard-players-list"
          ListEmptyComponent={
            <Text style={styles.empty}>Henüz sezon desteği yok.</Text>
          }
          ListFooterComponent={
            <>
              {you && !players.some((p) => p.userId === you.userId) ? (
                <View style={[styles.row, styles.rowMine]} testID="scoreboard-player-you-footer">
                  <Text style={styles.rank}>{you.rank}</Text>
                  <Text style={styles.alias}>@{you.handle}</Text>
                  <Text style={styles.tribe}>{you.tribeAlias ?? "—"}</Text>
                  <Text style={styles.val}>{formatSpent(you.supportSpent)}</Text>
                  <Text style={styles.youTag}>←</Text>
                </View>
              ) : null}
              <Text style={styles.metricFoot}>Metric: total support spent (season-wide)</Text>
              {season ? (
                <Text style={styles.ends}>Ends {season.endsAtLabelTr}</Text>
              ) : null}
            </>
          }
          renderItem={({ item }) => {
            const mine = myUserId != null && item.userId === myUserId;
            return (
              <View
                style={[styles.row, mine && styles.rowMine]}
                testID={mine ? "scoreboard-player-you" : undefined}
              >
                <Text style={styles.rank}>{item.rank}</Text>
                <Text style={styles.alias}>@{item.handle}</Text>
                <Text style={styles.tribe}>{item.tribeAlias ?? "—"}</Text>
                <Text style={styles.val}>{formatSpent(item.supportSpent)}</Text>
                {mine ? <Text style={styles.youTag}>←</Text> : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

function formatSpent(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: space.lg, backgroundColor: colors.bg },
  season: {
    ...typeRoles.title,
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: "700",
    color: colors.ink,
  },
  metricHint: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.muted,
    marginTop: space.xs,
    marginBottom: space.md,
  },
  tabs: {
    flexDirection: "row",
    gap: space.sm,
    marginBottom: space.md,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: space.sm,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: colors.accent },
  tabText: {
    fontFamily: fonts.body,
    color: colors.mutedDim,
    fontWeight: "600",
  },
  tabTextActive: { color: colors.ink },
  guestNote: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.muted,
    marginBottom: space.md,
  },
  shareBtn: {
    alignSelf: "flex-start",
    paddingVertical: space.sm,
    paddingHorizontal: 2,
    marginBottom: 10,
  },
  shareDisabled: { opacity: 0.5 },
  shareText: {
    fontFamily: fonts.body,
    color: colors.accent,
    fontWeight: "700",
  },
  error: { color: colors.danger, marginTop: space.lg, fontFamily: fonts.body },
  empty: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.mutedDim,
    marginTop: space.xl,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.stroke,
  },
  rowMine: { backgroundColor: colors.accentSoft },
  rank: { width: 28, color: colors.mutedDim, fontFamily: fonts.body },
  dot: { width: 12, height: 12, borderRadius: 2 },
  alias: { flex: 1, color: colors.ink, fontFamily: fonts.body },
  tribe: {
    width: 96,
    color: colors.muted,
    fontSize: 12,
    fontFamily: fonts.body,
  },
  val: {
    ...typeRoles.tabular,
    fontFamily: fonts.body,
    color: colors.inkDim,
    fontWeight: "700",
    minWidth: 40,
    textAlign: "right",
  },
  youTag: {
    color: colors.accent,
    fontSize: 12,
    marginLeft: space.xs,
    fontFamily: fonts.body,
  },
  ends: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.mutedDim,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  metricFoot: {
    ...typeRoles.meta,
    fontFamily: fonts.body,
    color: colors.mutedDim,
    marginTop: space.md,
  },
});
