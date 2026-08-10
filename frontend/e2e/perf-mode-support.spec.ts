import { expect, Page, test } from "@playwright/test";

const TRIBE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function consentGrantedPayload() {
  return {
    consents: {
      aydinlatma_metni: {
        published_version: "v1",
        body_text: "Test aydınlatma metni",
        granted: true,
        consent_version: "v1",
        granted_at: new Date().toISOString(),
      },
      acik_riza_location: {
        published_version: "v1",
        body_text: "Test konum açık rıza metni",
        granted: true,
        consent_version: "v1",
        granted_at: new Date().toISOString(),
      },
      terms_of_service: {
        published_version: "v1",
        body_text: "Test ToS",
        granted: null,
        consent_version: null,
        granted_at: null,
      },
    },
  };
}

const minimalStyle = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#1a2a24" },
    },
  ],
};

const minimalGeoJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        il_code: "34",
        name_tr: "İstanbul",
        name_en: "Istanbul",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [28.5, 40.8],
            [29.5, 40.8],
            [29.5, 41.4],
            [28.5, 41.4],
            [28.5, 40.8],
          ],
        ],
      },
    },
  ],
};

async function seedSessionAndPerf(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cc_session_token", "test-session-token");
    localStorage.setItem("cc_user_id", "00000000-0000-4000-8000-000000000001");
    localStorage.setItem("cc_perf_mode", "on");
  });
}

async function mockMapAPIs(page: Page) {
  let supportCalls = 0;

  await page.route("**/styles/liberty**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(minimalStyle),
    });
  });
  await page.route("**/style.json**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(minimalStyle),
    });
  });

  await page.route("**/v1/consent/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(consentGrantedPayload()),
    });
  });

  await page.route("**/v1/tribes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tribes: [
          {
            id: TRIBE_ID,
            slug: "test-tribe",
            display_name: "Test Tribe",
            short_name: "TST",
            primary_color: "#336699",
            secondary_color: "#99aabb",
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        membership: {
          tribe_id: TRIBE_ID,
          tribe_switched_at: null,
          switch_available_at: null,
        },
      }),
    });
  });

  await page.route("**/v1/credits/balance", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ balance: 1000 }),
    });
  });

  await page.route("**/v1/cities", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cities: [
          {
            id: "34",
            name: "İstanbul",
            centroid: { lng: 28.9, lat: 41.0 },
            controlling_tribe: {
              tribe_id: TRIBE_ID,
              primary_color: "#336699",
            },
            competing_tribes: [
              { tribe_id: TRIBE_ID, committed_credits: 100 },
            ],
          },
        ],
      }),
    });
  });

  await page.route("**/v1/provinces/geojson", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(minimalGeoJSON),
    });
  });

  await page.route("**/v1/provinces/control", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provinces: [
          {
            il_code: "34",
            leading_tribe_id: TRIBE_ID,
            control_pct: 40,
            effective_support_sum: 100,
            primary_color: "#336699",
            refreshed_at: new Date().toISOString(),
          },
        ],
      }),
    });
  });

  await page.route("**/v1/support", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    supportCalls += 1;
    const body = route.request().postDataJSON() as {
      il_code: string;
      credits: number;
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        support_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        il_code: body.il_code,
        credits_spent: body.credits,
        multiplier: 1,
        effective_support: body.credits,
        tribe_id: TRIBE_ID,
        balance_after: 990,
      }),
    });
  });

  return {
    getSupportCalls: () => supportCalls,
  };
}

test.describe("perf mode support", () => {
  test("perf mode still allows province select and support spend", async ({
    page,
  }) => {
    await seedSessionAndPerf(page);
    const api = await mockMapAPIs(page);

    await page.goto("/map?il=34");

    await expect(page.getByTestId("map-screen")).toBeVisible();
    await expect(page.getByTestId("province-map")).toHaveAttribute(
      "data-perf-mode",
      "on",
    );
    await expect(page.getByTestId("province-map")).toHaveAttribute(
      "data-map-ready",
      "true",
      { timeout: 30_000 },
    );

    await expect(page.getByText("İstanbul")).toBeVisible();
    await page.locator("#support-credits").fill("25");
    await page.getByRole("button", { name: /Destekle|Support/ }).click();

    await expect(
      page.getByText(/İstanbul için 25 kredi|Supported İstanbul with 25/),
    ).toBeVisible({ timeout: 10_000 });
    expect(api.getSupportCalls()).toBe(1);
  });
});
