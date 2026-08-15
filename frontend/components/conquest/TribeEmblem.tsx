import {
  tribeEmblemFallback,
  tribeEmblemGlyph,
  tribeEmblemKey,
  tribeMarkColor,
} from "@/lib/tribeEmblem";
import type { Tribe } from "@/lib/tribes-api";
import styles from "./TribeEmblem.module.css";

export type TribeEmblemTribe = Pick<
  Tribe,
  "slug" | "short_name" | "display_name" | "primary_color" | "secondary_color"
>;

type TribeEmblemProps = {
  tribe?: TribeEmblemTribe | null;
  className?: string;
  empty?: string;
};

export default function TribeEmblem({
  tribe,
  className,
  empty = "—",
}: TribeEmblemProps) {
  const markClass = className ? `${styles.mark} ${className}` : styles.mark;
  if (!tribe) {
    return (
      <span className={`${styles.initial} ${markClass}`} aria-hidden>
        {empty}
      </span>
    );
  }

  const color = tribeMarkColor(tribe);
  const key = tribeEmblemKey(tribe.slug);
  const glyph = tribeEmblemGlyph(tribe.slug);
  if (!key || !glyph) {
    return (
      <span
        className={`${styles.initial} ${markClass}`}
        style={{ color }}
        aria-hidden
      >
        {tribeEmblemFallback(tribe)}
      </span>
    );
  }

  return (
    <svg
      className={markClass}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      data-emblem={key}
      style={{ color }}
    >
      {glyph.paths.map((d) => (
        <path key={d} d={d} fill="currentColor" fillRule={glyph.fillRule} />
      ))}
    </svg>
  );
}
