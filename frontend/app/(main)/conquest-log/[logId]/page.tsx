"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import TribeCrestDisc from "@/components/conquest/TribeCrestDisc";
import SupporterBadge from "@/components/conquest/SupporterBadge";
import { useCityData } from "@/context/CityDataContext";
import {
  findConquestLogEntry,
  type ConquestLogEntry,
} from "@/lib/conquest-api";
import { formatDateTime } from "@/lib/dateFormat";
import styles from "../conquest-log.module.css";

export default function ConquestLogDetailPage() {
  const t = useTranslations("conquest");
  const params = useParams<{ logId: string }>();
  const logId = typeof params.logId === "string" ? params.logId : "";
  const { tribesById } = useCityData();
  const [entry, setEntry] = useState<ConquestLogEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    findConquestLogEntry(logId)
      .then((found) => {
        if (cancelled) return;
        setEntry(found);
        if (!found) setError(t("notFound"));
      })
      .catch(() => {
        if (!cancelled) setError(t("loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [logId, t]);

  const prev = entry?.previous_tribe_id
    ? tribesById[entry.previous_tribe_id]
    : null;
  const next = entry ? tribesById[entry.new_tribe_id] : null;

  return (
    <main className={styles.page} data-testid="conquest-log-detail">
      <Link href="/conquest-log" className={styles.back}>
        {t("backToLog")}
      </Link>
      {loading ? <p className={styles.meta}>{t("loading")}</p> : null}
      {error ? (
        <p className={styles.meta} data-testid="conquest-log-detail-error">
          {error}
        </p>
      ) : null}
      {entry ? (
        <>
          <div className={styles.crests}>
            <TribeCrestDisc tribe={prev} size="md" fading />
            <span aria-hidden>→</span>
            <TribeCrestDisc tribe={next} size="md" />
          </div>
          <h1 className={styles.city}>{entry.city_name}</h1>
          <p className={styles.meta}>{formatDateTime(entry.occurred_at)}</p>
          {entry.was_derbi_bonus ? (
            <p className={styles.meta}>{t("derbiHint")}</p>
          ) : null}
          <SupporterBadge logId={entry.id} enabled />
          <Link
            href={`/map?il=${encodeURIComponent(entry.il_code)}`}
            className={styles.mapLink}
            data-testid="conquest-log-open-map"
          >
            {t("openOnMap")}
          </Link>
        </>
      ) : null}
    </main>
  );
}
