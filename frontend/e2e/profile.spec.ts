import { expect, Page, test } from "@playwright/test";

const TRIBE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_TRIBE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
        granted: true,
        consent_version: "v1",
        granted_at: new Date().toISOString(),
      },
    },
  };
}

async function seedSession(
  page: Page,
  opts: { restricted?: boolean } = {},
) {
  const restricted = opts.restricted ?? false;
  await page.addInitScript((isRestricted) => {
    localStorage.setItem("cc_session_token", "test-session-token");
    localStorage.setItem("cc_user_id", "00000000-0000-4000-8000-000000000001");
    localStorage.setItem("cc_restricted_mode", isRestricted ? "1" : "0");
  }, restricted);
}

async function mockProfileAPIs(page: Page) {
  const page1 = [
    {
      id: "s1",
      il_code: "34",
      tribe_id: TRIBE_ID,
      credits_spent: 25,
      multiplier: 2,
      effective_support: 50,
      created_at: "2026-03-01T12:00:00Z",
    },
    {
      id: "s2",
      il_code: "06",
      tribe_id: TRIBE_ID,
      credits_spent: 10,
      multiplier: 1,
      effective_support: 10,
      created_at: "2026-02-28T12:00:00Z",
    },
  ];
  const page2 = [
    {
      id: "s2",
      il_code: "06",
      tribe_id: TRIBE_ID,
      credits_spent: 10,
      multiplier: 1,
      effective_support: 10,
      created_at: "2026-02-28T12:00:00Z",
    },
    {
      id: "s3",
      il_code: "35",
      tribe_id: OTHER_TRIBE,
      credits_spent: 5,
      multiplier: 1,
      effective_support: 5,
      created_at: "2026-02-27T12:00:00Z",
    },
  ];

  await page.route("**/v1/consent/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(consentGrantedPayload()),
    });
  });

  await page.route("**/v1/consent/withdraw", async (route) => {
    const body = route.request().postDataJSON() as {
      consent_type: string;
      consent_version: string;
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        consent_type: body.consent_type,
        consent_version: body.consent_version,
        granted: false,
        withdrawn_at: new Date().toISOString(),
      }),
    });
  });

  await page.route("**/v1/account/erasure-request", async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        job_id: "job-1",
        status: "pending",
        request_id: "req-1",
      }),
    });
  });

  await page.route("**/v1/me/push-tokens", async (route) => {
    await route.fulfill({ status: 204, body: "" });
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
            member_count: 42,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: OTHER_TRIBE,
            slug: "other",
            display_name: "Other Tribe",
            short_name: "OTH",
            primary_color: "#993366",
            secondary_color: "#bbaa99",
            is_active: true,
            member_count: 10,
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
      body: JSON.stringify({ balance: 1250 }),
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
            competing_tribes: [],
          },
          {
            id: "06",
            name: "Ankara",
            centroid: { lng: 32.8, lat: 39.9 },
            controlling_tribe: null,
            competing_tribes: [],
          },
          {
            id: "35",
            name: "İzmir",
            centroid: { lng: 27.1, lat: 38.4 },
            controlling_tribe: null,
            competing_tribes: [],
          },
        ],
      }),
    });
  });

  await page.route("**/v1/me/supports**", async (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get("offset") ?? "0");
    if (offset === 0) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ supports: page1, next_offset: 2 }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ supports: page2, next_offset: null }),
    });
  });
}

test.describe("profile screen", () => {
  test("support history pagination never duplicates rows", async ({ page }) => {
    await seedSession(page);
    await mockProfileAPIs(page);
    await page.goto("/profile");

    await expect(page.getByTestId("profile-screen")).toBeVisible();
    await expect(page.getByTestId("profile-history-row")).toHaveCount(2);

    await page.getByTestId("profile-history-more").click();
    await expect(page.getByTestId("profile-history-row")).toHaveCount(3);

    const ids = await page
      .locator("[data-testid=profile-history-row]")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-support-id")),
      );
    expect(ids).toEqual(["s1", "s2", "s3"]);
    await expect(page.getByTestId("profile-history-derbi")).toHaveCount(1);
  });

  test("consent withdraw and erasure call backend and show success", async ({
    page,
  }) => {
    await seedSession(page);
    await mockProfileAPIs(page);

    let withdrawHits = 0;
    let erasureHits = 0;
    await page.route("**/v1/consent/withdraw", async (route) => {
      withdrawHits += 1;
      const body = route.request().postDataJSON() as {
        consent_type: string;
        consent_version: string;
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          consent_type: body.consent_type,
          consent_version: body.consent_version,
          granted: false,
          withdrawn_at: new Date().toISOString(),
        }),
      });
    });
    await page.route("**/v1/account/erasure-request", async (route) => {
      erasureHits += 1;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          job_id: "job-1",
          status: "pending",
          request_id: "req-1",
        }),
      });
    });

    page.on("dialog", (dialog) => dialog.accept());

    await page.goto("/profile");
    await expect(page.getByTestId("profile-settings")).toBeVisible();

    await page
      .getByTestId("profile-consent-withdraw-aydinlatma_metni")
      .click();
    await expect(page.getByTestId("profile-consent-success")).toBeVisible();
    expect(withdrawHits).toBeGreaterThan(0);

    await page.getByTestId("profile-erasure-submit").click();
    await expect(page.getByTestId("profile-erasure-success")).toBeVisible();
    expect(erasureHits).toBe(1);
  });

  test("restricted mode omits tribe chat entry point", async ({ page }) => {
    await seedSession(page, { restricted: true });
    await mockProfileAPIs(page);
    await page.goto("/profile");

    await expect(page.getByTestId("profile-screen")).toBeVisible();
    await expect(page.getByTestId("profile-restricted-banner")).toBeVisible();
    await expect(page.getByTestId("profile-tribe-badge")).toBeVisible();
    await expect(page.getByTestId("profile-wallet")).toBeVisible();
    await expect(page.getByTestId("profile-tribe-chat")).toHaveCount(0);
  });

  test("non-restricted profile shows tribe chat link", async ({ page }) => {
    await seedSession(page, { restricted: false });
    await mockProfileAPIs(page);
    await page.goto("/profile");
    await expect(page.getByTestId("profile-tribe-chat")).toBeVisible();
  });
});
