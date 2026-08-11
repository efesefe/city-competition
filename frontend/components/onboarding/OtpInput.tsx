"use client";

import {
  ClipboardEvent,
  createRef,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  type ChangeEvent,
} from "react";
import styles from "./OtpInput.module.css";

const LENGTH = 6;

type Props = {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
};

function normalizeDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, LENGTH);
}

export default function OtpInput({
  value,
  onChange,
  disabled = false,
  id = "otp",
  "aria-label": ariaLabel,
}: Props) {
  const digits = useMemo(() => {
    const normalized = normalizeDigits(value);
    return Array.from({ length: LENGTH }, (_, i) => normalized[i] ?? "");
  }, [value]);

  const refs = useRef(
    Array.from({ length: LENGTH }, () => createRef<HTMLInputElement>()),
  );

  useEffect(() => {
    if (disabled) return;
    const firstEmpty = digits.findIndex((d) => !d);
    const idx = firstEmpty === -1 ? LENGTH - 1 : firstEmpty;
    refs.current[idx]?.current?.focus();
  }, [disabled]); // eslint-disable-line react-hooks/exhaustive-deps -- focus once on mount / enable

  function emit(next: string[]) {
    onChange(next.join("").slice(0, LENGTH));
  }

  function focusAt(index: number) {
    const clamped = Math.max(0, Math.min(LENGTH - 1, index));
    refs.current[clamped]?.current?.focus();
    refs.current[clamped]?.current?.select();
  }

  function onDigitChange(index: number, e: ChangeEvent<HTMLInputElement>) {
    const incoming = normalizeDigits(e.target.value);
    if (!incoming) {
      const next = [...digits];
      next[index] = "";
      emit(next);
      return;
    }
    const next = [...digits];
    if (incoming.length === 1) {
      next[index] = incoming;
      emit(next);
      if (index < LENGTH - 1) focusAt(index + 1);
      return;
    }
    // Multi-digit (e.g. autofill into one cell)
    for (let i = 0; i < incoming.length && index + i < LENGTH; i++) {
      next[index + i] = incoming[i]!;
    }
    emit(next);
    focusAt(Math.min(index + incoming.length, LENGTH - 1));
  }

  function onKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (digits[index]) {
        const next = [...digits];
        next[index] = "";
        emit(next);
        return;
      }
      if (index > 0) {
        e.preventDefault();
        const next = [...digits];
        next[index - 1] = "";
        emit(next);
        focusAt(index - 1);
      }
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusAt(index - 1);
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      focusAt(index + 1);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = normalizeDigits(e.clipboardData.getData("text"));
    if (!pasted) return;
    const next = Array.from({ length: LENGTH }, (_, i) => pasted[i] ?? "");
    emit(next);
    focusAt(Math.min(pasted.length, LENGTH - 1));
  }

  return (
    <div
      className={styles.row}
      role="group"
      aria-label={ariaLabel}
      data-testid="otp-input"
    >
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={refs.current[index]}
          id={index === 0 ? id : undefined}
          className={styles.cell}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={LENGTH}
          value={digit}
          disabled={disabled}
          aria-label={`${index + 1}`}
          onChange={(e) => onDigitChange(index, e)}
          onKeyDown={(e) => onKeyDown(index, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
