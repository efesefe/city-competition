"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

const ProvinceMap = dynamic(() => import("@/components/ProvinceMap"), {
  ssr: false,
  loading: () => <div className="map-root" aria-busy="true" />,
});

function MapInner() {
  const searchParams = useSearchParams();
  const focusIl = searchParams.get("il");

  return (
    <main className="map-root" data-testid="map-screen">
      <ProvinceMap initialIlCode={focusIl} />
    </main>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={<main className="map-root" aria-busy="true" />}>
      <MapInner />
    </Suspense>
  );
}
