"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import LocaleToggle from "@/components/LocaleToggle";
import {
  fetchConsentStatus,
  withdrawConsent,
  type ConsentStatusResponse,
  type ConsentType,
} from "@/lib/consent-api";
import { requestAccountErasure } from "@/lib/erasure-api";
import {
  disableWebPush,
  enableWebPush,
  isPushEnabledLocally,
} from "@/lib/push-api";
import styles from "./SettingsSection.module.css";

const CONSENT_TYPES: ConsentType[] = [
  "aydinlatma_metni",
  "acik_riza_location",
  "terms_of_service",
];

export default function SettingsSection() {
  const t = useTranslations("profile.settings");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  const [consents, setConsents] = useState<ConsentStatusResponse | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [consentMessage, setConsentMessage] = useState<string | null>(null);
  const [withdrawBusy, setWithdrawBusy] = useState<string | null>(null);

  const [erasureBusy, setErasureBusy] = useState(false);
  const [erasureMessage, setErasureMessage] = useState<string | null>(null);
  const [erasureError, setErasureError] = useState<string | null>(null);

  const loadConsents = useCallback(async () => {
    const status = await fetchConsentStatus();
    setConsents(status);
  }, []);

  useEffect(() => {
    setPushEnabled(isPushEnabledLocally());
    loadConsents().catch(() => setConsentError(t("consentLoadFailed")));
  }, [loadConsents, t]);

  async function onTogglePush() {
    setPushBusy(true);
    setPushError(null);
    setPushMessage(null);
    try {
      if (pushEnabled) {
        await disableWebPush();
        setPushEnabled(false);
        setPushMessage(t("notificationsOff"));
      } else {
        await enableWebPush();
        setPushEnabled(true);
        setPushMessage(t("notificationsOn"));
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      setPushError(
        code === "notification_permission_denied"
          ? t("notificationsDenied")
          : t("notificationsFailed"),
      );
    } finally {
      setPushBusy(false);
    }
  }

  async function onWithdraw(type: ConsentType) {
    const entry = consents?.consents[type];
    if (!entry?.granted) return;
    const version = entry.consent_version ?? entry.published_version;
    if (!version) return;
    setWithdrawBusy(type);
    setConsentError(null);
    setConsentMessage(null);
    try {
      await withdrawConsent(type, version);
      setConsentMessage(t("consentWithdrawn"));
      await loadConsents();
    } catch {
      setConsentError(t("consentWithdrawFailed"));
    } finally {
      setWithdrawBusy(null);
    }
  }

  async function onErasure() {
    if (typeof window !== "undefined" && !window.confirm(t("erasureConfirm"))) {
      return;
    }
    setErasureBusy(true);
    setErasureError(null);
    setErasureMessage(null);
    try {
      const res = await requestAccountErasure();
      setErasureMessage(t("erasureSuccess", { status: res.status }));
    } catch {
      setErasureError(t("erasureFailed"));
    } finally {
      setErasureBusy(false);
    }
  }

  return (
    <section className={styles.section} data-testid="profile-settings">
      <h2 className={styles.title}>{t("title")}</h2>

      <div className={styles.block}>
        <p className={styles.blockTitle}>{t("locale")}</p>
        <LocaleToggle />
      </div>

      <div className={styles.block} data-testid="profile-notifications">
        <p className={styles.blockTitle}>{t("notifications")}</p>
        <div className={styles.row}>
          <p className={styles.status}>
            {pushEnabled ? t("notificationsOn") : t("notificationsOff")}
          </p>
          <button
            type="button"
            className={styles.btn}
            onClick={onTogglePush}
            disabled={pushBusy}
            data-testid="profile-notifications-toggle"
          >
            {pushEnabled
              ? t("notificationsDisable")
              : t("notificationsEnable")}
          </button>
        </div>
        {pushMessage ? <p className={styles.message}>{pushMessage}</p> : null}
        {pushError ? (
          <p className={styles.error} data-testid="profile-notifications-error">
            {pushError}
          </p>
        ) : null}
      </div>

      <div className={styles.block} data-testid="profile-consent">
        <p className={styles.blockTitle}>{t("consentTitle")}</p>
        {consentError ? <p className={styles.error}>{consentError}</p> : null}
        {consentMessage ? (
          <p className={styles.message} data-testid="profile-consent-success">
            {consentMessage}
          </p>
        ) : null}
        <ul className={styles.consentList}>
          {CONSENT_TYPES.map((type) => {
            const entry = consents?.consents[type];
            const granted = Boolean(entry?.granted);
            return (
              <li key={type} className={styles.consentItem}>
                <div className={styles.consentHead}>
                  <p className={styles.consentName}>
                    {t(`consentTypes.${type}`)}
                  </p>
                  <span className={styles.status}>
                    {granted ? t("consentGranted") : t("consentNotGranted")}
                  </span>
                </div>
                {granted ? (
                  <button
                    type="button"
                    className={styles.btn}
                    disabled={withdrawBusy === type}
                    onClick={() => onWithdraw(type)}
                    data-testid={`profile-consent-withdraw-${type}`}
                  >
                    {t("consentWithdraw")}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <div className={styles.block} data-testid="profile-erasure">
        <p className={styles.blockTitle}>{t("erasureTitle")}</p>
        <p className={styles.lead}>{t("erasureLead")}</p>
        <button
          type="button"
          className={styles.btnDanger}
          onClick={onErasure}
          disabled={erasureBusy}
          data-testid="profile-erasure-submit"
        >
          {t("erasureSubmit")}
        </button>
        {erasureMessage ? (
          <p className={styles.message} data-testid="profile-erasure-success">
            {erasureMessage}
          </p>
        ) : null}
        {erasureError ? (
          <p className={styles.error} data-testid="profile-erasure-error">
            {erasureError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
