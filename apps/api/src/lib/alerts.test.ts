import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attackDeepLink,
  renderAttackCopy,
  renderFlipCopy,
  NotifTypeAttack,
  NotifTypeFlipGain,
  NotifTypeFlipLoss,
  SPEND_INTEREST_HOURS,
} from "./alerts.js";
import { COALESCE_WINDOW_SEC } from "./coalesce.js";
import { processNotifPayload, LogPushSender } from "./pushWorker.js";

describe("attack alert copy", () => {
  it("renders owned-city attack copy (TR/EN)", () => {
    const copy = renderAttackCopy({
      scope: "owned",
      cityName: "İzmir",
      rivalAlias: "Gözcü Kabilesi",
      yourAlias: "Kartal Kabilesi",
    });
    assert.equal(copy.titleTr, "İzmir saldırı altında");
    assert.equal(copy.bodyTr, "Gözcü Kabilesi baskı yapıyor. Kartal Kabilesi için savun.");
    assert.equal(copy.titleEn, "İzmir under attack");
    assert.equal(copy.bodyEn, "Gözcü Kabilesi is pushing. Defend for Kartal Kabilesi.");
  });

  it("renders last-24h fight copy (TR/EN)", () => {
    const copy = renderAttackCopy({
      scope: "spent_24h",
      cityName: "Trabzon",
      rivalAlias: "Fırtına Kabilesi",
      yourAlias: "Kartal Kabilesi",
    });
    assert.equal(copy.titleTr, "Trabzon'de savaş");
    assert.match(copy.bodyTr, /Fırtına Kabilesi harcıyor/);
    assert.equal(copy.titleEn, "Fight on Trabzon");
    assert.match(copy.bodyEn, /You backed this fight/);
  });

  it("deep-links to city sheet", () => {
    assert.equal(attackDeepLink("34"), "/map?il=34");
  });

  it("locks product windows", () => {
    assert.equal(SPEND_INTEREST_HOURS, 24);
    assert.equal(COALESCE_WINDOW_SEC, 300);
    assert.equal(NotifTypeAttack, "attack_alert");
  });
});

describe("flip alert copy", () => {
  it("renders flip-loss copy (TR/EN)", () => {
    const copy = renderFlipCopy({
      kind: "loss",
      cityName: "Ankara",
      alias: "Rüzgar Kabilesi",
    });
    assert.equal(copy.titleTr, "Ankara el değiştirdi");
    assert.equal(copy.bodyTr, "Rüzgar Kabilesi öne geçti. Geri al.");
    assert.equal(copy.titleEn, "Ankara flipped");
    assert.equal(copy.bodyEn, "Rüzgar Kabilesi took the lead. Take it back.");
  });

  it("renders flip-gain copy (TR/EN)", () => {
    const copy = renderFlipCopy({
      kind: "gain",
      cityName: "Ankara",
      alias: "Kartal Kabilesi",
    });
    assert.equal(copy.titleTr, "Ankara sizin");
    assert.equal(copy.bodyTr, "Kartal Kabilesi öne geçti. Koru.");
    assert.equal(copy.titleEn, "Ankara is yours");
    assert.equal(copy.bodyEn, "Kartal Kabilesi took the lead. Hold it.");
  });

  it("locks flip notif types", () => {
    assert.equal(NotifTypeFlipGain, "flip_gain");
    assert.equal(NotifTypeFlipLoss, "flip_loss");
  });
});

describe("push worker payload handling", () => {
  it("skips invalid JSON and missing user", async () => {
    const sender = new LogPushSender();
    const db = {
      query: async () => ({ rows: [], rowCount: 0 }),
    } as never;

    const bad = await processNotifPayload(db, "{", sender);
    assert.equal(bad.skipped, "invalid_json");

    const missing = await processNotifPayload(db, JSON.stringify({ type: "attack_alert" }), sender);
    assert.equal(missing.skipped, "missing_user_id");
    assert.equal(sender.sent.length, 0);
  });

  it("delivers to registered device tokens", async () => {
    const sender = new LogPushSender();
    const db = {
      query: async () => ({
        rows: [
          { token: "ExponentPushToken[aaa]", platform: "ios" },
          { token: "web-token-bbb", platform: "web" },
        ],
        rowCount: 2,
      }),
    } as never;

    const result = await processNotifPayload(
      db,
      JSON.stringify({
        type: NotifTypeAttack,
        user_id: "user-1",
        title: "İzmir saldırı altında",
        body: "Savun.",
        data: { deep_link: "/map?il=35", plate: "35" },
      }),
      sender,
    );

    assert.equal(result.delivered, 2);
    assert.equal(result.skipped, null);
    assert.equal(sender.sent.length, 2);
    assert.equal(sender.sent[0]!.title, "İzmir saldırı altında");
    assert.equal(sender.sent[0]!.data.deep_link, "/map?il=35");
  });
});
