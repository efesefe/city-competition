import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

export default function AuthScreen() {
  const router = useRouter();
  const { setSession, user, token } = useSession();
  const [phone, setPhone] = useState("5551234567");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mockCode, setMockCode] = useState<string | null>(null);

  useEffect(() => {
    void api.meta().then((m) => setMockCode(m.auth.mockOtpCode));
  }, []);

  useEffect(() => {
    if (user?.phoneVerified && user.tribeId) router.replace("/");
    else if (user?.phoneVerified && !user.tribeId) router.replace("/pick-tribe");
  }, [user, router]);

  const start = async () => {
    setError(null);
    try {
      const res = await api.startPhone(phone);
      setSent(true);
      setHint(
        res.mock && res.code
          ? `Mock OTP (dev): ${res.code}`
          : `Kod gönderildi: ${res.phoneE164}`,
      );
      if (res.code) setCode(res.code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "start_failed");
    }
  };

  const verify = async () => {
    setError(null);
    try {
      if (token && user && !user.phoneVerified) {
        const res = await api.bindPhone(token, phone, code);
        await setSession(token, res.user);
        router.replace("/pick-tribe");
        return;
      }
      const res = await api.verifyPhone(phone, code);
      await setSession(res.token, res.user);
      router.replace(res.user.tribeId ? "/" : "/pick-tribe");
    } catch (e) {
      setError(e instanceof Error ? e.message : "verify_failed");
    }
  };

  const oauth = async (provider: "google" | "apple") => {
    setError(null);
    try {
      const res = await api.oauthStub(provider);
      await setSession(res.token, res.user);
      setHint("OAuth stub — telefon doğrula (zorunlu).");
      setSent(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "oauth_failed");
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Oynamaya devam et</Text>
      <Text style={styles.sub}>Tek hesap, cihazlar arası. İlerleme bu hesaba bağlı.</Text>

      <Text style={styles.label}>Telefon (+90)</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="5xx xxx xx xx"
        placeholderTextColor="#6b7c72"
      />
      {!sent ? (
        <Pressable style={styles.cta} onPress={start}>
          <Text style={styles.ctaText}>Kod gönder</Text>
        </Pressable>
      ) : (
        <>
          <Text style={styles.label}>Kod</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            placeholder="6 haneli"
            placeholderTextColor="#6b7c72"
          />
          <Pressable style={styles.cta} onPress={verify}>
            <Text style={styles.ctaText}>Doğrula</Text>
          </Pressable>
        </>
      )}

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {mockCode && !hint ? <Text style={styles.hint}>Dev mock OTP: {mockCode}</Text> : null}

      <Text style={styles.or}>— veya —</Text>
      <Pressable style={styles.oauth} onPress={() => oauth("google")}>
        <Text style={styles.oauthText}>Google (stub)</Text>
      </Pressable>
      <Pressable style={styles.oauth} onPress={() => oauth("apple")}>
        <Text style={styles.oauthText}>Apple (stub)</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.foot}>
        Supabase Auth şekli: phone OTP + session. Netgsm yoksa mock SMS.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, gap: 10, backgroundColor: "#0b1f17" },
  title: { fontFamily: "Georgia", fontSize: 26, color: "#f4e7c5", fontWeight: "700" },
  sub: { color: "#9bb0a3", marginBottom: 8 },
  label: { color: "#c8a96b", marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#2f4a3c",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: "#f4e7c5",
    backgroundColor: "#0f1c16",
  },
  cta: {
    backgroundColor: "#c8a96b",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 4,
  },
  ctaText: { color: "#0b1f17", fontWeight: "700" },
  oauth: {
    borderWidth: 1,
    borderColor: "#3d5a4c",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  oauthText: { color: "#d8c9a3" },
  or: { textAlign: "center", color: "#6b7c72", marginVertical: 8 },
  hint: { color: "#8fd4a0" },
  error: { color: "#e07070" },
  foot: { color: "#6b7c72", fontSize: 12, marginTop: 12 },
});
