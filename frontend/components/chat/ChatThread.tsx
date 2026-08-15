"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type UIEvent,
} from "react";
import { useTranslations } from "next-intl";
import { useRealtime } from "@/context/RealtimeContext";
import {
  hueFromUserId,
  resolveAvatarSrc,
  supporterInitials,
} from "@/lib/conquest/supporterDisplay";
import { formatTime } from "@/lib/dateFormat";
import {
  PRESENCE_POLL_MS,
  expireStaleOnlineIds,
  getOnlineMembers,
  isMemberOnline,
  replaceOnlineIds,
  userAvatarPath,
} from "@/lib/presence";
import { getUserId } from "@/lib/session";
import type { TribeMessage } from "@/lib/tribes-api";
import MessageComposer from "./MessageComposer";
import type { ChatThreadMessage } from "./types";
import styles from "./ChatThread.module.css";

const NEAR_BOTTOM_PX = 80;

function tribeRoom(tribeId: string) {
  return `tribe:${tribeId}`;
}

function shortSender(id: string) {
  return id.replace(/-/g, "").slice(0, 8);
}

function sortAscending(a: ChatThreadMessage, b: ChatThreadMessage) {
  const ta = new Date(a.createdAt).getTime();
  const tb = new Date(b.createdAt).getTime();
  if (ta !== tb) return ta - tb;
  return a.id.localeCompare(b.id);
}

export type ChatThreadProps = {
  tribeId: string;
};

export default function ChatThread({ tribeId }: ChatThreadProps) {
  const t = useTranslations("profile.chat");
  const { subscribe, joinRoom, leaveRoom } = useRealtime();
  const [messages, setMessages] = useState<ChatThreadMessage[]>([]);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(() => new Set());

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const idsRef = useRef(new Set<string>());
  const lastSuccessAtRef = useRef<number | null>(null);

  useEffect(() => {
    setViewerId(getUserId());
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    setHasNewBelow(false);
  }, []);

  const appendMessage = useCallback(
    (msg: ChatThreadMessage) => {
      if (idsRef.current.has(msg.id)) {
        // Upgrade under-review → delivered if a later event clears it.
        setMessages((prev) =>
          prev.map((row) =>
            row.id === msg.id
              ? {
                  ...row,
                  underReview: msg.underReview ?? row.underReview,
                  body: msg.body,
                }
              : row,
          ),
        );
        return;
      }
      idsRef.current.add(msg.id);
      const stick = stickToBottomRef.current;
      setMessages((prev) => [...prev, msg].sort(sortAscending));
      if (stick) {
        requestAnimationFrame(() => scrollToBottom());
      } else {
        setHasNewBelow(true);
      }
    },
    [scrollToBottom],
  );

  useEffect(() => {
    const room = tribeRoom(tribeId);
    joinRoom(room);
    return () => {
      leaveRoom(room);
    };
  }, [tribeId, joinRoom, leaveRoom]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "tribe_message") return;
      if (event.tribe_id !== tribeId) return;
      appendMessage({
        id: event.id,
        tribeId: event.tribe_id,
        senderId: event.sender_id,
        body: event.body,
        createdAt: event.created_at,
      });
    });
  }, [subscribe, tribeId, appendMessage]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let seq = 0;
    lastSuccessAtRef.current = null;
    setOnlineIds(new Set());

    function applyExpiry(now = Date.now()) {
      setOnlineIds((prev) =>
        expireStaleOnlineIds(prev, lastSuccessAtRef.current, now),
      );
    }

    async function refresh() {
      const mine = ++seq;
      applyExpiry();
      try {
        const res = await getOnlineMembers(tribeId);
        if (cancelled || mine !== seq) return;
        lastSuccessAtRef.current = Date.now();
        setOnlineIds(replaceOnlineIds(res.user_ids));
      } catch {
        if (!cancelled && mine === seq) {
          applyExpiry();
        }
      }
    }

    function schedule() {
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          void refresh();
        } else {
          applyExpiry();
        }
        if (!cancelled) {
          schedule();
        }
      }, PRESENCE_POLL_MS);
    }

    void refresh();
    schedule();

    const onVis = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      if (timer != null) {
        window.clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [tribeId]);

  function onScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    stickToBottomRef.current = near;
    if (near) {
      setHasNewBelow(false);
    }
  }

  function onLocalSent(message: TribeMessage) {
    appendMessage({
      id: message.id,
      tribeId: message.tribe_id ?? tribeId,
      senderId: message.sender_id,
      body: message.body,
      createdAt: message.created_at,
      underReview: message.flagged,
    });
  }

  function senderLabel(senderId: string) {
    if (viewerId && senderId === viewerId) {
      return t("you");
    }
    return shortSender(senderId);
  }

  return (
    <div className={styles.thread} data-testid="tribe-chat-thread">
      <div
        className={styles.scroller}
        ref={scrollerRef}
        onScroll={onScroll}
        data-testid="tribe-chat-scroller"
      >
        {messages.length === 0 ? (
          <p className={styles.empty}>{t("emptyThread")}</p>
        ) : (
          messages.map((msg) => {
            const own = Boolean(viewerId && msg.senderId === viewerId);
            const online = isMemberOnline(msg.senderId, onlineIds);
            return (
              <article
                key={msg.id}
                className={[
                  styles.row,
                  own ? styles.rowOwn : "",
                  msg.underReview ? styles.rowReview : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-testid="tribe-chat-message"
                data-message-id={msg.id}
                data-under-review={msg.underReview ? "true" : "false"}
              >
                <div className={styles.head}>
                  <SenderAvatar senderId={msg.senderId} online={online} />
                  <div className={styles.meta}>
                    <span className={styles.sender}>{senderLabel(msg.senderId)}</span>
                    <time className={styles.time} dateTime={msg.createdAt}>
                      {formatTime(msg.createdAt)}
                    </time>
                  </div>
                </div>
                <p className={styles.body}>{msg.body}</p>
                {msg.underReview ? (
                  <p
                    className={styles.review}
                    data-testid="tribe-chat-under-review"
                  >
                    {t("underReview")}
                  </p>
                ) : null}
              </article>
            );
          })
        )}
      </div>

      {hasNewBelow ? (
        <button
          type="button"
          className={styles.newPill}
          onClick={scrollToBottom}
          data-testid="tribe-chat-new-messages"
        >
          {t("newMessages")}
        </button>
      ) : null}

      <MessageComposer tribeId={tribeId} onSent={onLocalSent} />
    </div>
  );
}

function SenderAvatar({
  senderId,
  online,
}: {
  senderId: string;
  online: boolean;
}) {
  const src = resolveAvatarSrc(userAvatarPath(senderId));
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src, senderId]);
  const showImg = Boolean(src) && !broken;
  const hue = hueFromUserId(senderId);
  return (
    <span className={styles.avatarWrap} aria-hidden>
      <span
        className={styles.avatar}
        style={{ background: `hsl(${hue}, 55%, 42%)` }}
      >
        <span className={styles.initials}>{supporterInitials(shortSender(senderId))}</span>
        {showImg ? (
          <img
            className={styles.photo}
            src={src}
            alt=""
            onError={() => setBroken(true)}
          />
        ) : null}
      </span>
      {online ? (
        <span className={styles.presenceDot} data-testid="presence-dot" />
      ) : null}
    </span>
  );
}
