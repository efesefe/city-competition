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
        <ActivityIndicator color="#c8a96b" style={{ marginTop: 24 }} />
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
  root: { flex: 1, padding: 16, backgroundColor: "#0b1f17" },
  season: {
    fontFamily: "Georgia",
    fontSize: 22,
    color: "#f4e7c5",
    fontWeight: "700",
  },
  metricHint: { color: "#9bb0a3", marginTop: 4, marginBottom: 12, fontSize: 13 },
  tabs: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: "#c8a96b" },
  tabText: { color: "#6b7c72", fontWeight: "600" },
  tabTextActive: { color: "#f4e7c5" },
  guestNote: { color: "#9bb0a3", marginBottom: 12, fontSize: 12 },
  shareBtn: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#3d5a4c",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  shareDisabled: { opacity: 0.5 },
  shareText: { color: "#c8a96b", fontWeight: "700" },
  error: { color: "#e07a5f", marginTop: 16 },
  empty: { color: "#6b7c72", marginTop: 24, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1e3329",
  },
  rowMine: { backgroundColor: "rgba(200,169,107,0.08)" },
  rank: { width: 28, color: "#6b7c72" },
  dot: { width: 12, height: 12, borderRadius: 2 },
  alias: { flex: 1, color: "#e8efe9" },
  tribe: { width: 96, color: "#9bb0a3", fontSize: 12 },
  val: { color: "#c8a96b", fontWeight: "700", minWidth: 40, textAlign: "right" },
  youTag: { color: "#c8a96b", fontSize: 12, marginLeft: 4 },
  ends: { color: "#6b7c72", marginTop: 16, marginBottom: 8, fontSize: 12 },
  metricFoot: { color: "#6b7c72", marginTop: 12, fontSize: 12 },
});
