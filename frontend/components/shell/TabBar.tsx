"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import styles from "./TabBar.module.css";

const TABS = [
  { href: "/map", key: "tabMap" as const, Icon: MapIcon },
  { href: "/leaderboard", key: "tabLeaderboard" as const, Icon: BoardIcon },
  { href: "/profile", key: "tabProfile" as const, Icon: ProfileIcon },
];

export default function TabBar() {
  const t = useTranslations("shell");
  const pathname = usePathname();

  return (
    <nav className={styles.tabBar} aria-label={t("tabBarAria")} data-testid="tab-bar">
      {TABS.map(({ href, key, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={active ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            aria-current={active ? "page" : undefined}
            data-testid={`tab-${href.slice(1)}`}
          >
            <Icon className={styles.icon} />
            <span>{t(key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function MapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20V6.5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M9 4v13.5M15 6.5V20"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BoardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 19V9M10 19V5M16 19v-7M22 19H2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ProfileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M5 19.5c1.4-3.2 3.9-4.75 7-4.75s5.6 1.55 7 4.75"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
