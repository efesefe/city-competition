"use client";

import { FormEvent, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import LocaleToggle from "@/components/LocaleToggle";
import OtpInput from "@/components/onboarding/OtpInput";
import {
  AuthApiError,
  formatTRNationalPhone,
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

function isCooldownError(err: unknown): boolean {
  return (
    err instanceof AuthApiError && err.code === "error_otp_cooldown"
  );
}

export default function RegisterPage() {
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
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
        return t("errors.invalidPhoneFormat");
      case "error_otp_cooldown":
        return t("errors.otpCooldown");
      case "error_invalid_otp":
        return t("errors.invalidOtp");
      case "error_invalid_username":
        return t("errors.invalidUsername");
      case "error_invalid_birth_date":
        return t("errors.invalidBirthDate");
      case "error_user_conflict":
        return t("errors.userConflict");
      case "error_phone_not_verified":
        return t("errors.phoneNotVerified");
      case "error_invalid_social_token":
        return t("errors.invalidSocialToken");
      case "Google giriş yapılandırılmadı.":
      case "Apple giriş yapılandırılmadı.":
        return code;
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
      setError(t("birthDateRequired"));
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
        setSession(res.user_id, res.session_token, res.restricted_mode);
        setUserId(res.user_id);
        setStep("done");
        router.replace("/consent");
        return;
      }
      if (!e164) return;
      const res = await register(e164, username.trim(), birthDate);
      setSession(res.user_id, res.session_token, res.restricted_mode);
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
        setSession(res.user_id, res.session_token, res.restricted_mode);
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
    birthDate && isUnder18(birthDate) ? t("underageNotice") : null;

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <LocaleToggle />
        <p className={styles.brand}>{tCommon("brand")}</p>
        <h1 className={styles.title}>{t("registerTitle")}</h1>
        <p className={styles.lead}>{t("registerLead")}</p>

        {error ? <p className={styles.error}>{error}</p> : null}

        {step === "phone" ? (
          <>
            <form onSubmit={onPhoneSubmit} className={styles.form}>
              <label className={styles.label} htmlFor="phone">
                {t("phone")}
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
                  data-testid="register-phone"
                />
              </div>
              <button className={styles.button} type="submit" disabled={busy}>
                {t("sendCode")}
              </button>
            </form>
            <div className={styles.divider}>
              <span>{t("or")}</span>
            </div>
            <div className={styles.socialRow}>
              <button
                type="button"
                className={styles.socialBtn}
                disabled={busy}
                onClick={() => onSocial("google")}
                data-testid="social-google"
              >
                {t("continueGoogle")}
              </button>
              <button
                type="button"
                className={styles.socialBtn}
                disabled={busy}
                onClick={() => onSocial("apple")}
                data-testid="social-apple"
              >
                {t("continueApple")}
              </button>
            </div>
          </>
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
            >
              {t("verify")}
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

        {step === "profile" ? (
          <form onSubmit={onProfileSubmit} className={styles.form}>
            <label className={styles.label} htmlFor="username">
              {t("username")}
            </label>
            <input
              id="username"
              className={styles.input}
              autoComplete="username"
              placeholder={t("usernamePlaceholder")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
            />
            <label className={styles.label} htmlFor="birth_date">
              {t("birthDate")}
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
              {t("createAccount")}
            </button>
          </form>
        ) : null}

        {step === "done" ? (
          <div className={styles.done}>
            <p>{t("welcome")}</p>
            {userId ? (
              <p className={styles.meta}>{t("userId", { id: userId })}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
