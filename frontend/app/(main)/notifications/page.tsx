"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useNotifications } from "@/context/NotificationsContext";
import {
  listNotifications,
  markNotificationsRead,
  type AppNotification,
} from "@/lib/notifications-api";
import styles from "./notifications.module.css";

function formatWhen(iso: string, locale: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

export default function NotificationsPage() {
  const t = useTranslations("notifications");
  const { refreshUnread, setUnreadCount } = useNotifications();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const locale = typeof navigator !== "undefined" ? navigator.language : "tr-TR";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listNotifications();
      setItems(res.notifications);
      const unreadIds = res.notifications
        .filter((n) => !n.read_at)
        .map((n) => n.id);
      if (unreadIds.length > 0) {
        await markNotificationsRead({ all: true });
        setItems((prev) =>
          prev.map((n) =>
            n.read_at
              ? n
              : { ...n, read_at: new Date().toISOString() },
          ),
        );
        setUnreadCount(0);
      } else {
        await refreshUnread();
      }
    } catch {
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [refreshUnread, setUnreadCount, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className={styles.page} data-testid="notifications-screen">
      <h1 className={styles.title}>{t("title")}</h1>
      {loading ? <p className={styles.status}>{t("loading")}</p> : null}
      {error ? (
        <p className={styles.error} data-testid="notifications-error">
          {error}
        </p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <p className={styles.status} data-testid="notifications-empty">
          {t("empty")}
        </p>
      ) : null}
      <ul className={styles.list} data-testid="notifications-list">
        {items.map((item) => {
          const unread = !item.read_at;
          return (
            <li
              key={item.id}
              className={`${styles.item}${unread ? ` ${styles.itemUnread}` : ""}`}
              data-testid="notification-item"
              data-unread={unread ? "1" : "0"}
              data-type={item.type}
            >
              <p className={styles.itemTitle}>{item.title}</p>
              <p className={styles.itemBody}>{item.body}</p>
              <p className={styles.itemMeta}>
                {formatWhen(item.created_at, locale)}
              </p>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
