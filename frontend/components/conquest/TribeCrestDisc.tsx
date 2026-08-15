import { NEUTRAL_TRIBE_COLOR, tribeAccentColor } from "@/lib/tribeCrest";
import type { Tribe } from "@/lib/tribes-api";
import TribeEmblem from "./TribeEmblem";
import styles from "./TribeCrestDisc.module.css";

type TribeCrestDiscProps = {
  tribe?: Tribe | null;
  size?: "sm" | "md" | "lg";
  fading?: boolean;
};

export default function TribeCrestDisc({
  tribe,
  size = "md",
  fading = false,
}: TribeCrestDiscProps) {
  const accent = tribe ? tribeAccentColor(tribe) : NEUTRAL_TRIBE_COLOR;
  return (
    <span
      className={`${styles.disc} ${styles[size]}${fading ? ` ${styles.fading}` : ""}`}
      style={{ background: accent, borderColor: accent }}
      aria-hidden
    >
      <TribeEmblem tribe={tribe} />
    </span>
  );
}
