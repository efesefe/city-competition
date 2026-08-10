import { ImageResponse } from "next/og";
import { API_BASE } from "@/lib/auth-api";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type AchievementView = {
  title: string;
  description: string;
};

export default async function Image({
  params,
}: {
  params: { achievementId: string };
}) {
  let title = "City Competition";
  let description = "Başarı";
  try {
    const res = await fetch(`${API_BASE}/v1/achievements/${params.achievementId}`);
    if (res.ok) {
      const a = (await res.json()) as AchievementView;
      title = a.title || title;
      description = a.description || description;
    }
  } catch {
    // keep defaults
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 60,
          background: "#0f2e28",
          color: "#f4e8c1",
        }}
      >
        <div style={{ fontSize: 64, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 32, marginTop: 24, color: "#c4a35a" }}>
          {description}
        </div>
        <div style={{ fontSize: 28, marginTop: 80, color: "#8a9e96" }}>
          City Competition
        </div>
      </div>
    ),
    { ...size },
  );
}
