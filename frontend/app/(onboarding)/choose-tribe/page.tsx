"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import DataResidencyBanner from "@/components/DataResidencyBanner";
import LocaleToggle from "@/components/LocaleToggle";
import {
  fetchConsentStatus,
  hasRequiredConsents,
} from "@/lib/consent-api";
import { getSessionToken } from "@/lib/session";
import { tribeAccentColor, tribeCrestInitial } from "@/lib/tribeCrest";
import {
  hasTribeMembership,
  joinTribe,
  listTribes,
  type Tribe,
} from "@/lib/tribes-api";
import styles from "./choose-tribe.module.css";

export default function ChooseTribePage() {
  const t = useTranslations("onboardingTribe");
  const tTribes = useTranslations("tribes");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [tribes, setTribes] = useState<Tribe[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  function mapError(code: string | undefined): string {
    switch (code) {
      case "already_in_tribe":
        return tTribes("errors.alreadyIn");
      case "tribe_not_found":
        return tTribes("errors.notFound");
      case "error_unauthorized":
        return tTribes("errors.unauthorized");
      default:
        return tTribes("errors.generic");
    }
  }

  const load = useCallback(async () => {
    if (!getSessionToken()) {
      router.replace("/register");
      return;
    }
    const status = await fetchConsentStatus();
    if (!hasRequiredConsents(status)) {
      router.replace("/consent");
      return;
    }
    const data = await listTribes();
    if (hasTribeMembership(data.membership)) {
      router.replace("/map");
      return;
    }
    setTribes(data.tribes.filter((row) => row.is_active));
  }, [router]);

  useEffect(() => {
    load()
      .catch(() => setError(tTribes("loadFailed")))
      .finally(() => setLoading(false));
  }, [load, tTribes]);

  const selected = useMemo(
    () => tribes.find((row) => row.id === selectedId) ?? null,
    [tribes, selectedId],
  );

  async function onConfirm() {
    if (!selected || busy) return;
    setError(null);
    setBusy(true);
    try {
      await joinTribe(selected.id);
      router.replace("/map");
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(mapError(code));
      try {
        await load();
      } catch {
        /* keep list */
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className={styles.page} aria-busy="true">
        <p className={styles.lead}>{tCommon("loading")}</p>
      </main>
    );
  }

  return (
    <>
      <DataResidencyBanner />
      <main className={styles.page} data-testid="choose-tribe-page">
        <header className={styles.header}>
          <LocaleToggle />
          <p className={styles.brand}>{tCommon("brand")}</p>
          <h1 className={styles.title}>{t("title")}</h1>
          <p className={styles.lead}>{t("lead")}</p>
        </header>

        {error ? <p className={styles.error}>{error}</p> : null}

        <ul className={styles.grid} data-testid="tribe-grid">
          {tribes.map((tribe) => {
            const accent = tribeAccentColor(tribe);
            const initial = tribeCrestInitial(tribe);
            const isSelected = selectedId === tribe.id;
            return (
              <li key={tribe.id}>
                <button
                  type="button"
                  className={
                    isSelected
                      ? `${styles.card} ${styles.cardSelected}`
                      : styles.card
                  }
                  style={{
                    ["--tribe-primary" as string]: tribe.primary_color,
                    ["--tribe-secondary" as string]: tribe.secondary_color,
                    ["--tribe-accent" as string]: accent,
                  }}
                  aria-pressed={isSelected}
                  data-testid={`tribe-card-${tribe.slug}`}
                  onClick={() => setSelectedId(tribe.id)}
                >
                  <span
                    className={styles.crest}
                    style={{
                      background: `linear-gradient(145deg, ${tribe.primary_color} 0%, ${tribe.secondary_color} 100%)`,
                    }}
                    aria-hidden
                  >
                    <span className={styles.crestMark}>{initial}</span>
                  </span>
                  <span className={styles.name}>{tribe.display_name}</span>
                  <span className={styles.short}>{tribe.short_name}</span>
                  {typeof tribe.member_count === "number" ? (
                    <span className={styles.members}>
                      {t("members", { count: tribe.member_count })}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        <footer className={styles.footer}>
          {selected ? (
            <div
              className={styles.preview}
              style={{
                ["--tribe-accent" as string]: tribeAccentColor(selected),
              }}
              data-testid="tribe-preview"
            >
              <span
                className={styles.previewCrest}
                style={{
                  background: `linear-gradient(145deg, ${selected.primary_color} 0%, ${selected.secondary_color} 100%)`,
                }}
                aria-hidden
              >
                {tribeCrestInitial(selected)}
              </span>
              <div className={styles.previewMeta}>
                <p className={styles.previewName}>{selected.display_name}</p>
                <p className={styles.previewHint}>{t("previewHint")}</p>
              </div>
            </div>
          ) : (
            <p className={styles.previewEmpty}>{t("pickHint")}</p>
          )}
          <button
            type="button"
            className={styles.confirm}
            disabled={!selected || busy}
            onClick={onConfirm}
            data-testid="tribe-confirm"
          >
            {busy ? tTribes("busy") : t("confirm")}
          </button>
        </footer>
      </main>
    </>
  );
}
