"use client";

import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import ConsentModal from "@/components/ConsentModal";
import DataResidencyBanner from "@/components/DataResidencyBanner";
import CreditHeader from "@/components/shell/CreditHeader";
import TabBar from "@/components/shell/TabBar";
import shellStyles from "@/components/shell/shell.module.css";
import { WalletProvider, useWallet } from "@/context/WalletContext";
import { RealtimeProvider } from "@/context/RealtimeContext";
import { CityDataProvider } from "@/context/CityDataContext";
import {
  ConsentStatusResponse,
  fetchConsentStatus,
  hasRequiredConsents,
} from "@/lib/consent-api";
import { getSessionToken } from "@/lib/session";
import { hasTribeMembership, listTribes } from "@/lib/tribes-api";
import { tribeAccentColor } from "@/lib/tribeCrest";

type Gate =
  | { kind: "loading" }
  | { kind: "need_auth" }
  | { kind: "need_consent"; status: ConsentStatusResponse }
  | { kind: "need_tribe" }
  | { kind: "ready" };

function ShellChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { tribe } = useWallet();
  const accent = tribeAccentColor(tribe);
  const isMap = pathname === "/map" || pathname.startsWith("/map/");

  return (
    <div
      className={shellStyles.shell}
      style={{ ["--tribe-accent" as string]: accent }}
      data-testid="app-shell"
    >
      <CreditHeader />
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
      return null;
    }
    const status = await fetchConsentStatus();
    if (!hasRequiredConsents(status)) {
      setGate({ kind: "need_consent", status });
      return status;
    }
    const tribes = await listTribes();
    if (!hasTribeMembership(tribes.membership)) {
      setGate({ kind: "need_tribe" });
      return status;
    }
    setGate({ kind: "ready" });
    return status;
  }, []);

  useEffect(() => {
    refresh().catch(() => setGate({ kind: "need_auth" }));
  }, [refresh]);

  useEffect(() => {
    if (gate.kind === "need_auth") {
      router.replace("/register");
    } else if (gate.kind === "need_tribe") {
      router.replace("/tribes");
    }
  }, [gate, router]);

  if (
    gate.kind === "loading" ||
    gate.kind === "need_auth" ||
    gate.kind === "need_tribe"
  ) {
    return <main className="map-root" aria-busy="true" />;
  }

  if (gate.kind === "need_consent") {
    return (
      <>
        <DataResidencyBanner />
        <ConsentModal
          status={gate.status}
          onStatusRefresh={async () => {
            const status = await refresh();
            if (!status) {
              throw new Error("error_unauthorized");
            }
            return status;
          }}
          onGranted={() => {
            void refresh();
          }}
        />
      </>
    );
  }

  return (
    <WalletProvider>
      <RealtimeProvider>
        <CityDataProvider>
          <ShellChrome>{children}</ShellChrome>
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
