"use client";

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
import styles from "../../(auth)/register/register.module.css";

export default function ConsentPage() {
  const router = useRouter();
  const [status, setStatus] = useState<ConsentStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await fetchConsentStatus();
    setStatus(data);
    return data;
  }, []);

  useEffect(() => {
    if (!getSessionToken()) {
      router.replace("/register");
      return;
    }
    load()
      .then((data) => {
        if (hasRequiredConsents(data)) {
          router.replace("/");
        }
      })
      .catch(() => setError("Onay durumu alınamadı."));
  }, [load, router]);

  if (error) {
    return (
      <main className={styles.page}>
        <p className={styles.error}>{error}</p>
      </main>
    );
  }

  if (!status || hasRequiredConsents(status)) {
    return (
      <main className={styles.page} aria-busy="true">
        <p className={styles.lead}>Yükleniyor…</p>
      </main>
    );
  }

  return (
    <>
      <DataResidencyBanner />
      <ConsentModal
        status={status}
        onStatusRefresh={load}
        onGranted={() => router.replace("/")}
      />
    </>
  );
}
