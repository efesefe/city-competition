"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  consumePendingDeepLink,
  isSafeAppPath,
  subscribePushClick,
} from "@/lib/notifications/pushHandler";

/**
 * Cold-start + warm-tap bridge: consume a stashed deep link (SW / native
 * notificationclick before React hydrates) and listen for live push-click events.
 */
export default function PushDeepLinkBridge() {
  const router = useRouter();

  useEffect(() => {
    const pending = consumePendingDeepLink();
    if (pending) {
      router.replace(pending);
    }

    function go(href: string) {
      if (!isSafeAppPath(href)) return;
      consumePendingDeepLink();
      router.replace(href);
    }

    const unsub = subscribePushClick(go);
    return unsub;
  }, [router]);

  return null;
}
