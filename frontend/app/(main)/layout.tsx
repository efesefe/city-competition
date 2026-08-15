"use client";

import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import DataResidencyBanner from "@/components/DataResidencyBanner";
import CreditHeader from "@/components/shell/CreditHeader";
import TabBar from "@/components/shell/TabBar";
import shellStyles from "@/components/shell/shell.module.css";
import { WalletProvider, useWallet } from "@/context/WalletContext";
import { RealtimeProvider } from "@/context/RealtimeContext";
import { CityDataProvider } from "@/context/CityDataContext";
import { NotificationsProvider } from "@/context/NotificationsContext";
import { ConquestProvider } from "@/context/ConquestContext";
import CaptureToast from "@/components/conquest/CaptureToast";
import CaptureCelebration from "@/components/conquest/CaptureCelebration";
import CreditFlowAnimation from "@/components/shell/CreditFlowAnimation";
import PushDeepLinkBridge from "@/components/notifications/PushDeepLinkBridge";
import {
  fetchConsentStatus,
  hasRequiredConsents,
} from "@/lib/consent-api";
import { getSessionToken } from "@/lib/session";
import { hasTribeMembership, listTribes } from "@/lib/tribes-api";
import { tribeAccentOnDark } from "@/lib/tribeCrest";

type Gate =
  | { kind: "loading" }
  | { kind: "need_auth" }
  | { kind: "need_consent" }
  | { kind: "need_tribe" }
  | { kind: "ready" };

function ShellChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { tribe } = useWallet();
  const accent = tribeAccentOnDark(tribe);
  const isMap = pathname === "/map" || pathname.startsWith("/map/");

  return (
    <div
      className={shellStyles.shell}
      style={{ ["--tribe-accent" as string]: accent }}
      data-testid="app-shell"
    >
      <CreditHeader />
      <CreditFlowAnimation />
      <PushDeepLinkBridge />
      <CaptureToast />
      <CaptureCelebration />
      <div
        className={
          isMap
            ? `${shellStyles.content} ${shellStyles.contentMap}`
            : shellStyles.content
        }
      >
        <DataResidencyBanner />
        {children}
      </div>
      <TabBar />
    </div>
  );
}

function MainGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [gate, setGate] = useState<Gate>({ kind: "loading" });

  const refresh = useCallback(async () => {
    const token = getSessionToken();
    if (!token) {
      setGate({ kind: "need_auth" });
      return;
    }
    const status = await fetchConsentStatus();
    if (!hasRequiredConsents(status)) {
      setGate({ kind: "need_consent" });
      return;
    }
    const tribes = await listTribes();
    if (!hasTribeMembership(tribes.membership)) {
      setGate({ kind: "need_tribe" });
      return;
    }
    setGate({ kind: "ready" });
  }, []);

  useEffect(() => {
    refresh().catch(() => setGate({ kind: "need_auth" }));
  }, [refresh]);

  useEffect(() => {
    if (gate.kind === "need_auth") {
      router.replace("/register");
    } else if (gate.kind === "need_consent") {
      router.replace("/consent");
    } else if (gate.kind === "need_tribe") {
      router.replace("/choose-tribe");
    }
  }, [gate, router]);

  if (gate.kind !== "ready") {
    return <main className="map-root" aria-busy="true" />;
  }

  return (
    <WalletProvider>
      <RealtimeProvider>
        <CityDataProvider>
          <NotificationsProvider>
            <ConquestProvider>
              <ShellChrome>{children}</ShellChrome>
            </ConquestProvider>
          </NotificationsProvider>
        </CityDataProvider>
      </RealtimeProvider>
    </WalletProvider>
  );
}

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<main className="map-root" aria-busy="true" />}>
      <MainGate>{children}</MainGate>
    </Suspense>
  );
}
