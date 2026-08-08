import { expect, Page, test } from "@playwright/test";

async function mockPhoneRegisterAPI(page: Page) {
  await page.route("**/v1/auth/otp/request", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "sent" }),
    });
  });
  await page.route("**/v1/auth/otp/verify", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "verified" }),
    });
  });
  await page.route("**/v1/auth/register", async (route) => {
    const body = route.request().postDataJSON() as {
      phone: string;
      username: string;
      birth_date: string;
    };
    expect(body.birth_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user_id: "11111111-1111-1111-1111-111111111111",
        session_token: "test-session",
        restricted_mode: body.birth_date > "2008-01-01",
      }),
    });
  });
}

test("register requires birth date and shows underage notice", async ({
  page,
}) => {
  await mockPhoneRegisterAPI(page);
  await page.goto("/register");

  await page.getByLabel("Cep telefonu").fill("05321234567");
  await page.getByRole("button", { name: "Kod gönder" }).click();
  await page.getByLabel("Doğrulama kodu").fill("123456");
  await page.getByRole("button", { name: "Doğrula" }).click();

  await page.getByLabel("Kullanıcı adı").fill("Oyuncu_01");
  await expect(page.getByLabel("Doğum tarihi")).toBeVisible();

  // Under-18 DOB relative to 2026 test env — use a clearly young date.
  await page.getByLabel("Doğum tarihi").fill("2012-06-15");
  await expect(page.getByTestId("underage-notice")).toBeVisible();

  await page.getByRole("button", { name: "Hesabı oluştur" }).click();
  await expect(page).toHaveURL(/\/consent/);
});

test("social login merge requires OTP confirmation", async ({ page }) => {
  let mergeCalled = false;
  let linkedWithoutOTP = false;

  await page.addInitScript(() => {
    (
      window as unknown as { __ccSocialIdToken: string }
    ).__ccSocialIdToken = "stub-id-token";
  });

  await page.route("**/v1/auth/social/login", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "error_merge_required",
        merge_token: "merge-tok-e2e",
        phone_hint: "+905******567",
      }),
    });
  });

  await page.route("**/v1/auth/otp/request", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "sent" }),
    });
  });

  await page.route("**/v1/auth/otp/verify", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "verified" }),
    });
  });

  await page.route("**/v1/auth/social/merge", async (route) => {
    mergeCalled = true;
    const body = route.request().postDataJSON() as {
      merge_token: string;
      phone: string;
    };
    expect(body.merge_token).toBe("merge-tok-e2e");
    expect(body.phone).toMatch(/^\+90/);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user_id: "22222222-2222-2222-2222-222222222222",
        session_token: "merged-session",
        restricted_mode: false,
      }),
    });
  });

  // Guard: ensure login response never auto-issued a session before merge.
  await page.goto("/register");
  await page.getByTestId("social-google").click();
  await expect(page).toHaveURL(/\/social-merge/);
  await expect(page.getByText(/otomatik birleştirme/i)).toBeVisible();

  const tokenBefore = await page.evaluate(() =>
    localStorage.getItem("cc_session_token"),
  );
  if (tokenBefore) linkedWithoutOTP = true;
  expect(linkedWithoutOTP).toBe(false);
  expect(mergeCalled).toBe(false);

  await page.getByTestId("merge-phone").fill("05321234567");
  await page.getByRole("button", { name: "Kod gönder" }).click();
  await page.getByTestId("merge-otp").fill("654321");
  await page.getByTestId("merge-confirm").click();

  await expect(page).toHaveURL(/\/consent/);
  expect(mergeCalled).toBe(true);
  const tokenAfter = await page.evaluate(() =>
    localStorage.getItem("cc_session_token"),
  );
  expect(tokenAfter).toBe("merged-session");
});
