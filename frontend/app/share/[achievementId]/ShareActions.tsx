"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import styles from "./share.module.css";

type Props = {
  title: string;
  text: string;
  url: string;
  deepLink: string;
};

export default function ShareActions({ title, text, url, deepLink }: Props) {
  const t = useTranslations("share");
  const [copied, setCopied] = useState(false);

  async function onShare() {
    const absolute =
      url.startsWith("http") ? url : `${window.location.origin}${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: absolute });
        return;
      } catch {
        // fall through to copy
      }
    }
    await navigator.clipboard.writeText(absolute);
    setCopied(true);
  }

  async function onCopy() {
    const absolute =
      url.startsWith("http") ? url : `${window.location.origin}${url}`;
    await navigator.clipboard.writeText(absolute);
    setCopied(true);
  }

  return (
    <div className={styles.actions}>
      <button type="button" className={styles.primary} onClick={() => void onShare()}>
        {t("share")}
      </button>
      <button type="button" className={styles.secondary} onClick={() => void onCopy()}>
        {copied ? t("copied") : t("copyLink")}
      </button>
      <a className={styles.link} href={deepLink}>
        {t("openMap")}
      </a>
    </div>
  );
}
