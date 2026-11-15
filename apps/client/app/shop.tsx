import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

export default function ShopScreen() {
  const { token, user, updateUser } = useSession();
  const [packs, setPacks] = useState<{ sku: string; energy: number; tryPlaceholder: number }[]>([]);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void api.meta().then((m) => setPacks((m.shop as { packs: typeof packs }).packs));
  }, []);

  const simGrant = async () => {
    if (!token) {
      setNote("Giriş gerekli");
      return;
    }
    const res = await api.grantSim(token);
    updateUser(res.user);
    setNote(`Simüle günlük grant: +${res.amount} (00:00 TR yerine)`);
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Dükkan</Text>
      <Text style={styles.sub}>
        iyzico / IAP bu dilimde stub. Enerji paketleri gösterim amaçlı.
      </Text>
      {packs.map((p) => (
        <View key={p.sku} style={styles.card}>
          <Text style={styles.pack}>{p.sku.toUpperCase()} — {p.energy} enerji</Text>
          <Text style={styles.price}>₺{p.tryPlaceholder} (placeholder)</Text>
          <Pressable style={styles.disabled} disabled>
            <Text style={styles.disabledText}>Satın al (yakında)</Text>
          </Pressable>
        </View>
      ))}
      <Pressable style={styles.cta} onPress={simGrant}>
        <Text style={styles.ctaText}>Günlük 100 enerjiyi simüle et</Text>
      </Pressable>
      {user ? <Text style={styles.meta}>Enerji: {user.energy.total}</Text> : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 10, backgroundColor: "#0b1f17" },
  title: { fontFamily: "Georgia", fontSize: 24, color: "#f4e7c5", fontWeight: "700" },
  sub: { color: "#9bb0a3" },
  card: {
    backgroundColor: "#13261d",
    padding: 14,
    borderRadius: 10,
    gap: 4,
  },
  pack: { color: "#f4e7c5", fontWeight: "600" },
  price: { color: "#c8a96b" },
  disabled: {
    marginTop: 6,
    opacity: 0.5,
    borderWidth: 1,
    borderColor: "#3d5a4c",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  disabledText: { color: "#9bb0a3" },
  cta: {
    backgroundColor: "#c8a96b",
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 8,
  },
  ctaText: { color: "#0b1f17", fontWeight: "700" },
  meta: { color: "#9bb0a3" },
  note: { color: "#8fd4a0" },
});
