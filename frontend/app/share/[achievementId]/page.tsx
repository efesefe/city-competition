import type { Metadata } from "next";
import { API_BASE } from "@/lib/auth-api";
import ShareActions from "./ShareActions";
import styles from "./share.module.css";

type AchievementView = {
  public_id: string;
  kind: string;
  title: string;
  description: string;
  il_code?: string;
  deep_link: string;
  share_path: string;
};

async function fetchAchievement(id: string): Promise<AchievementView | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/achievements/${id}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as AchievementView;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: { achievementId: string };
}): Promise<Metadata> {
  const a = await fetchAchievement(params.achievementId);
  if (!a) {
    return { title: "Başarı | City Competition" };
  }
  const ogImage = `${API_BASE}/share/${a.public_id}/og.png`;
  return {
    title: a.title,
    description: a.description,
    openGraph: {
      title: a.title,
      description: a.description,
      images: [{ url: ogImage }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: a.title,
      description: a.description,
      images: [ogImage],
    },
  };
}

export default async function ShareAchievementPage({
  params,
}: {
  params: { achievementId: string };
}) {
  const a = await fetchAchievement(params.achievementId);
  if (!a) {
    return (
      <main className={styles.root}>
        <p className={styles.brand}>City Competition</p>
        <h1 className={styles.title}>Başarı bulunamadı</h1>
      </main>
    );
  }

  const shareURL =
    typeof process.env.NEXT_PUBLIC_SITE_URL === "string" &&
    process.env.NEXT_PUBLIC_SITE_URL
      ? `${process.env.NEXT_PUBLIC_SITE_URL}/share/${a.public_id}`
      : `/share/${a.public_id}`;

  return (
    <main className={styles.root}>
      <p className={styles.brand}>City Competition</p>
      <h1 className={styles.title}>{a.title}</h1>
      <p className={styles.lead}>{a.description}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={styles.card}
        src={`${API_BASE}/share/${a.public_id}/og.png`}
        alt={a.title}
        width={600}
        height={315}
      />
      <ShareActions
        title={a.title}
        text={a.description}
        url={shareURL}
        deepLink={a.deep_link}
      />
    </main>
  );
}
