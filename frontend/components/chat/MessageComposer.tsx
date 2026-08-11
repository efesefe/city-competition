"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { sendTribeMessage, type TribeMessage } from "@/lib/tribes-api";
import styles from "./MessageComposer.module.css";

export type MessageComposerProps = {
  tribeId: string;
  onSent: (message: TribeMessage) => void;
  disabled?: boolean;
};

export default function MessageComposer({
  tribeId,
  onSent,
  disabled = false,
}: MessageComposerProps) {
  const t = useTranslations("profile.chat");
  const [text, setText] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = !disabled && !inFlight && text.trim().length > 0;

  async function submit() {
    const body = text.trim();
    if (!body || inFlight || disabled) return;
    setInFlight(true);
    setError(null);
    try {
      const res = await sendTribeMessage(tribeId, body);
      setText("");
      onSent(res.message);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code ?? "")
          : "";
      if (code === "error_empty_body") {
        setError(t("empty"));
      } else if (code === "error_restricted_mode") {
        setError(t("restricted"));
      } else if (code === "error_not_member") {
        setError(t("notMember"));
      } else {
        setError(t("sendFailed"));
      }
    } finally {
      setInFlight(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <form
      className={styles.composer}
      onSubmit={onSubmit}
      data-testid="tribe-chat-composer"
    >
      <div className={styles.row}>
        <textarea
          className={styles.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("placeholder")}
          disabled={disabled || inFlight}
          rows={2}
          aria-label={t("placeholder")}
          data-testid="tribe-chat-input"
        />
        <button
          type="submit"
          className={styles.send}
          disabled={!canSend}
          data-testid="tribe-chat-send"
        >
          {t("send")}
        </button>
      </div>
      {error ? (
        <p className={styles.error} data-testid="tribe-chat-send-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
