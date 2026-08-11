"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import ChatThread from "@/components/chat/ChatThread";
import { useWallet } from "@/context/WalletContext";
import { isRestrictedMode } from "@/lib/session";
import styles from "@/components/chat/TribeChatPage.module.css";

export default function TribeChatPage() {
  const t = useTranslations("profile");
  const tChat = useTranslations("profile.chat");
  const router = useRouter();
  const { tribeId, status } = useWallet();
  const [gated, setGated] = useState(false);

  useEffect(() => {
    if (isRestrictedMode()) {
      setGated(true);
      router.replace("/profile");
    }
  }, [router]);

  if (gated) {
    return null;
  }

  return (
    <main className={styles.page} data-testid="tribe-chat-screen">
      <header className={styles.header}>
        <Link href="/profile" className={styles.back} data-testid="tribe-chat-back">
          {tChat("back")}
        </Link>
        <h1 className={styles.title}>{t("tribeChat")}</h1>
      </header>

      {status === "loading" || !tribeId ? (
        <p className={styles.loading} data-testid="tribe-chat-loading">
          {tChat("loading")}
        </p>
      ) : (
        <ChatThread tribeId={tribeId} />
      )}
    </main>
  );
}
