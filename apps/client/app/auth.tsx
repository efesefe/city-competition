import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api, type AuthMeta } from "../lib/api";
import { useSession } from "../lib/session";
import { getSupabase, isSupabaseClientConfigured, normalizeTrPhoneClient } from "../lib/supabase";

WebBrowser.maybeCompleteAuthSession();

export default function AuthScreen() {
  const router = useRouter();
  const { setSession, user, token } = useSession();
  const [phone, setPhone] = useState("5551234567");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authMeta, setAuthMeta] = useState<AuthMeta | null>(null);
  const [busy, setBusy] = useState(false);

  const liveClient = isSupabaseClientConfigured();
  const liveApi = authMeta?.mode === "supabase";
  const useSupabase = liveClient && liveApi;

  useEffect(() => {
    void api.meta().then((m) => setAuthMeta(m.auth));
  }, []);

  useEffect(() => {
    if (user?.phoneVerified && user.tribeId) router.replace("/");
    else if (user?.phoneVerified && !user.tribeId) router.replace("/pick-tribe");
  }, [user, router]);

  const afterLogin = async (
    accessToken: string,
    opts?: { refreshToken?: string | null },
  ) => {
    const sb = getSupabase();
    if (sb && opts?.refreshToken) {
      await sb.auth.setSession({
        access_token: accessToken,
        refresh_token: opts.refreshToken,
      });
    }
    const res = await api.exchangeSupabaseSession(accessToken);
    await setSession(res.token, res.user);
    if (!res.user.phoneVerified) {
      setHint("Telefon doğrula (zorunlu) — Google/Apple sonrası.");
      setSent(false);
      return;
    }
    router.replace(res.user.tribeId ? "/" : "/pick-tribe");
  };

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const e164 = normalizeTrPhoneClient(phone);
      if (!e164) throw new Error("invalid_tr_phone");

      if (useSupabase) {
        const sb = getSupabase()!;
        if (token && user && !user.phoneVerified) {
          const { error: sbErr } = await sb.auth.updateUser({ phone: e164 });
          if (sbErr) throw sbErr;
          setSent(true);
          setHint(`Telefon bağlama OTP: ${e164}`);
          return;
        }
        const { error: sbErr } = await sb.auth.signInWithOtp({ phone: e164 });
        if (sbErr) throw sbErr;
        setSent(true);
        setHint(`Supabase OTP gönderildi: ${e164} (SMS = hook / dry-run)`);
        return;
      }

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
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      const e164 = normalizeTrPhoneClient(phone);
      if (!e164) throw new Error("invalid_tr_phone");

      if (useSupabase) {
        const sb = getSupabase()!;
        const otpType = token && user && !user.phoneVerified ? "phone_change" : "sms";
        const { data, error: sbErr } = await sb.auth.verifyOtp({
          phone: e164,
          token: code,
          type: otpType,
        });
        if (sbErr) throw sbErr;
        const access = data.session?.access_token;
        if (!access) throw new Error("no_supabase_session");
        await afterLogin(access, { refreshToken: data.session?.refresh_token });
        return;
      }

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
    } finally {
      setBusy(false);
    }
  };

  const oauth = async (provider: "google" | "apple") => {
    setError(null);
    setBusy(true);
    try {
      if (useSupabase) {
        const sb = getSupabase()!;
        const redirectTo = Linking.createURL("auth/callback");
        if (Platform.OS === "web") {
          const { error: sbErr } = await sb.auth.signInWithOAuth({
            provider,
            options: { redirectTo, skipBrowserRedirect: false },
          });
          if (sbErr) throw sbErr;
          return;
        }
        const { data, error: sbErr } = await sb.auth.signInWithOAuth({
          provider,
          options: { redirectTo, skipBrowserRedirect: true },
        });
        if (sbErr) throw sbErr;
        if (!data.url) throw new Error("oauth_url_missing");
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type !== "success" || !("url" in result) || !result.url) {
          throw new Error("oauth_cancelled");
        }
        const url = new URL(result.url);
        const params = new URLSearchParams(url.hash.replace(/^#/, "") || url.search.replace(/^\?/, ""));
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        if (accessToken) {
          await afterLogin(accessToken, { refreshToken });
          return;
        }
        // PKCE / code exchange — let supabase pick up session from storage / getSession
        const { data: sess } = await sb.auth.getSession();
        if (!sess.session?.access_token) throw new Error("oauth_no_session");
        await afterLogin(sess.session.access_token, {
          refreshToken: sess.session.refresh_token,
        });
        return;
      }

      const res = await api.oauthStub(provider);
      await setSession(res.token, res.user);
      setHint("OAuth stub (mock) — telefon doğrula (zorunlu).");
      setSent(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "oauth_failed");
    } finally {
      setBusy(false);
    }
  };

  // Web OAuth return: detect hash session and exchange
  useEffect(() => {
    if (!useSupabase || Platform.OS !== "web") return;
    const sb = getSupabase();
    if (!sb) return;
    void sb.auth.getSession().then(async ({ data }) => {
      if (!data.session?.access_token) return;
      if (user?.phoneVerified) return;
      try {
        await afterLogin(data.session.access_token, {
          refreshToken: data.session.refresh_token,
        });
      } catch {
        // ignore — user may still be on chooser
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useSupabase]);

  const googleLabel = useSupabase ? "Google" : "Google (stub)";
  const appleLabel = useSupabase ? "Apple" : "Apple (stub)";

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
        <Pressable style={[styles.cta, busy && styles.disabled]} onPress={start} disabled={busy}>
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
          <Pressable style={[styles.cta, busy && styles.disabled]} onPress={verify} disabled={busy}>
            <Text style={styles.ctaText}>Doğrula</Text>
          </Pressable>
        </>
      )}

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {authMeta?.mockOtpCode && !hint ? (
        <Text style={styles.hint}>Dev mock OTP: {authMeta.mockOtpCode}</Text>
      ) : null}

      <Text style={styles.or}>— veya —</Text>
      <Pressable
        style={[styles.oauth, busy && styles.disabled]}
        onPress={() => oauth("google")}
        disabled={busy || (authMeta != null && !authMeta.googleEnabled && useSupabase)}
      >
        <Text style={styles.oauthText}>{googleLabel}</Text>
      </Pressable>
      <Pressable
        style={[styles.oauth, busy && styles.disabled]}
        onPress={() => oauth("apple")}
        disabled={busy || (authMeta != null && !authMeta.appleEnabled && useSupabase)}
      >
        <Text style={styles.oauthText}>{appleLabel}</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.foot}>
        {useSupabase
          ? "Supabase Auth: phone OTP + Google + Apple. SMS hook seam ready (Netgsm = CC-20)."
          : "Local mock: phone OTP + OAuth stub. Set EXPO_PUBLIC_SUPABASE_* + API SUPABASE_* for live Auth."}
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
  disabled: { opacity: 0.55 },
});
