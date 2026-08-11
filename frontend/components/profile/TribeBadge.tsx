"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCityData } from "@/context/CityDataContext";
import { useWallet } from "@/context/WalletContext";
import { formatDateTime } from "@/lib/dateFormat";
import {
  listTribes,
  type Tribe,
  type TribeMembership,
} from "@/lib/tribes-api";
import { tribeAccentColor, tribeCrestInitial } from "@/lib/tribeCrest";
import styles from "./TribeBadge.module.css";

export default function TribeBadge() {
  const t = useTranslations("profile.tribe");
  const router = useRouter();
  const { tribe } = useWallet();
  const { cities } = useCityData();
  const [membership, setMembership] = useState<TribeMembership | null>(null);
  const [tribeDetail, setTribeDetail] = useState<Tribe | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const load = useCallback(async () => {
    const data = await listTribes();
    setMembership(data.membership);
    const id = data.membership.tribe_id;
    const match = id
      ? (data.tribes.find((row) => row.id === id) ?? null)
      : null;
    setTribeDetail(match);
  }, []);

  useEffect(() => {
    load().catch(() => {
      /* keep wallet tribe fallback */
    });
  }, [load]);

  const activeTribe = tribeDetail ?? tribe;
  const accent = tribeAccentColor(activeTribe);
  const initial = activeTribe ? tribeCrestInitial(activeTribe) : "?";
  const name = activeTribe?.display_name ?? t("noTribe");

  const owned = activeTribe
    ? cities.filter((c) => c.controlling_tribe?.tribe_id === activeTribe.id)
    : [];

  const switchAvailableAt = membership?.switch_available_at
    ? new Date(membership.switch_available_at)
    : null;
  const onCooldown =
    switchAvailableAt !== null &&
    !Number.isNaN(switchAvailableAt.getTime()) &&
    switchAvailableAt.getTime() > Date.now();

  return (
    <section
      className={styles.badge}
      style={{ ["--tribe-accent" as string]: accent }}
      data-testid="profile-tribe-badge"
    >
      <button
        type="button"
        className={styles.hero}
        onClick={() => setDetailsOpen(true)}
        aria-label={t("detailsAria", { tribe: name })}
        data-testid="profile-tribe-details-open"
      >
        <span
          className={styles.crest}
          style={{ background: accent }}
          aria-hidden
        >
          {initial}
        </span>
        <div className={styles.meta}>
          <h2 className={styles.name}>{name}</h2>
          <p className={styles.hint}>
            {t("members", {
              count: activeTribe?.member_count ?? 0,
            })}
          </p>
        </div>
      </button>

      <div className={styles.switchRow}>
        <button
          type="button"
          className={styles.switchBtn}
          disabled={onCooldown}
          onClick={() => router.push("/tribes")}
          data-testid="profile-switch-tribe"
        >
          {t("switch")}
        </button>
        {onCooldown && switchAvailableAt ? (
          <p className={styles.cooldown} data-testid="profile-switch-cooldown">
            {t("switchCooldown", {
              when: formatDateTime(switchAvailableAt),
            })}
          </p>
        ) : null}
      </div>

      {detailsOpen ? (
        <div
          className={styles.overlay}
          role="presentation"
          onClick={() => setDetailsOpen(false)}
        >
          <div
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label={t("detailsAria", { tribe: name })}
            data-testid="profile-tribe-details"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.sheetHeader}>
              <h3 className={styles.sheetTitle}>{name}</h3>
              <button
                type="button"
                className={styles.close}
                aria-label={t("closeDetails")}
                onClick={() => setDetailsOpen(false)}
              >
                ×
              </button>
            </div>
            <p className={styles.stat}>
              {t("members", { count: activeTribe?.member_count ?? 0 })}
            </p>
            <p className={styles.stat} data-testid="profile-territory-summary">
              {owned.length > 0
                ? t("territory", { count: owned.length })
                : t("territoryEmpty")}
            </p>
            {owned.length > 0 ? (
              <>
                <p className={styles.territoryTitle}>{t("territoryList")}</p>
                <ul className={styles.territoryList}>
                  {owned.map((city) => (
                    <li key={city.id} className={styles.territoryChip}>
                      {city.name}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
