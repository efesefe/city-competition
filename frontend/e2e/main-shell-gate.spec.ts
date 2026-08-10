import { expect, test } from "@playwright/test";

test.describe("main shell session gate", () => {
  test("visiting /map without a session redirects to register", async ({
    page,
  }) => {
    await page.goto("/map");
    await expect(page).toHaveURL(/\/register/);
  });

  test("visiting /leaderboard without a session redirects to register", async ({
    page,
  }) => {
    await page.goto("/leaderboard");
    await expect(page).toHaveURL(/\/register/);
  });

  test("visiting /profile without a session redirects to register", async ({
    page,
  }) => {
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/register/);
  });

  test("root redirects toward map (then onboarding without session)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/(map|register)/);
  });
});
