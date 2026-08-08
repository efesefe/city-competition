"use client";

const REGION_COPY: Record<string, string> = {
  TR: "Verileriniz Türkiye (TR) bölgesindeki sunucularda işlenir ve saklanır.",
  EU: "Verileriniz Avrupa Birliği (EU) bölgesindeki sunucularda işlenir ve saklanır. Sınır ötesi aktarım söz konusu olabilir.",
};

export default function DataResidencyBanner() {
  const region = process.env.NEXT_PUBLIC_DATA_REGION ?? "TR";
  const text = REGION_COPY[region] ?? REGION_COPY.TR;

  return (
    <aside
      className="data-residency-banner"
      data-testid="data-residency-banner"
      data-region={region}
      role="status"
    >
      {text}
    </aside>
  );
}
