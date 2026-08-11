"use client";

import { FormEvent, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import LocaleToggle from "@/components/LocaleToggle";
import OtpInput from "@/components/onboarding/OtpInput";
import {
  AuthApiError,
  clearPendingMerge,
  formatTRNationalPhone,
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

function isCooldownError(err: unknown): boolean {
  return err instanceof AuthApiError && err.code === "error_otp_cooldown";
}

export default function SocialMergePage() {
  const t = useTranslations("auth");
  const tMerge = useTranslations("merge");
  const tCommon = useTranslations("common");
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

  function mapError(err: unknown): string {
    const code =
      err instanceof AuthApiError
        ? err.code
        : err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code)
          : "";
    switch (code) {
      case "error_invalid_phone_format":
        return t("errors.invalidPhoneFormat");
      case "error_otp_cooldown":
        return t("errors.otpCooldown");
      case "error_invalid_otp":
        return t("errors.invalidOtp");
      default:
        return t("errors.generic");
    }
  }

  async function onPhoneSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const phone = toE164TR(phoneInput);
    if (!phone) {
      setError(t("invalidPhone"));
      return;
    }
    setBusy(true);
    try {
      await requestOTP(phone);
      setE164(phone);
      setStep("otp");
      setCooldownLeft(COOLDOWN_SEC);
    } catch (err) {
      if (isCooldownError(err)) {
        setCooldownLeft(COOLDOWN_SEC);
      }
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
      if (isCooldownError(err)) {
        setCooldownLeft(COOLDOWN_SEC);
      }
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
      setSession(res.user_id, res.session_token, res.restricted_mode);
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
          <p className={styles.lead}>{tCommon("redirecting")}</p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <LocaleToggle />
        <p className={styles.brand}>{tCommon("brand")}</p>
        <h1 className={styles.title}>{tMerge("title")}</h1>
        <p className={styles.lead}>
          {tMerge("lead")}
          {pending.phoneHint ? (
            <>
              {" "}
              {tMerge("hint", { hint: pending.phoneHint })}
            </>
          ) : null}
        </p>

        {error ? <p className={styles.error}>{error}</p> : null}

        {step === "phone" ? (
          <form onSubmit={onPhoneSubmit} className={styles.form}>
            <label className={styles.label} htmlFor="phone">
              {tMerge("phoneLabel")}
            </label>
            <div className={styles.phoneRow}>
              <span className={styles.phonePrefix} aria-hidden>
                +90
              </span>
              <input
                id="phone"
                className={styles.phoneInput}
                inputMode="tel"
                autoComplete="tel-national"
                placeholder={t("phonePlaceholder")}
                value={phoneInput}
                onChange={(e) =>
                  setPhoneInput(formatTRNationalPhone(e.target.value))
                }
                disabled={busy}
                data-testid="merge-phone"
              />
            </div>
            <button className={styles.button} type="submit" disabled={busy}>
              {t("sendCode")}
            </button>
          </form>
        ) : null}

        {step === "otp" ? (
          <form onSubmit={onOTPSubmit} className={styles.form}>
            <label className={styles.label} htmlFor="otp">
              {t("otpLabel")}
            </label>
            <OtpInput
              id="otp"
              value={code}
              onChange={setCode}
              disabled={busy}
              aria-label={t("otpLabel")}
            />
            <button
              className={styles.button}
              type="submit"
              disabled={busy || code.length !== 6}
              data-testid="merge-confirm"
            >
              {tMerge("confirm")}
            </button>
            {cooldownLeft > 0 ? (
              <p
                className={styles.cooldown}
                data-testid="otp-cooldown"
                aria-live="polite"
              >
                {t("resendIn", { seconds: cooldownLeft })}
              </p>
            ) : null}
            <button
              className={styles.linkBtn}
              type="button"
              onClick={onResend}
              disabled={busy || cooldownLeft > 0}
              data-testid="otp-resend"
            >
              {t("resend")}
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
