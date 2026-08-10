"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConsentModal from "@/components/ConsentModal";
import DataResidencyBanner from "@/components/DataResidencyBanner";
import {
  ConsentStatusResponse,
  fetchConsentStatus,
  hasRequiredConsents,
} from "@/lib/consent-api";
import { getSessionToken } from "@/lib/session";
import { hasTribeMembership, listTribes } from "@/lib/tribes-api";

const ProvinceMap = dynamic(() => import("@/components/ProvinceMap"), {
  ssr: false,
  loading: () => <div className="map-root" aria-busy="true" />,
});

type Gate =
  | { kind: "loading" }
  | { kind: "need_auth" }
  | { kind: "need_consent"; status: ConsentStatusResponse }
  | { kind: "need_tribe" }
  | { kind: "ready" };

export default function HomePage() {
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
    <main className="map-root" data-testid="map-screen">
      <DataResidencyBanner />
      <ProvinceMap />
    </main>
  );
}
