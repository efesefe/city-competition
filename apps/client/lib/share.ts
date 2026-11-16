import { Share, Platform } from "react-native";
import { API_URL } from "./config";
import type { ShareCard } from "./api";

/** Build an absolute URL for the static SVG card (or share path). */
export function shareCardImageUrl(card: ShareCard): string {
  return `${API_URL}${card.cardSvgPath}`;
}

export function shareCardPageUrl(card: ShareCard): string {
  return `${API_URL}${card.sharePath.startsWith("/") ? "" : "/"}${card.sharePath}`;
}

/**
 * Native / web share sheet for a minted card.
 * Guests never reach this — callers must gate on verified + tribe.
 */
export async function shareCardNative(card: ShareCard): Promise<void> {
  const url = shareCardImageUrl(card);
  const message =
    Platform.OS === "ios"
      ? `${card.lineTr}\n${card.brand}`
      : `${card.lineTr}\n${card.brand}\n${url}`;
  await Share.share(
    Platform.OS === "ios"
      ? { message, url, title: card.title }
      : { message, title: card.title },
  );
}
