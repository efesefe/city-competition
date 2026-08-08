"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AuthApiError,
  isUnder18,
  obtainSocialIdToken,
  register,
  requestOTP,
  resendOTP,
  socialLogin,
  storePendingMerge,
  toE164TR,
  verifyOTP,
  type SocialProvider,
} from "@/lib/auth-api";
import { setSession } from "@/lib/session";
import styles from "./register.module.css";

type Step = "phone" | "otp" | "profile" | "done";

const COOLDOWN_SEC = 60;

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [e164, setE164] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [socialPending, setSocialPending] = useState<{
    provider: SocialProvider;
    idToken: string;
  } | null>(null);

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const id = window.setInterval(() => {
      setCooldownLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldownLeft]);

  async function onPhoneSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const phone = toE164TR(phoneInput);
    if (!phone) {
      setError("Geçerli bir Türkiye cep numarası girin.");
      return;
    }
    setBusy(true);
    try {
      await requestOTP(phone);
      setE164(phone);
      setStep("otp");
      setCooldownLeft(COOLDOWN_SEC);
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    if (!e164 || cooldownLeft > 0) return;
    setError(null);
    setBusy(true);
    try {
      await resendOTP(e164);
      setCooldownLeft(COOLDOWN_SEC);
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onOTPSubmit(e: FormEvent) {
    e.preventDefault();
    if (!e164) return;
    setError(null);
    setBusy(true);
    try {
      await verifyOTP(e164, code.trim());
      setStep("profile");
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onProfileSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!birthDate) {
      setError("Doğum tarihinizi girin.");
      return;
    }
    setBusy(true);
    try {
      if (socialPending) {
        const res = await socialLogin({
          provider: socialPending.provider,
          idToken: socialPending.idToken,
          username: username.trim(),
          birthDate,
        });
        setSession(res.user_id, res.session_token);
        setUserId(res.user_id);
        setStep("done");
        router.replace("/consent");
        return;
      }
      if (!e164) return;
      const res = await register(e164, username.trim(), birthDate);
      setSession(res.user_id, res.session_token);
      setUserId(res.user_id);
      setStep("done");
      router.replace("/consent");
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSocial(provider: SocialProvider) {
    setError(null);
    setBusy(true);
    try {
      const idToken = await obtainSocialIdToken(provider);
      try {
        const res = await socialLogin({ provider, idToken });
        setSession(res.user_id, res.session_token);
        router.replace("/consent");
        return;
      } catch (err) {
        if (err instanceof AuthApiError && err.code === "error_merge_required") {
          storePendingMerge({
            mergeToken: err.mergeToken ?? "",
            phoneHint: err.phoneHint,
            provider,
          });
          router.push("/social-merge");
          return;
        }
        if (
          err instanceof AuthApiError &&
          err.code === "error_social_registration_incomplete"
        ) {
          setSocialPending({ provider, idToken });
          setStep("profile");
          return;
        }
        throw err;
      }
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  const underageNotice =
    birthDate && isUnder18(birthDate)
      ? "18 yaşından küçükseniz hesap açabilirsiniz; liderboard ve klan sohbeti kısıtlanır."
      : null;

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <p className={styles.brand}>City Competition</p>
        <h1 className={styles.title}>Kayıt ol</h1>
        <p className={styles.lead}>
          Telefon veya sosyal hesapla giriş. Doğum tarihi zorunludur.
        </p>

        {error ? <p className={styles.error}>{error}</p> : null}

        {step === "phone" ? (
          <>
            <form onSubmit={onPhoneSubmit} className={styles.form}>
              <label className={styles.label} htmlFor="phone">
                Cep telefonu
              </label>
              <input
                id="phone"
                className={styles.input}
                inputMode="tel"
                autoComplete="tel"
                placeholder="05xx xxx xx xx"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                disabled={busy}
              />
              <button className={styles.button} type="submit" disabled={busy}>
                Kod gönder
              </button>
            </form>
            <div className={styles.divider}>
              <span>veya</span>
            </div>
            <div className={styles.socialRow}>
              <button
                type="button"
                className={styles.socialBtn}
                disabled={busy}
                onClick={() => onSocial("google")}
                data-testid="social-google"
              >
                Google ile devam
              </button>
              <button
                type="button"
                className={styles.socialBtn}
                disabled={busy}
                onClick={() => onSocial("apple")}
                data-testid="social-apple"
              >
                Apple ile devam
              </button>
            </div>
          </>
        ) : null}

        {step === "otp" ? (
          <form onSubmit={onOTPSubmit} className={styles.form}>
            <label className={styles.label} htmlFor="code">
              Doğrulama kodu
            </label>
            <input
              id="code"
              className={styles.input}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6 haneli kod"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
            />
            <button className={styles.button} type="submit" disabled={busy}>
              Doğrula
            </button>
            <button
              className={styles.linkBtn}
              type="button"
              onClick={onResend}
              disabled={busy || cooldownLeft > 0}
            >
              {cooldownLeft > 0
                ? `Tekrar gönder (${cooldownLeft}s)`
                : "Tekrar gönder"}
            </button>
          </form>
        ) : null}

        {step === "profile" ? (
          <form onSubmit={onProfileSubmit} className={styles.form}>
            <label className={styles.label} htmlFor="username">
              Kullanıcı adı
            </label>
            <input
              id="username"
              className={styles.input}
              autoComplete="username"
              placeholder="Oyuncu_01"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
            />
            <label className={styles.label} htmlFor="birth_date">
              Doğum tarihi
            </label>
            <input
              id="birth_date"
              className={styles.input}
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              disabled={busy}
              required
            />
            {underageNotice ? (
              <p className={styles.notice} data-testid="underage-notice">
                {underageNotice}
              </p>
            ) : null}
            <button className={styles.button} type="submit" disabled={busy}>
              Hesabı oluştur
            </button>
          </form>
        ) : null}

        {step === "done" ? (
          <div className={styles.done}>
            <p>Hoş geldin. Hesabın hazır. Onay adımına yönlendiriliyorsun…</p>
            {userId ? <p className={styles.meta}>ID: {userId}</p> : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function mapError(err: unknown): string {
  const code =
    err instanceof AuthApiError
      ? err.code
      : err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : err instanceof Error
          ? err.message
          : "";
  switch (code) {
    case "error_invalid_phone_format":
      return "Geçersiz telefon numarası.";
    case "error_otp_cooldown":
      return "Lütfen biraz bekleyip tekrar deneyin.";
    case "error_invalid_otp":
      return "Kod hatalı veya süresi dolmuş.";
    case "error_invalid_username":
      return "Kullanıcı adı geçersiz (3–24 karakter, harf/rakam/_).";
    case "error_invalid_birth_date":
      return "Geçerli bir doğum tarihi girin.";
    case "error_user_conflict":
      return "Bu telefon veya kullanıcı adı zaten kayıtlı.";
    case "error_phone_not_verified":
      return "Önce telefon doğrulaması gerekli.";
    case "error_invalid_social_token":
      return "Sosyal giriş doğrulanamadı.";
    case "Google giriş yapılandırılmadı.":
    case "Apple giriş yapılandırılmadı.":
      return code;
    default:
      return "Bir hata oluştu. Tekrar deneyin.";
  }
}
