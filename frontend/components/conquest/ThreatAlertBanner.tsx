"use client";

import { useTranslations } from "next-intl";
import { shouldReduceMotion } from "@/lib/reduceMotion";
import type { InAppThreatAlert } from "@/lib/notifications/pushHandler";
import styles from "./ThreatAlertBanner.module.css";

type Props = {
  alert: InAppThreatAlert;
  accentColor: string;
  onDefend: () => void;
  onDismiss: () => void;
};

export default function ThreatAlertBanner({
  alert,
  accentColor,
  onDefend,
  onDismiss,
}: Props) {
  const t = useTranslations("conquest.threat");
  const urgent = alert.level >= 90;
  const reduceMotion = shouldReduceMotion();
  const title = urgent ? t("titleUrgent") : t("title");
  const body = urgent
    ? t("bodyUrgent", { city: alert.city_name, percent: alert.tension_percent })
    : t("body", { city: alert.city_name, percent: alert.tension_percent });

  return (
    <div className={styles.slot} aria-live="assertive">
      <div
        className={`${styles.banner}${urgent && !reduceMotion ? ` ${styles.urgent}` : ""}`}
        style={{ ["--threat-accent" as string]: accentColor }}
        data-testid="threat-alert-banner"
        data-il={alert.il_code}
        data-level={String(alert.level)}
        role="alert"
        aria-label={t("bannerAria", { city: alert.city_name })}
      >
        <div className={styles.copy}>
          <p className={styles.title}>{title}</p>
          <p className={styles.body}>{body}</p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.defend}
            onClick={onDefend}
            data-testid="threat-alert-defend"
          >
            {t("defend")}
          </button>
          <button
            type="button"
            className={styles.dismiss}
            onClick={onDismiss}
            aria-label={t("dismissAria")}
            data-testid="threat-alert-dismiss"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
