"use client";

import { useTranslations } from "next-intl";

export default function DataResidencyBanner() {
  const t = useTranslations("residency");
  const region = process.env.NEXT_PUBLIC_DATA_REGION ?? "TR";
  const text = region === "EU" ? t("EU") : t("TR");

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
