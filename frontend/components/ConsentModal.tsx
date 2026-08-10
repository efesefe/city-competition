"use client";

import { FormEvent, useState } from "react";
import { useTranslations } from "next-intl";
import type { ConsentStatusResponse } from "@/lib/consent-api";
import { grantConsent } from "@/lib/consent-api";
import LocaleToggle from "@/components/LocaleToggle";
import styles from "./ConsentModal.module.css";

type Props = {
  status: ConsentStatusResponse;
  onGranted: () => void;
  onStatusRefresh: () => Promise<ConsentStatusResponse>;
};

export default function ConsentModal({
  status,
  onGranted,
  onStatusRefresh,
}: Props) {
  const t = useTranslations("consent");
  const tCommon = useTranslations("common");
  const disclosure = status.consents.aydinlatma_metni;
  const location = status.consents.acik_riza_location;

  const [acceptDisclosure, setAcceptDisclosure] = useState(false);
  const [acceptLocation, setAcceptLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [texts, setTexts] = useState({
    disclosure: disclosure?.body_text ?? "",
    location: location?.body_text ?? "",
    disclosureVersion: disclosure?.published_version ?? "",
    locationVersion: location?.published_version ?? "",
  });

  const canSubmit =
    acceptDisclosure &&
    acceptLocation &&
    Boolean(texts.disclosureVersion) &&
    Boolean(texts.locationVersion) &&
    !busy;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      await grantConsent("aydinlatma_metni", texts.disclosureVersion, true);
      await grantConsent("acik_riza_location", texts.locationVersion, true);
      onGranted();
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code)
          : "";
      if (code === "consent_version_outdated") {
        const fresh = await onStatusRefresh();
        setTexts({
          disclosure: fresh.consents.aydinlatma_metni?.body_text ?? "",
          location: fresh.consents.acik_riza_location?.body_text ?? "",
          disclosureVersion:
            fresh.consents.aydinlatma_metni?.published_version ?? "",
          locationVersion:
            fresh.consents.acik_riza_location?.published_version ?? "",
        });
        setAcceptDisclosure(false);
        setAcceptLocation(false);
        setError(t("versionUpdated"));
      } else {
        setError(t("saveFailed"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
      data-testid="consent-modal"
    >
      <div className={styles.panel}>
        <LocaleToggle />
        <p className={styles.brand}>{tCommon("brand")}</p>
        <h1 id="consent-title" className={styles.title}>
          {t("title")}
        </h1>
        <p className={styles.lead}>{t("lead")}</p>

        {error ? <p className={styles.error}>{error}</p> : null}

        <form onSubmit={onSubmit} className={styles.form}>
          <section className={styles.section} data-testid="consent-disclosure">
            <h2 className={styles.sectionTitle}>{t("disclosureTitle")}</h2>
            <div className={styles.body}>{texts.disclosure}</div>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={acceptDisclosure}
                onChange={(e) => setAcceptDisclosure(e.target.checked)}
                data-testid="check-aydinlatma"
              />
              <span>{t("disclosureCheck")}</span>
            </label>
          </section>

          <section className={styles.section} data-testid="consent-location">
            <h2 className={styles.sectionTitle}>{t("locationTitle")}</h2>
            <div className={styles.body}>{texts.location}</div>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={acceptLocation}
                onChange={(e) => setAcceptLocation(e.target.checked)}
                data-testid="check-location"
              />
              <span>{t("locationCheck")}</span>
            </label>
          </section>

          <button
            className={styles.button}
            type="submit"
            disabled={!canSubmit}
            data-testid="consent-submit"
          >
            {t("submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
