"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  dismissPushPrompt,
  isPushPromptDismissed,
} from "@/lib/mapSeen";
import {
  enableWebPush,
  isPushEnabledLocally,
} from "@/lib/push-api";
import styles from "./PushPermissionPrompt.module.css";

type Props = {
  onDismissed?: () => void;
};

function shouldOfferPrompt(): boolean {
  if (typeof window === "undefined") return false;
  if (isPushPromptDismissed()) return false;
  if (isPushEnabledLocally()) return false;
  if (!("Notification" in window)) return false;
  if (Notification.permission !== "default") return false;
  return true;
}

export default function PushPermissionPrompt({ onDismissed }: Props) {
  const t = useTranslations("pushPrompt");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setVisible(shouldOfferPrompt());
  }, []);

  if (!visible) return null;

  const close = () => {
    dismissPushPrompt();
    setVisible(false);
    onDismissed?.();
  };

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await enableWebPush();
      dismissPushPrompt();
      setVisible(false);
      onDismissed?.();
    } catch {
      setError(t("enableFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.overlay} data-testid="push-permission-prompt">
      <div className={styles.card} role="dialog" aria-modal="true" aria-labelledby="push-prompt-copy">
        <p id="push-prompt-copy" className={styles.copy}>
          {t("copy")}
        </p>
        {error ? (
          <p className={styles.error} data-testid="push-permission-error">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={close}
            disabled={busy}
            data-testid="push-permission-later"
          >
            {t("later")}
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void enable()}
            disabled={busy}
            data-testid="push-permission-enable"
          >
            {busy ? t("enabling") : t("enable")}
          </button>
        </div>
      </div>
    </div>
  );
}
