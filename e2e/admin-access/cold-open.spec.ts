import { expect, test, type Page } from "@playwright/test";
// Cold-open auth restoration. `?restoreHang` holds the synthetic SDK's first
// auth state, authStateReady() and getRedirectResult until a fixture control
// finishes restoration; page.clock crosses the 8 s / 10 s marks deterministically.
// `?landing` mounts the actual landing page; without it the actual RoleGuard
// protects the admin feedback panel. AuthProvider is the production hook.
const T0 = new Date("2026-10-28T08:00:00+05:30").getTime();
const IPHONE = {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
};
const entry = { id: "feedback", userId: "passenger", userName: "Browser Passenger", type: "general", busId: null,
  driverId: null, sessionId: null, rating: null, comment: "Browser verification", timestamp: null, status: "new" };
type QaWindow = Window & { qaAuthCalls: Array<{ name: string; resolver: boolean }>; qaRouterReplacements: string[]; qaSawAccessError: boolean };

const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on("pageerror", error => errors.push(error.message));
  // "Never" means never rendered, not merely absent when sampled.
  await page.addInitScript(() => {
    Object.assign(window, { qaSawAccessError: false });
    new MutationObserver(() => {
      if (document.body?.textContent?.includes("Access could not be verified")) Object.assign(window, { qaSawAccessError: true });
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
});
test.afterEach(() => { expect(errors).toEqual([]); });

async function coldOpen(page: Page, path: string, redirectPending = false) {
  if (redirectPending) await page.addInitScript(() => sessionStorage.setItem("eki:google-redirect-pending", "true"));
  // Freeze virtual time before the document exists so every auth timer is
  // scheduled at a known instant; nothing fires until runFor advances it.
  await page.clock.install({ time: T0 });
  await page.clock.pauseAt(T0 + 500);
  await page.goto(path);
}
const authCalls = (page: Page) => page.evaluate(() => (window as unknown as QaWindow).qaAuthCalls);
const replacements = (page: Page) => page.evaluate(() => [...new Set((window as unknown as QaWindow).qaRouterReplacements)]);
const sawAccessError = (page: Page) => page.evaluate(() => (window as unknown as QaWindow).qaSawAccessError);
const accessError = (page: Page) => page.getByText("Access could not be verified");
const stillChecking = (page: Page) => page.getByRole("status").filter({ hasText: "Still checking your sign-in" });
const hero = (page: Page) => page.getByRole("heading", { name: /Campus routes/ });
const signIn = (page: Page) => page.getByRole("button", { name: "Sign In with Google" });
const preparing = (page: Page) => page.getByRole("button", { name: /Preparing sign-in/ });
const reload = (page: Page) => page.getByRole("button", { name: "Reload", exact: true });

async function expectLandingUsableWhileSlow(page: Page) {
  await expect(stillChecking(page)).toBeVisible();
  await expect(reload(page)).toBeVisible();
  await expect(hero(page)).toBeVisible();
  await expect(accessError(page)).toHaveCount(0);
}

test("signed-out cold open with a hung restore enables sign-in at once, explains the delay after 8 s and clears it in place", async ({ page }) => {
  await coldOpen(page, "/?landing&restoreHang");
  await page.clock.runFor(1_000);
  await expect(hero(page)).toBeVisible();
  await expect(signIn(page)).toBeEnabled();
  await expect(accessError(page)).toHaveCount(0);
  await page.clock.runFor(6_500); // 7.5 s: not yet slow
  await expect(stillChecking(page)).toHaveCount(0);
  await expect(signIn(page)).toBeEnabled();
  await page.clock.runFor(1_000); // 8.5 s
  await expectLandingUsableWhileSlow(page);
  await expect(signIn(page)).toBeEnabled();
  await page.clock.runFor(2_000); // 10.5 s: past the role-verification and stall marks
  await expectLandingUsableWhileSlow(page);
  await expect(signIn(page)).toBeEnabled();
  await page.getByRole("button", { name: "Finish restoration as signed out" }).click();
  await expect(stillChecking(page)).toHaveCount(0);
  await expect(hero(page)).toBeVisible();
  await expect(signIn(page)).toBeEnabled();
  expect(await replacements(page)).toEqual([]);
  // No pending redirect: getRedirectResult must not be awaited at all.
  expect(await authCalls(page)).toEqual([]);
  await signIn(page).click();
  await expect.poll(() => authCalls(page)).toEqual([{ name: "signInWithPopup", resolver: true }]);
  expect(await sawAccessError(page)).toBe(false);
});

test("a pending Google redirect keeps the button preparing until restoration finishes", async ({ page }) => {
  await coldOpen(page, "/?landing&restoreHang", true);
  await page.clock.runFor(1_000);
  await expect(preparing(page)).toBeDisabled();
  await expect(signIn(page)).toHaveCount(0);
  await expect.poll(() => authCalls(page)).toEqual([{ name: "getRedirectResult", resolver: true }]);
  await page.clock.runFor(7_500); // 8.5 s
  await expectLandingUsableWhileSlow(page);
  await expect(preparing(page)).toBeDisabled();
  await page.clock.runFor(2_000); // 10.5 s
  await expectLandingUsableWhileSlow(page);
  await expect(preparing(page)).toBeDisabled();
  await page.getByRole("button", { name: "Finish restoration as signed out" }).click();
  await expect(signIn(page)).toBeEnabled();
  await expect(preparing(page)).toHaveCount(0);
  await expect(stillChecking(page)).toHaveCount(0);
  expect(await sawAccessError(page)).toBe(false);
});

for (const outcome of ["admin", "signed out"] as const) {
  test(`a protected route under a hung restore says it is still signing in, stays closed and recovers in place (${outcome})`, async ({ page }) => {
    const reads: string[] = [];
    await page.route("**/__qa/firestore/feedback**", route => { reads.push(route.request().url()); return route.fulfill({ json: { feedbacks: [entry] } }); });
    await coldOpen(page, "/?restoreHang");
    await page.clock.runFor(1_000);
    await expect(page.getByText("Signing you in…")).toBeVisible();
    await expect(page.getByText("Still signing you in")).toHaveCount(0);
    for (const step of [7_500, 2_000]) { // 8.5 s, then 10.5 s
      await page.clock.runFor(step);
      await expect(page.getByText("Still signing you in")).toBeVisible();
      await expect(reload(page)).toBeVisible();
      await expect(accessError(page)).toHaveCount(0);
      await expect(page.getByText("Browser Passenger")).toHaveCount(0);
      expect(reads).toEqual([]);
    }
    if (outcome === "admin") {
      await page.getByRole("button", { name: "Finish restoration as admin" }).click();
      // Restored is not verified: protected children stay unmounted until the role check passes.
      await expect(page.getByRole("button", { name: "Approve verification" })).toBeEnabled();
      await expect(page.getByText("Browser Passenger")).toHaveCount(0);
      expect(reads).toEqual([]);
      await page.getByRole("button", { name: "Approve verification" }).click();
      await expect(page.getByText("Browser Passenger")).toBeVisible();
      expect(reads).toHaveLength(1);
    } else {
      await page.getByRole("button", { name: "Finish restoration as signed out" }).click();
      await expect.poll(() => replacements(page)).toEqual(["/"]);
      await expect(page.getByText("Browser Passenger")).toHaveCount(0);
      expect(reads).toEqual([]);
    }
    await expect(page.getByText("Still signing you in")).toHaveCount(0);
    expect(await sawAccessError(page)).toBe(false);
  });
}

test.describe("on an iPhone", () => {
  test.use(IPHONE);

  test("reopening signed out with a hung restore leaves a working sign-in and a delay notice", async ({ page }) => {
    await coldOpen(page, "/?landing&restoreHang");
    await page.clock.runFor(1_000);
    await expect(signIn(page)).toBeEnabled();
    await page.clock.runFor(7_500); // 8.5 s
    await expectLandingUsableWhileSlow(page);
    await expect(signIn(page)).toBeEnabled();
    await expect(signIn(page)).toBeInViewport();
    // A same-origin auth helper on a phone uses full-page sign-in. The tap is
    // accepted during restoration; the redirect may start at once or once the
    // restored state is known, but it must start, with the shared resolver.
    await signIn(page).tap();
    await page.getByRole("button", { name: "Finish restoration as signed out" }).click();
    await expect.poll(() => authCalls(page)).toEqual([{ name: "signInWithRedirect", resolver: true }]);
    await expect(stillChecking(page)).toHaveCount(0);
    expect(await sawAccessError(page)).toBe(false);
  });

  test("a passenger restore finishing after 8 s proceeds to the passenger workspace", async ({ page }) => {
    await coldOpen(page, "/?landing&restoreHang");
    await page.clock.runFor(8_500);
    await expectLandingUsableWhileSlow(page);
    await page.getByRole("button", { name: "Finish restoration as passenger" }).click();
    await expect(stillChecking(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Approve verification" }).click();
    await expect(page.getByText("Opening your workspace…")).toBeVisible();
    await expect.poll(() => replacements(page)).toEqual(["/passenger"]);
    expect(await sawAccessError(page)).toBe(false);
  });
});
