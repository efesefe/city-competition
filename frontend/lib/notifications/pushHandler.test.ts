import { beforeEach, describe, expect, it } from "vitest";
import {
  appendFocusCredits,
  consumePendingDeepLink,
  handleForegroundPush,
  handleNotificationClick,
  inboxNotificationHref,
  isMapDeepLink,
  isSafeAppPath,
  parseThreatPush,
  PENDING_DEEP_LINK_KEY,
  resolveThreatHref,
  stashPendingDeepLink,
  subscribePushClick,
  subscribeThreatAlert,
  type InAppThreatAlert,
} from "./pushHandler";

const THREAT = {
  type: "rival_threat",
  il_code: "34",
  city_name: "İstanbul",
  tribe_id: "tribe-gs",
  tension_percent: "72",
  level: "70",
  deep_link: "/map?il=34",
};

describe("isSafeAppPath / isMapDeepLink", () => {
  it("accepts relative app paths and map deep links", () => {
    expect(isSafeAppPath("/map?il=34")).toBe(true);
    expect(isMapDeepLink("/map?il=34")).toBe(true);
    expect(isMapDeepLink("/map")).toBe(true);
  });

  it("rejects off-site and protocol-relative URLs", () => {
    expect(isSafeAppPath("https://evil.example/map?il=34")).toBe(false);
    expect(isSafeAppPath("//evil.example/map")).toBe(false);
    expect(isSafeAppPath("javascript:alert(1)")).toBe(false);
    expect(isMapDeepLink("/conquest-log")).toBe(false);
  });
});

describe("resolveThreatHref", () => {
  it("uses a same-origin /map deep_link and appends focus=credits", () => {
    expect(resolveThreatHref(THREAT)).toBe("/map?il=34&focus=credits");
  });

  it("builds /map?il= from il_code when deep_link is missing", () => {
    expect(resolveThreatHref({ il_code: "06" })).toBe(
      "/map?il=06&focus=credits",
    );
  });

  it("ignores absolute deep_link and falls back to il_code", () => {
    expect(
      resolveThreatHref({
        il_code: "34",
        deep_link: "https://evil.example/phish",
      }),
    ).toBe("/map?il=34&focus=credits");
  });

  it("returns null when neither a safe map link nor a two-digit il_code exists", () => {
    expect(resolveThreatHref({ deep_link: "/conquest-log" })).toBeNull();
    expect(resolveThreatHref({ il_code: "not-a-city" })).toBeNull();
  });
});

describe("appendFocusCredits", () => {
  it("does not duplicate the focus param", () => {
    expect(appendFocusCredits("/map?il=34&focus=credits")).toBe(
      "/map?il=34&focus=credits",
    );
  });
});

describe("parseThreatPush", () => {
  it("parses FCM-style string maps", () => {
    const parsed = parseThreatPush(THREAT);
    expect(parsed).toMatchObject({
      type: "rival_threat",
      il_code: "34",
      city_name: "İstanbul",
      tribe_id: "tribe-gs",
      tension_percent: 72,
      level: 70,
    });
    expect(parsed?.deep_link).toBe("/map?il=34&focus=credits");
  });

  it("parses inbox JSON with numeric fields", () => {
    const parsed = parseThreatPush({
      type: "rival_threat",
      il_code: "06",
      city_name: "Ankara",
      tribe_id: "tribe-a",
      tension_percent: 91,
      level: 90,
      deep_link: "/map?il=06",
    });
    expect(parsed?.level).toBe(90);
    expect(parsed?.tension_percent).toBe(91);
  });

  it("returns null for other notification types", () => {
    expect(parseThreatPush({ type: "derby_started", il_code: "34" })).toBeNull();
  });
});

describe("inboxNotificationHref", () => {
  it("deep-links rival_threat inbox rows into the support sheet", () => {
    expect(
      inboxNotificationHref({
        type: "rival_threat",
        payload: { il_code: "34", deep_link: "/map?il=34" },
      }),
    ).toBe("/map?il=34&focus=credits");
  });

  it("passes through other safe deep_links without forcing focus=credits", () => {
    expect(
      inboxNotificationHref({
        type: "derby_started",
        payload: { deep_link: "/map?il=34&derbi=abc" },
      }),
    ).toBe("/map?il=34&derbi=abc");
  });
});

describe("pending deep link + click routing", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
  });

  it("stashes and consumes a pending href once", () => {
    stashPendingDeepLink("/map?il=34&focus=credits");
    expect(store.get(PENDING_DEEP_LINK_KEY)).toBe("/map?il=34&focus=credits");
    expect(consumePendingDeepLink()).toBe("/map?il=34&focus=credits");
    expect(consumePendingDeepLink()).toBeNull();
  });

  it("handleNotificationClick stashes the focused map href", () => {
    const href = handleNotificationClick(THREAT);
    expect(href).toBe("/map?il=34&focus=credits");
    expect(consumePendingDeepLink()).toBe("/map?il=34&focus=credits");
  });

  it("notifies a live client of the click href", () => {
    const seen: string[] = [];
    const unsub = subscribePushClick((href) => {
      seen.push(href);
    });
    handleNotificationClick(THREAT);
    unsub();
    expect(seen).toEqual(["/map?il=34&focus=credits"]);
  });
});

describe("handleForegroundPush", () => {
  it("emits an in-app threat alert without requiring a tap", () => {
    const seen: InAppThreatAlert[] = [];
    const unsub = subscribeThreatAlert((alert) => {
      seen.push(alert);
    });
    const result = handleForegroundPush(THREAT);
    unsub();
    expect(result.kind).toBe("threat_banner");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.il_code).toBe("34");
    expect(seen[0]?.level).toBe(70);
  });

  it("ignores non-threat payloads", () => {
    expect(handleForegroundPush({ type: "derby_started" })).toEqual({
      kind: "ignore",
    });
  });
});
