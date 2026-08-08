"use client";

import dynamic from "next/dynamic";

const MapCanvas = dynamic(() => import("@/components/MapCanvas"), {
  ssr: false,
  loading: () => <div className="map-root" aria-busy="true" />,
});

export default function HomePage() {
  return (
    <main className="map-root">
      <MapCanvas />
    </main>
  );
}
