"use client";

import { FormEvent, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import LocaleToggle from "@/components/LocaleToggle";
import OtpInput from "@/components/onboarding/OtpInput";
import {
  AuthApiError,
  formatTRNationalPhone,
  login,
  requestOTP,
  resendOTP,
  toE164TR,
  verifyOTP,
} from "@/lib/auth-api";
import { setSession } from "@/lib/session";
import styles from "../register/register.module.css";

type Step = "phone" | "otp" | "done";

const COOLDOWN_SEC = 60;

function isCooldownError(err: unknown): boolean {
  return err instanceof AuthApiError && err.code === "error_otp_cooldown";
}

export default function LoginPage() {
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [e164, setE164] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);

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
        : err instanceof Error
          ? err.message
          : "";
    switch (code) {
      case "error_invalid_phone_format":
        return t("errors.invalidPhoneFormat");
      case "error_otp_cooldown":
        return t("errors.otpCooldown");
      case "error_invalid_otp":
        return t("errors.invalidOtp");
      case "error_user_not_found":
        return t("errors.userNotFound");
      case "error_phone_not_verified":
        return t("errors.phoneNotVerified");
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
      const res = await requestOTP(phone);
      setE164(phone);
      setDevOtp(res.dev_otp ?? null);
      if (res.dev_otp) setCode(res.dev_otp);
      setStep("otp");
      setCooldownLeft(COOLDOWN_SEC);
    } catch (err) {
      if (isCooldownError(err)) setCooldownLeft(COOLDOWN_SEC);
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
      const res = await resendOTP(e164);
      setDevOtp(res.dev_otp ?? null);
      if (res.dev_otp) setCode(res.dev_otp);
      setCooldownLeft(COOLDOWN_SEC);
    } catch (err) {
      if (isCooldownError(err)) setCooldownLeft(COOLDOWN_SEC);
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
      const res = await login(e164);
      setSession(res.user_id, res.session_token, res.restricted_mode);
      setStep("done");
      router.replace("/map");
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <LocaleToggle />
        <p className={styles.brand}>{tCommon("brand")}</p>
        <h1 className={styles.title}>{t("loginTitle")}</h1>
        <p className={styles.lead}>{t("loginLead")}</p>
        <p className={styles.lead}>
          <Link href="/register" data-testid="goto-register">
            {t("needAccountRegister")}
          </Link>
        </p>

        {error ? <p className={styles.error}>{error}</p> : null}

        {step === "phone" ? (
          <form onSubmit={onPhoneSubmit} className={styles.form}>
            <label className={styles.label} htmlFor="login-phone">
              {t("phone")}
            </label>
            <div className={styles.phoneRow}>
              <span className={styles.phonePrefix} aria-hidden>
                +90
              </span>
              <input
                id="login-phone"
                className={styles.phoneInput}
                inputMode="tel"
                autoComplete="tel-national"
                placeholder={t("phonePlaceholder")}
                value={phoneInput}
                onChange={(e) =>
                  setPhoneInput(formatTRNationalPhone(e.target.value))
                }
                disabled={busy}
                data-testid="login-phone"
              />
            </div>
            <button className={styles.button} type="submit" disabled={busy}>
              {t("sendCode")}
            </button>
          </form>
        ) : null}

        {step === "otp" ? (
          <form onSubmit={onOTPSubmit} className={styles.form}>
            <label className={styles.label} htmlFor="login-otp">
              {t("otpLabel")}
            </label>
            <OtpInput
              id="login-otp"
              value={code}
              onChange={setCode}
              disabled={busy}
              aria-label={t("otpLabel")}
            />
            {devOtp ? (
              <p className={styles.cooldown} data-testid="dev-otp-hint">
                {t("devOtpHint", { code: devOtp })}
              </p>
            ) : null}
            <button
              className={styles.button}
              type="submit"
              disabled={busy || code.length !== 6}
              data-testid="login-verify"
            >
              {t("loginSubmit")}
            </button>
            <button
              className={styles.linkBtn}
              type="button"
              onClick={onResend}
              disabled={busy || cooldownLeft > 0}
            >
              {cooldownLeft > 0
                ? t("resendIn", { seconds: cooldownLeft })
                : t("resend")}
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
