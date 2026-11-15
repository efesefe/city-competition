import React, { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";

export default function ScoreboardScreen() {
  const [teams, setTeams] = useState<
    { teamId: string; alias: string; color: string; citiesOwned: number }[]
  >([]);

  useEffect(() => {
    void api.scoreboard().then((r) => setTeams(r.teams));
  }, []);

  return (
    <View style={styles.root}>
      <Text style={styles.sub}>Misafirler skor tablosunu serbestçe gezebilir.</Text>
      <FlatList
        data={teams}
        keyExtractor={(t) => t.teamId}
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            <Text style={styles.rank}>{index + 1}</Text>
            <View style={[styles.dot, { backgroundColor: item.color }]} />
            <Text style={styles.alias}>{item.alias}</Text>
            <Text style={styles.val}>{item.citiesOwned}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, backgroundColor: "#0b1f17" },
  sub: { color: "#9bb0a3", marginBottom: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1e3329",
  },
  rank: { width: 28, color: "#6b7c72" },
  dot: { width: 12, height: 12, borderRadius: 2 },
  alias: { flex: 1, color: "#e8efe9" },
  val: { color: "#c8a96b", fontWeight: "700" },
});
