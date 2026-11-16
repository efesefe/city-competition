import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ShareKindAccomplishment,
  ShareKindSupport,
  accomplishmentPayloadFrom,
  renderShareCopy,
  renderShareSvg,
  supportPayloadFrom,
  toPublicView,
} from "./share.js";

describe("static share copy", () => {
  it("renders support template (TR/EN, public_alias)", () => {
    const payload = supportPayloadFrom({
      plate: "34",
      cityName: "İstanbul",
      tribeId: "sl_basaksehir",
    });
    const copy = renderShareCopy({ kind: ShareKindSupport, payload });
    assert.equal(payload.alias, "Baykuş Kabilesi");
    assert.match(copy.lineTr, /Baykuş Kabilesi İstanbul için destek verdi/);
    assert.match(copy.lineEn, /Baykuş Kabilesi supported İstanbul/);
    assert.equal(copy.title, "City Competition");
  });

  it("marks boosted support", () => {
    const payload = supportPayloadFrom({
      plate: "06",
      cityName: "Ankara",
      tribeId: "sl_besiktas",
      boosted: true,
    });
    const copy = renderShareCopy({ kind: ShareKindSupport, payload });
    assert.match(copy.lineEn, /boosted support/);
    assert.match(copy.lineTr, /güçlendirilmiş destek/);
  });

  it("renders took-city accomplishment", () => {
    const payload = accomplishmentPayloadFrom({
      variant: "took_city",
      tribeId: "sl_amed",
      plate: "21",
      cityName: "Diyarbakır",
    });
    const copy = renderShareCopy({ kind: ShareKindAccomplishment, payload });
    assert.equal(payload.alias, "Sur Kabilesi");
    assert.match(copy.lineEn, /Sur Kabilesi took Diyarbakır\. Season 0/);
    assert.match(copy.lineTr, /Sur Kabilesi Diyarbakır'ı aldı/);
  });

  it("renders cities-owned accomplishment", () => {
    const payload = accomplishmentPayloadFrom({
      variant: "cities_owned",
      tribeId: "sl_erzurumspor",
      citiesOwned: 12,
    });
    const copy = renderShareCopy({ kind: ShareKindAccomplishment, payload });
    assert.match(copy.lineEn, /Dadaş Kabilesi — 12 cities owned/);
    assert.match(copy.lineTr, /12 şehir/);
  });
});

describe("static share svg", () => {
  it("includes brand hero and support line", () => {
    const payload = supportPayloadFrom({
      plate: "35",
      cityName: "İzmir",
      tribeId: "sl_goztepe",
    });
    const view = toPublicView({
      id: "abc123",
      userId: "u1",
      kind: ShareKindSupport,
      payload,
      createdAt: new Date().toISOString(),
    });
    const svg = renderShareSvg(view);
    assert.match(svg, /City Competition/);
    assert.match(svg, /Gözcü Kabilesi/);
    assert.match(svg, /İzmir/);
    assert.equal(view.sharePath, "/share/abc123");
    assert.equal(view.cardSvgPath, "/v1/share/abc123/card.svg");
    assert.equal(view.deepLink, "/map?il=35");
  });
});
