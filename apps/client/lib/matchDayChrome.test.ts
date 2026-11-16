import assert from "node:assert/strict";
import { boostPctLabel, selectBannerEvent, selectSpotlightPlates } from "./matchDayChrome";
import type { MatchDayEvent } from "./api";

function event(partial: Partial<MatchDayEvent> & Pick<MatchDayEvent, "id" | "teamId">): MatchDayEvent {
  const now = Date.now();
  return {
    teamAlias: "Aslan Kabilesi",
    teamColor: "#A90432",
    boostPct: 1.25,
    spotlightPlate: "34",
    cityNameTr: "İstanbul",
    label: "test",
    startsAt: new Date(now - 60_000).toISOString(),
    endsAt: new Date(now + 3_600_000).toISOString(),
    ...partial,
  };
}

const a = event({ id: "a", teamId: "sl_galatasaray" });
const b = event({
  id: "b",
  teamId: "sl_fenerbahce",
  spotlightPlate: "06",
  cityNameTr: "Ankara",
  endsAt: new Date(Date.now() + 7_200_000).toISOString(),
});

assert.equal(selectBannerEvent([a, b], "sl_galatasaray")?.id, "a");
assert.equal(selectBannerEvent([a, b], null), null);
assert.deepEqual([...selectSpotlightPlates([a, b])].sort(), ["06", "34"]);
assert.equal(boostPctLabel(1.25), "+25%");

const expired = event({
  id: "x",
  teamId: "sl_galatasaray",
  endsAt: new Date(Date.now() - 1000).toISOString(),
});
assert.equal(selectBannerEvent([expired], "sl_galatasaray"), null);
assert.equal(selectSpotlightPlates([expired]).size, 0);

console.log("matchDayChrome.test.ts ok");
