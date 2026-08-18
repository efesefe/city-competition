"use client";

import { useTranslations } from "next-intl";
import styles from "./LeaderboardTabs.module.css";

export type LeaderboardTabId = "global" | "tribes" | "tribeRank" | "derbi";

type Props = {
  active: LeaderboardTabId;
  showDerbi: boolean;
  onChange: (tab: LeaderboardTabId) => void;
};

export default function LeaderboardTabs({
  active,
  showDerbi,
  onChange,
}: Props) {
  const t = useTranslations("leaderboard");

  const tabs: Array<{ id: LeaderboardTabId; label: string; testId: string }> = [
    { id: "global", label: t("tabGlobal"), testId: "leaderboard-tab-global" },
    { id: "tribes", label: t("tabTribes"), testId: "leaderboard-tab-tribes" },
    {
      id: "tribeRank",
      label: t("tabTribeRank"),
      testId: "leaderboard-tab-tribe-rank",
    },
  ];
  if (showDerbi) {
    tabs.push({
      id: "derbi",
      label: t("tabDerbi"),
      testId: "leaderboard-tab-derbi",
    });
  }

  return (
    <div
      className={styles.tabs}
      role="tablist"
      aria-label={t("tabsAria")}
      data-testid="leaderboard-tabs"
    >
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={selected ? styles.tabActive : styles.tab}
            onClick={() => onChange(tab.id)}
            data-testid={tab.testId}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
