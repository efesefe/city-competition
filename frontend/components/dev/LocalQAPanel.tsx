"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchQAPersonas,
  loginAs,
  type QAPersona,
} from "@/lib/auth-api";
import { postSupport } from "@/lib/support-api";
import { API_BASE } from "@/lib/auth-api";
import {
  getSessionToken,
  getUserId,
  isRestrictedMode,
  setSession,
  getActingAsUsername,
  popImpersonationStack,
} from "@/lib/session";
import styles from "./LocalQAPanel.module.css";

function qaPanelEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_DEV_QA_PANEL === "true") return true;
  if (process.env.NEXT_PUBLIC_DEV_QA_PANEL === "false") return false;
  return process.env.NODE_ENV === "development";
}

async function stubGrant(): Promise<void> {
  const token = getSessionToken();
  if (!token) throw new Error("not signed in");
  const res = await fetch(`${API_BASE}/v1/credits/stub-grant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      idempotency_key: `qa-stub-${Date.now()}`,
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "stub_grant_failed");
  }
}

export default function LocalQAPanel() {
  const [open, setOpen] = useState(false);
  const [personas, setPersonas] = useState<QAPersona[]>([]);
  const [selected, setSelected] = useState("");
  const [ilCode, setIlCode] = useState("34");
  const [credits, setCredits] = useState(50);
  const [status, setStatus] = useState<string | null>(null);
  const [actingAs, setActingAs] = useState<string | null>(null);
  const enabled = qaPanelEnabled();

  const refresh = useCallback(async () => {
    try {
      const list = await fetchQAPersonas();
      setPersonas(list);
      if (!selected && list[0]) setSelected(list[0].username);
    } catch {
      setPersonas([]);
    }
    setActingAs(getActingAsUsername());
  }, [selected]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  if (!enabled) return null;

  async function switchPersona() {
    if (!selected) return;
    setStatus(null);
    try {
      const res = await loginAs({ username: selected });
      setSession(res.user_id, res.session_token, res.restricted_mode);
      window.sessionStorage.setItem("cc_acting_as_username", selected);
      setStatus(`Switched to ${selected}`);
      window.location.assign("/map");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "login-as failed");
    }
  }

  async function grantCredits() {
    setStatus(null);
    try {
      await stubGrant();
      setStatus("Stub credits granted");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "grant failed");
    }
  }

  async function quickSupport() {
    setStatus(null);
    try {
      const res = await postSupport(ilCode.trim(), credits);
      setStatus(
        `Supported ${res.il_code}: +${res.effective_support} (bal ${res.balance_after})`,
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "support failed");
    }
  }

  function exitImpersonation() {
    const prev = popImpersonationStack();
    if (!prev) {
      setStatus("No stacked admin session");
      return;
    }
    setSession(prev.userId, prev.sessionToken, prev.restrictedMode);
    window.location.assign("/moderation");
  }

  return (
    <div className={styles.root} data-testid="local-qa-panel">
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Local QA
      </button>
      {open ? (
        <div className={styles.panel}>
          <p className={styles.copy}>
            Switch tribe personas and support the same il to see competition.
          </p>
          {actingAs || getUserId() ? (
            <p className={styles.meta}>
              Session: {actingAs ?? getUserId()?.slice(0, 8)}
              {isRestrictedMode() ? " (restricted)" : ""}
            </p>
          ) : null}
          <label className={styles.label}>
            Persona
            <select
              className={styles.select}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              data-testid="qa-persona-select"
            >
              {personas.map((p) => (
                <option key={p.id} value={p.username}>
                  {p.username}
                  {p.tribe_name ? ` — ${p.tribe_name}` : ""}
                  {p.is_admin ? " (admin)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.btn}
            onClick={() => void switchPersona()}
            data-testid="qa-switch-persona"
          >
            Login as persona
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => void grantCredits()}
            data-testid="qa-stub-grant"
          >
            Grant stub credits
          </button>
          <Link className={styles.link} href="/profile/topup">
            Open top-up / pay
          </Link>
          <div className={styles.row}>
            <label className={styles.label}>
              il
              <input
                className={styles.input}
                value={ilCode}
                onChange={(e) => setIlCode(e.target.value)}
              />
            </label>
            <label className={styles.label}>
              credits
              <input
                className={styles.input}
                type="number"
                min={1}
                value={credits}
                onChange={(e) => setCredits(Number(e.target.value) || 1)}
              />
            </label>
          </div>
          <button
            type="button"
            className={styles.btn}
            onClick={() => void quickSupport()}
            data-testid="qa-quick-support"
          >
            Quick support
          </button>
          <div className={styles.links}>
            <Link href="/map">Map</Link>
            <Link href="/leaderboard">Leaderboard</Link>
            <Link href="/derbies">Derbies</Link>
            <Link href="/moderation">Admin</Link>
          </div>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={exitImpersonation}
          >
            Exit impersonation
          </button>
          {status ? <p className={styles.status}>{status}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
