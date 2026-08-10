import { expect, Page, test } from "@playwright/test";

type ConsentState = {
  aydinlatma: boolean | null;
  location: boolean | null;
};

function consentPayload(state: ConsentState) {
  return {
    consents: {
      aydinlatma_metni: {
        published_version: "v1",
        body_text: "Test aydınlatma metni",
        granted: state.aydinlatma,
        consent_version: state.aydinlatma ? "v1" : null,
        granted_at: state.aydinlatma ? new Date().toISOString() : null,
      },
      acik_riza_location: {
        published_version: "v1",
        body_text: "Test konum açık rıza metni",
        granted: state.location,
        consent_version: state.location ? "v1" : null,
        granted_at: state.location ? new Date().toISOString() : null,
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

const TRIBE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function mockShellAPIs(page: Page) {
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
      body: JSON.stringify({ cities: [] }),
    });
  });
}

async function mockConsentAPI(page: Page, initial: ConsentState) {
  const state = { ...initial };

  await page.addInitScript(() => {
    (window as unknown as { __geoCalls?: number }).__geoCalls = 0;
    const geo = {
      getCurrentPosition(
        _success: PositionCallback,
        error?: PositionErrorCallback,
      ) {
        const w = window as unknown as { __geoCalls?: number };
        w.__geoCalls = (w.__geoCalls ?? 0) + 1;
        error?.({
          code: 1,
          message: "blocked in test",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        } as GeolocationPositionError);
      },
      watchPosition() {
        return 0;
      },
      clearWatch() {},
    };
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      get: () => geo,
    });
  });

  await mockShellAPIs(page);

  await page.route("**/v1/consent/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(consentPayload(state)),
    });
  });

  await page.route("**/v1/consent/grant", async (route) => {
    const body = route.request().postDataJSON() as {
      consent_type: string;
      consent_version: string;
      granted?: boolean;
    };
    const granted = body.granted !== false;
    if (body.consent_type === "aydinlatma_metni") {
      state.aydinlatma = granted;
    }
    if (body.consent_type === "acik_riza_location") {
      state.location = granted;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        consent_type: body.consent_type,
        consent_version: body.consent_version,
        granted,
      }),
    });
  });

  return {
    getGeoCalls: async () =>
      page.evaluate(
        () => (window as unknown as { __geoCalls?: number }).__geoCalls ?? 0,
      ),
  };
}

async function seedSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cc_session_token", "test-session-token");
    localStorage.setItem("cc_user_id", "00000000-0000-4000-8000-000000000001");
  });
}

test.describe("KVKK consent gate", () => {
  test("map is blocked until both consents are granted", async ({ page }) => {
    await seedSession(page);
    const api = await mockConsentAPI(page, {
      aydinlatma: null,
      location: null,
    });

    await page.goto("/map");

    await expect(page.getByTestId("consent-modal")).toBeVisible();
    await expect(page.getByTestId("map-screen")).toHaveCount(0);
    await expect(page.locator(".map-canvas")).toHaveCount(0);
    expect(await api.getGeoCalls()).toBe(0);

    // Only disclosure checked — submit stays disabled / map still blocked.
    await page.getByTestId("check-aydinlatma").check();
    await expect(page.getByTestId("consent-submit")).toBeDisabled();
    await expect(page.getByTestId("map-screen")).toHaveCount(0);

    await page.getByTestId("check-location").check();
    await expect(page.getByTestId("consent-submit")).toBeEnabled();
    await page.getByTestId("consent-submit").click();

    await expect(page.getByTestId("map-screen")).toBeVisible();
    await expect(page.getByTestId("consent-modal")).toHaveCount(0);
    expect(await api.getGeoCalls()).toBe(0);
  });

  test("partial prior consent still blocks the map", async ({ page }) => {
    await seedSession(page);
    await mockConsentAPI(page, {
      aydinlatma: true,
      location: null,
    });

    await page.goto("/map");

    await expect(page.getByTestId("consent-modal")).toBeVisible();
    await expect(page.getByTestId("map-screen")).toHaveCount(0);
  });

  test("both consents already granted shows map", async ({ page }) => {
    await seedSession(page);
    await mockConsentAPI(page, {
      aydinlatma: true,
      location: true,
    });

    await page.goto("/");
    await expect(page).toHaveURL(/\/map/);
    await expect(page.getByTestId("map-screen")).toBeVisible();
    await expect(page.getByTestId("consent-modal")).toHaveCount(0);
  });
});
