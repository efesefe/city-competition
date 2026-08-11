"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import DataResidencyBanner from "@/components/DataResidencyBanner";
import LocaleToggle from "@/components/LocaleToggle";
import { formatDateTime } from "@/lib/dateFormat";
import { getSessionToken } from "@/lib/session";
import {
  hasTribeMembership,
  joinTribe,
  listTribes,
  switchTribe,
  Tribe,
  TribeMembership,
} from "@/lib/tribes-api";
import styles from "./tribes.module.css";

export default function TribesPage() {
  const t = useTranslations("tribes");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [tribes, setTribes] = useState<Tribe[]>([]);
  const [membership, setMembership] = useState<TribeMembership | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function mapError(code: string | undefined): string {
    switch (code) {
      case "tribe_switch_cooldown":
        return t("errors.cooldown");
      case "already_in_tribe":
        return t("errors.alreadyIn");
      case "tribe_not_found":
        return t("errors.notFound");
      case "error_unauthorized":
        return t("errors.unauthorized");
      default:
        return t("errors.generic");
    }
  }

  function formatSwitchHint(m: TribeMembership): string | null {
    if (!m.switch_available_at) return null;
    const at = new Date(m.switch_available_at);
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return null;
    return t("nextSwitch", { when: formatDateTime(at) });
  }

  const load = useCallback(async () => {
    const data = await listTribes();
    setTribes(data.tribes);
    setMembership(data.membership);
    return data;
  }, []);

  useEffect(() => {
    if (!getSessionToken()) {
      router.replace("/register");
      return;
    }
    load()
      .then((data) => {
        if (!hasTribeMembership(data.membership)) {
          router.replace("/choose-tribe");
        }
      })
      .catch(() => setError(t("loadFailed")))
      .finally(() => setLoading(false));
  }, [load, router, t]);

  const onSelect = async (tribe: Tribe) => {
    setError(null);
    setBusyId(tribe.id);
    try {
      if (!hasTribeMembership(membership)) {
        await joinTribe(tribe.id);
        router.replace("/map");
        return;
      }
      if (membership?.tribe_id === tribe.id) {
        router.replace("/map");
        return;
      }
      await switchTribe(tribe.id);
      router.replace("/map");
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(mapError(code));
      try {
        await load();
      } catch {
        /* keep prior list */
      }
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <main className={styles.page} aria-busy="true">
        <p className={styles.lead}>{tCommon("loading")}</p>
      </main>
    );
  }

  const switchHint = membership ? formatSwitchHint(membership) : null;
  const hasMembership = hasTribeMembership(membership);

  return (
    <>
      <DataResidencyBanner />
      <main className={styles.page}>
        <header className={styles.header}>
          <LocaleToggle />
          <p className={styles.brand}>{tCommon("brand")}</p>
          <h1 className={styles.title}>
            {hasMembership ? t("titleSwitch") : t("titleSelect")}
          </h1>
          <p className={styles.lead}>{t("lead")}</p>
        </header>

        {error ? <p className={styles.error}>{error}</p> : null}
        {switchHint ? <p className={styles.notice}>{switchHint}</p> : null}

        <ul className={styles.list}>
          {tribes.map((tribeItem) => {
            const isCurrent = membership?.tribe_id === tribeItem.id;
            return (
              <li key={tribeItem.id} className={styles.item}>
                <div
                  className={styles.swatch}
                  style={{
                    background: `linear-gradient(135deg, ${tribeItem.primary_color} 50%, ${tribeItem.secondary_color} 50%)`,
                  }}
                  aria-hidden
                />
                <div className={styles.meta}>
                  <p className={styles.name}>{tribeItem.display_name}</p>
                  <p className={styles.sub}>
                    {tribeItem.short_name}
                    {typeof tribeItem.member_count === "number"
                      ? t("memberCount", { count: tribeItem.member_count })
                      : null}
                  </p>
                </div>
                {isCurrent ? (
                  <span className={styles.current}>{t("yourTribe")}</span>
                ) : (
                  <button
                    type="button"
                    className={
                      hasMembership
                        ? `${styles.button} ${styles.buttonSecondary}`
                        : styles.button
                    }
                    disabled={busyId !== null}
                    onClick={() => onSelect(tribeItem)}
                  >
                    {busyId === tribeItem.id
                      ? t("busy")
                      : hasMembership
                        ? t("switch")
                        : t("join")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}
