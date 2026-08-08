"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AuthApiError,
  clearPendingMerge,
  loadPendingMerge,
  requestOTP,
  resendOTP,
  socialMerge,
  toE164TR,
  verifyOTP,
  type PendingMerge,
} from "@/lib/auth-api";
import { setSession } from "@/lib/session";
import styles from "../register/register.module.css";

type Step = "phone" | "otp";

const COOLDOWN_SEC = 60;

export default function SocialMergePage() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingMerge | null>(null);
  const [step, setStep] = useState<Step>("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [e164, setE164] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);

  useEffect(() => {
    const p = loadPendingMerge();
    if (!p?.mergeToken) {
      router.replace("/register");
      return;
    }
    setPending(p);
  }, [router]);

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
    if (!e164 || !pending?.mergeToken) return;
    setError(null);
    setBusy(true);
    try {
      await verifyOTP(e164, code.trim());
      const res = await socialMerge(pending.mergeToken, e164);
      clearPendingMerge();
      setSession(res.user_id, res.session_token);
      router.replace("/consent");
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!pending) {
    return (
      <main className={styles.page}>
        <div className={styles.panel}>
          <p className={styles.lead}>Yönlendiriliyorsunuz…</p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <p className={styles.brand}>City Competition</p>
        <h1 className={styles.title}>Hesap birleştir</h1>
        <p className={styles.lead}>
          Bu sosyal hesap mevcut bir telefon hesabıyla eşleşiyor. Otomatik
          birleştirme yapılmaz — telefonunuza gelen kodla onaylayın.
          {pending.phoneHint ? ` İpucu: ${pending.phoneHint}` : null}
        </p>

        {error ? <p className={styles.error}>{error}</p> : null}

        {step === "phone" ? (
          <form onSubmit={onPhoneSubmit} className={styles.form}>
            <label className={styles.label} htmlFor="phone">
              Kayıtlı cep telefonu
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
              data-testid="merge-phone"
            />
            <button className={styles.button} type="submit" disabled={busy}>
              Kod gönder
            </button>
          </form>
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
              data-testid="merge-otp"
            />
            <button
              className={styles.button}
              type="submit"
              disabled={busy}
              data-testid="merge-confirm"
            >
              Birleştirmeyi onayla
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
        : "";
  switch (code) {
    case "error_invalid_phone_format":
      return "Geçersiz telefon numarası.";
    case "error_otp_cooldown":
      return "Lütfen biraz bekleyip tekrar deneyin.";
    case "error_invalid_otp":
      return "Kod hatalı veya süresi dolmuş.";
    case "error_phone_not_verified":
      return "Önce telefon doğrulaması gerekli.";
    case "error_invalid_merge_token":
      return "Birleştirme oturumu geçersiz veya süresi dolmuş. Sosyal girişi yeniden deneyin.";
    default:
      return "Bir hata oluştu. Tekrar deneyin.";
  }
}
