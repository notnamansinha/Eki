import { test, expect, type Page, type APIRequestContext, type BrowserContext } from '@playwright/test';

const feedbackStatusGates = new WeakMap<BrowserContext, () => Promise<void>>();

const control = 'http://127.0.0.1:3117';
const evidence = async (request: APIRequestContext) => (await request.get(`${control}/evidence`)).json();
const login = async (page: Page, uid = 'qa_passenger') => {
  await page.getByRole('button', { name: `Sign in ${uid}`, exact: true }).click();
  await expect(page.getByLabel('Verified fixture account')).toHaveText(uid);
};
const select = async (page: Page, name: string, option: string) => {
  const picker = page.getByRole('combobox', { name, exact: true });
  if (await picker.evaluate(element => element.tagName === 'SELECT')) {
    await picker.selectOption({ label: option }); return;
  }
  await picker.click();
  await page.getByRole('option', { name: option, exact: true }).click();
};
const prepareBoarding = async (page: Page, code = 'ABCD2345') => {
  await page.getByRole('button', { name: 'Track Synthetic route', exact: true }).click();
  await select(page, 'Boarding stop', 'Synthetic origin');
  await select(page, 'Destination station', 'Synthetic end');
  await page.getByRole('textbox', { name: 'Boarding code' }).fill(code);
};
const board = async (page: Page) => {
  await prepareBoarding(page);
  const boardButton = page.getByRole('button', { name: 'Board', exact: true });
  expect(await boardButton.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
  })).toBe(true);
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'On board', exact: true })).toBeVisible();
};

test.beforeEach(async ({ context, request, browser }, testInfo) => {
  testInfo.annotations.push({ type: 'browser-version', description: browser.version() });
  const denied: string[] = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && ['3115', '3116', '8085', '9005', '9095'].includes(url.port)) {
      const gate = url.port === '3116' && route.request().method() === 'PATCH' &&
        /^\/api\/v2\/feedback\/[A-Za-z0-9_-]+$/.test(url.pathname) ? feedbackStatusGates.get(context) : undefined;
      if (gate) { feedbackStatusGates.delete(context); await gate(); }
      await route.continue();
    }
    else { denied.push(`${url.protocol}//${url.hostname}:${url.port}`); await route.abort('blockedbyclient'); }
  });
  await context.routeWebSocket('**/*', websocket => {
    const url = new URL(websocket.url());
    if (url.hostname === '127.0.0.1' && ['3115', '9005'].includes(url.port)) websocket.connectToServer();
    else { denied.push(`${url.protocol}//${url.hostname}:${url.port}`); websocket.close(); }
  });
  (context as typeof context & { qaDenied?: string[] }).qaDenied = denied;
  expect((await request.post(`${control}/reset`)).ok()).toBe(true);
});

test('stop rename Escape discards the draft before blur and save', async ({ page, request }) => {
  await page.goto('/?panel=routes'); await login(page, 'qa_admin');
  // Use an idle route: editing the active fixture's route is correctly denied
  // once the real worker has established its service state.
  await page.getByRole('button', { name: 'Add Route', exact: true }).click();
  await page.getByLabel('Display Name', { exact: true }).fill('Synthetic rename route');
  await page.getByLabel('Route ID', { exact: true }).fill('qa_rename_route');
  for (const name of ['origin', 'end']) {
    await page.getByRole('searchbox', { name: 'Search for a stop', exact: true }).fill(`Synthetic ${name}`);
    await page.getByRole('button').filter({ hasText: `Synthetic provider ${name}` }).click();
  }
  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  await expect(page.getByText('Route deployed!', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit route Synthetic rename route', exact: true }).click();
  await page.getByRole('button', { name: /^Synthetic provider origin / }).click();
  const rename = page.getByRole('textbox', { name: 'Rename stop Synthetic provider origin', exact: true });
  await rename.fill('Discard this stop name'); await rename.press('Escape');
  await expect(rename).toHaveCount(0);
  await page.keyboard.press('Tab');
  const saveAcknowledgement = page.waitForResponse(response => response.url().endsWith('/api/routes/qa_rename_route') && response.request().method() === 'PUT', { timeout: 15000 });
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  expect((await saveAcknowledgement).ok()).toBe(true);
  await expect(page.getByText('Route updated!', { exact: true })).toBeVisible();
  expect((await evidence(request)).routes.find((route: { id: string }) => route.id === 'qa_rename_route').stops[0].name).toBe('Synthetic provider origin');
});

test('profile photo decodes and a denied photo shows the accessible fallback', async ({ page, request }) => {
  let token = '';
  page.on('response', async response => {
    if (response.url().includes('accounts:signInWithPassword')) token = (await response.json()).idToken;
  });
  await page.route('**/qa-profile.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="green"/></svg>' }));
  await page.goto('/'); await login(page); await expect.poll(() => token).not.toBe('');
  const setPhoto = async (photoUrl: string) => {
    expect((await request.post('http://127.0.0.1:9095/identitytoolkit.googleapis.com/v1/accounts:update?key=synthetic-emulator-key', { data: { idToken: token, photoUrl } })).ok()).toBe(true);
    await page.evaluate(async () => { const { auth } = await import('/firebase.ts'); await auth.currentUser!.reload(); });
    await page.reload(); await expect(page.getByLabel('Verified fixture account')).toHaveText('qa_passenger');
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
  };
  await setPhoto('http://127.0.0.1:3115/qa-profile.svg');
  await expect.poll(() => page.getByRole('img', { name: 'Profile', exact: true }).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.route('**/qa-profile-denied.svg', route => route.fulfill({ status: 403, body: 'Synthetic denied image' }));
  await setPhoto('http://127.0.0.1:3115/qa-profile-denied.svg');
  await expect(page.getByRole('img', { name: 'Default profile', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Profile', exact: true })).toHaveCount(0);
});
test.afterEach(async ({ context, request, page }, testInfo) => {
  if (!page.isClosed()) {
    const controls = await page.locator('button,input,textarea,select,a,[role="combobox"],[role="option"],[role="tab"]').evaluateAll(elements => elements.filter(element =>
      element.getClientRects().length && !element.closest('[inert],[aria-hidden="true"]')).map(element => ({
      tag: element.tagName.toLowerCase(), role: element.getAttribute('role'),
      name: element.getAttribute('aria-label') || (element as HTMLInputElement).labels?.[0]?.textContent?.trim() || element.getAttribute('placeholder') || element.textContent?.trim().slice(0, 120),
      disabled: element.hasAttribute('disabled'),
    })));
    await testInfo.attach('visible-control-census', { body: Buffer.from(JSON.stringify({ test: testInfo.title, project: testInfo.project.name, controls })), contentType: 'application/json' });
  }
  expect((context as typeof context & { qaDenied?: string[] }).qaDenied).toEqual([]);
  const current = await evidence(request);
  expect(current.transport.enabled).toBe(true);
  expect(current.transport.allowedConnections).toBeGreaterThan(0);
  expect(current.transport.deniedConnections).toBe(0);
  expect(current.providers.externalNetworkExecuted).toBe(false);
  expect(current.providers.deniedRequests).toBe(0);
});

test('route creation recovers from provider quota and lost acknowledgement then reuses geometry and deletes safely', async ({ page, request }) => {
  test.setTimeout(45000);
  await page.goto('/?panel=routes'); await login(page, 'qa_admin');
  await page.getByRole('button', { name: 'Add Route', exact: true }).click();
  await page.getByLabel('Display Name', { exact: true }).fill('Synthetic provider route');
  await page.getByLabel('Route ID', { exact: true }).fill('qa_created_route');
  for (const name of ['origin', 'end']) {
    await page.getByRole('searchbox', { name: 'Search for a stop', exact: true }).fill(`Synthetic ${name}`);
    await page.getByRole('button').filter({ hasText: `Synthetic provider ${name}` }).click();
  }
  expect((await request.post(`${control}/providers/routes/malformed`)).ok()).toBe(true);
  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('invalid geometry');
  expect((await evidence(request)).routes).toHaveLength(1);
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click();
  expect((await request.post(`${control}/providers/routes/rate-limit`)).ok()).toBe(true);
  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Route calculation is busy');
  const failed = await evidence(request);
  expect(failed.routes.map((route: { id: string }) => route.id)).toEqual(['qa_route']);
  expect(failed.providers.calls.filter((call: { provider: string }) => call.provider === 'routes').length).toBeGreaterThan(0);
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click();
  expect((await request.post(`${control}/providers/routes/valid`)).ok()).toBe(true);
  let lost = false;
  await page.route('http://127.0.0.1:3116/api/routes/qa_created_route', async route => {
    if (route.request().method() !== 'PUT' || lost) { await route.continue(); return; }
    lost = true; const response = await route.fetch(); expect(response.status()).toBe(200);
    expect((await response.json()).saved).toBe(true); await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  await expect(page.getByText('Route deployed!', { exact: true })).toBeVisible();
  expect(lost).toBe(true);
  const created = await evidence(request);
  const stored = created.routes.find((route: { id: string }) => route.id === 'qa_created_route');
  expect(stored).toMatchObject({ configVersion: 1, geometryVersion: 1, polylineQuality: 'HIGH_QUALITY' });
  expect(stored.stops.map((stop: { name: string }) => stop.name)).toEqual(['Synthetic provider origin', 'Synthetic provider end']);
  expect(stored.forwardPolyline).not.toBe(stored.reversePolyline);
  expect(created.providers.calls.filter((call: { provider: string; mode: string }) => call.provider === 'routes' && call.mode === 'valid')).toHaveLength(2);
  await page.getByRole('button', { name: 'Edit route Synthetic provider route', exact: true }).click();
  await page.getByLabel('Display Name', { exact: true }).fill('Synthetic renamed route');
  await page.getByRole('button', { name: 'Route colour #EC4899', exact: true }).click();
  const update = page.waitForResponse(response => response.url() === 'http://127.0.0.1:3116/api/routes/qa_created_route' && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  expect(await (await update).json()).toMatchObject({ saved: true, geometryReused: true, configVersion: 2, geometryVersion: 1 });
  await expect(page.getByText('Route updated!', { exact: true })).toBeVisible();
  const renamed = await evidence(request);
  expect(renamed.routes.find((route: { id: string }) => route.id === 'qa_created_route').color).toBe('#EC4899');
  await page.reload(); await expect(page.getByLabel('Verified fixture account')).toHaveText('qa_admin');
  await page.getByRole('button', { name: 'Edit route Synthetic renamed route', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Route colour #EC4899', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Cancel route editing', exact: true }).click();
  expect(renamed.providers.calls).toEqual(created.providers.calls);
  expect(renamed.routes.find((route: { id: string }) => route.id === 'qa_created_route').forwardPolyline).toBe(stored.forwardPolyline);
  await page.getByRole('button', { name: 'Delete route Synthetic renamed route', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await evidence(request)).routes).toHaveLength(2);
  await page.getByRole('button', { name: 'Delete route Synthetic renamed route', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Route', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit route Synthetic renamed route', exact: true })).toHaveCount(0);
  expect((await evidence(request)).routes.map((route: { id: string }) => route.id)).toEqual(['qa_route']);
});

test('Places provider quota and actual abort deadline surface recoverable errors without adding a stop', async ({ page, request }, testInfo) => {
  await page.goto('/?panel=routes'); await login(page, 'qa_admin');
  await page.getByRole('button', { name: 'Add Route', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search for a stop', exact: true });
  expect((await request.post(`${control}/providers/places/rate-limit`)).ok()).toBe(true);
  await search.fill(`Synthetic quota query ${testInfo.project.name}`);
  await expect(page.getByRole('alert')).toContainText('busy');
  expect((await request.post(`${control}/providers/places/timeout`)).ok()).toBe(true);
  await search.fill(`Synthetic deadline query ${testInfo.project.name}`);
  await expect(page.getByRole('alert')).toContainText('too long', { timeout: 10000 });
  expect((await evidence(request)).routes).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Deploy', exact: true })).toBeDisabled();
  expect((await request.post(`${control}/providers/places/valid`)).ok()).toBe(true);
  await search.fill(`Synthetic new origin query ${testInfo.project.name}`);
  await page.getByRole('button').filter({ hasText: 'Synthetic provider origin' }).click();
  await expect(page.getByRole('button', { name: 'Deploy', exact: true })).toBeDisabled();
  const calls = (await evidence(request)).providers.calls;
  expect(calls.map((call: { mode: string }) => call.mode)).toEqual(['rate-limit', 'timeout', 'valid']);
});

test('boards through real auth API and persistence then restores one membership on reload', async ({ page, request }) => {
  await page.goto('/'); await login(page); await board(page);
  const before = await evidence(request);
  expect(before.passengerIds).toEqual(['qa_passenger']);
  expect(Object.keys(before.passengers)).toEqual(['qa_passenger']);
  expect(before.passengers.qa_passenger).toMatchObject({ userId: 'qa_passenger', boardingStopId: 'origin', alightingStopId: 'end' });
  await page.reload();
  await expect(page.getByLabel('Verified fixture account')).toHaveText('qa_passenger');
  await expect(page.getByRole('button', { name: 'On board', exact: true })).toBeVisible();
  expect((await evidence(request)).passengers.qa_passenger.joinedAt).toEqual(before.passengers.qa_passenger.joinedAt);
});

test('rejects a wrong code without a manifest write and permits a corrected retry', async ({ page, request }) => {
  await page.goto('/'); await login(page); await prepareBoarding(page, 'ZZZZ2345');
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('boarding code is invalid');
  expect((await evidence(request)).passengerIds).toEqual([]);
  await page.getByRole('textbox', { name: 'Boarding code' }).fill('ABCD2345');
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByRole('button', { name: 'On board', exact: true })).toBeVisible();
});

test('rejects distant geolocation without a manifest or optimistic success', async ({ page, context, request }) => {
  await context.setGeolocation({ latitude: 23.02, longitude: 72, accuracy: 5 });
  await page.goto('/'); await login(page); await prepareBoarding(page);
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('near the bus');
  expect((await evidence(request)).passengerIds).toEqual([]);
  await expect(page.getByRole('button', { name: 'On board', exact: true })).toHaveCount(0);
});

test('chat reconciles a lost acknowledgement into one durable message and listener delivery', async ({ page, request }) => {
  await page.goto('/'); await login(page); await board(page);
  await page.getByRole('button', { name: 'Open live chat', exact: true }).click();
  let loseOnce = true;
  await page.route('http://127.0.0.1:3116/api/sessions/qa_session/messages', async route => {
    if (!loseOnce) { await route.continue(); return; }
    loseOnce = false;
    const response = await route.fetch(); expect(response.status()).toBe(201);
    await route.abort('failed');
  });
  await page.getByRole('textbox', { name: 'Chat message' }).fill('Synthetic hello <script>text only</script>');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Message could not be sent. Please try again.')).toBeVisible();
  expect((await evidence(request)).messages).toHaveLength(1);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('textbox', { name: 'Chat message' })).toHaveValue('');
  await expect(page.getByText('Synthetic hello <script>text only</script>', { exact: true })).toBeVisible();
  expect((await evidence(request)).messages).toHaveLength(1);
  await page.getByRole('button', { name: 'Close chat' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('feedback confirms persistence and enforces cooldown after reopening the real modal', async ({ page, request }) => {
  await page.goto('/'); await login(page);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Send Feedback', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Submit Feedback' })).toBeDisabled();
  await page.getByRole('textbox').fill('Synthetic suggestion only.');
  await page.getByRole('button', { name: 'Submit Feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
  expect((await evidence(request)).feedbacks).toEqual([expect.objectContaining({ userId: 'qa_passenger', type: 'general', comment: 'Synthetic suggestion only.' })]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Send Feedback', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /^Wait / })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('profile cancellation preserves auth and confirmation signs out the real emulator account', async ({ page }) => {
  await page.goto('/'); await login(page);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Verified fixture account')).toHaveText('qa_passenger');
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Verified fixture account')).toHaveText('signed out');
  await expect(page.getByRole('heading', { name: 'Guest', exact: true })).toBeVisible();
});

test('accepted account deletion signs out on dismissal and the real worker preserves ride feedback and messages', async ({ page, request }) => {
  test.setTimeout(45000);
  let retiredAuthorization = '';
  page.on('request', request => {
    if (request.url().endsWith('/api/v2/privacy-deletion-requests')) retiredAuthorization = request.headers().authorization;
  });
  await page.goto('/'); await login(page); await board(page);
  await page.getByRole('button', { name: 'Open live chat', exact: true }).click();
  await page.getByRole('textbox', { name: 'Chat message' }).fill('Retained synthetic message');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('textbox', { name: 'Chat message' })).toHaveValue('');
  await page.getByRole('button', { name: 'Close chat' }).click();
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Send Feedback', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Retained synthetic feedback');
  await page.getByRole('button', { name: 'Submit Feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const before = await evidence(request);
  expect(before.messages).toHaveLength(1); expect(before.feedbacks).toHaveLength(1);
  await page.getByRole('button', { name: 'Delete Account', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete Account?', exact: true });
  expect(await confirmation.evaluate(element => element.parentElement === document.body)).toBe(true);
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Verified fixture account')).toHaveText('qa_passenger');
  await page.getByRole('button', { name: 'Delete Account', exact: true }).click();
  const acknowledged = page.waitForResponse(response => response.url().endsWith('/api/v2/privacy-deletion-requests') && response.request().method() === 'POST');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Account', exact: true }).click();
  const response = await acknowledged; expect(response.status()).toBe(202); expect(await response.json()).toMatchObject({ accepted: true });
  const accepted = page.getByRole('dialog', { name: 'Deletion requested', exact: true });
  await expect(accepted).toBeVisible(); await expect(accepted.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(page.getByLabel('Verified fixture account')).toHaveText('qa_passenger');
  await accepted.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByLabel('Verified fixture account')).toHaveText('signed out');
  await expect(page.getByRole('heading', { name: 'Guest', exact: true })).toBeVisible();
  expect((await request.post(`${control}/privacy/drain`)).ok()).toBe(true);
  const snapshot = await (await request.get(`${control}/authorization-snapshot`)).json();
  expect(snapshot.principals.some((account: { uid: string }) => account.uid === 'qa_passenger')).toBe(false);
  for (const collection of ['users', 'feedbackCooldowns', '_privacy_deletion_requests']) {
    expect(snapshot.documents[collection].some((document: { id: string }) => document.id === 'qa_passenger')).toBe(false);
  }
  expect(snapshot.rateLimitCount).toBe(0);
  expect(retiredAuthorization).toMatch(/^Bearer /);
  const headers = { Authorization: retiredAuthorization };
  // 403 from the handler (rather than verifier 401) proves the still-cached
  // token reached the profile fence after Auth retirement.
  expect((await request.get('http://127.0.0.1:3116/api/sessions/qa_session/status', { headers })).status()).toBe(403);
  expect((await request.post('http://127.0.0.1:3116/api/sessions/qa_session/messages', {
    headers, data: { text: 'Retired account must not write', requestId: 'retired_message_12345678' },
  })).status()).toBe(403);
  expect((await request.put('http://127.0.0.1:3116/api/v2/ride-sessions/qa_session/passengers/me', {
    headers, data: { boardingCode: 'ABCD2345', boardingStopId: 'origin', alightingStopId: 'end' },
  })).status()).toBe(403);
  expect((await request.post('http://127.0.0.1:3116/api/feedback', {
    headers, data: { type: 'general', comment: 'Retired account must not write', requestId: 'retired_feedback_12345678' },
  })).status()).toBe(403);
  expect((await request.post('http://127.0.0.1:3116/api/users/bootstrap', { headers })).status()).toBe(401);
  const retired = await (await request.get(`${control}/authorization-snapshot`)).json();
  expect(retired.rateLimitCount).toBe(0);
  expect(retired.documents.users.some((document: { id: string }) => document.id === 'qa_passenger')).toBe(false);
  expect(retired.documents.feedbackCooldowns).toEqual([]);
  const after = await evidence(request);
  expect(after.passengers).toEqual(before.passengers); expect(after.passengerIds).toEqual(before.passengerIds);
  expect(after.feedbacks).toEqual(before.feedbacks); expect(after.messages).toEqual(before.messages);
});

test('failed account deletion exposes the error and preserves sign-in for a corrected retry', async ({ page }) => {
  await page.goto('/'); await login(page);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  let malformed = false;
  await page.route('http://127.0.0.1:3116/api/v2/privacy-deletion-requests', route => route.fulfill({
    status: malformed ? 202 : 503, contentType: 'application/json',
    body: malformed ? '{"accepted":false}' : '{"error":"Synthetic deletion service unavailable"}',
  }));
  for (const failure of ['service', 'acknowledgement']) {
    malformed = failure === 'acknowledgement';
    await page.getByRole('button', { name: 'Delete Account', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete Account', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: malformed ? 'acknowledgement is missing' : 'Synthetic deletion service unavailable' })).toBeVisible();
    await expect(page.getByLabel('Verified fixture account')).toHaveText('qa_passenger');
  }
  await page.getByRole('button', { name: 'Delete Account', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Delete Account?', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('admin settings save persists and a passenger cannot enter the same panel', async ({ page, request }) => {
  await page.goto('/?panel=settings'); await login(page, 'qa_admin');
  await expect(page.getByRole('button', { name: 'No changes' })).toBeDisabled();
  await page.getByLabel('Service Start Time', { exact: true }).fill('7:30 am');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved!' })).toBeVisible();
  expect((await evidence(request)).settings).toMatchObject({ serviceStartTime: '7:30 am', updatedBy: 'qa_admin' });
  await login(page, 'qa_passenger');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0);
  expect((await evidence(request)).settings.serviceStartTime).toBe('7:30 am');
});

test('all six actual admin panels mount through pointer and roving keyboard navigation', async ({ page }) => {
  await page.goto('/?panel=admin'); await login(page, 'qa_admin');
  for (const name of ['Live Ops', 'Routes', 'Fleet & People', 'History', 'Feedback', 'Settings']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name, exact: true })).toHaveCount(1);
    await expect(page.getByText('Loading fixture view…')).toHaveCount(0);
  }
  await page.getByRole('tab', { name: 'Settings', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Live Ops', exact: true })).toBeFocused();
  await page.getByRole('tab', { name: 'Live Ops', exact: true }).press('End');
  await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toBeFocused();
  await page.getByRole('tab', { name: 'Settings', exact: true }).press('Home');
  await expect(page.getByRole('tab', { name: 'Live Ops', exact: true })).toBeFocused();
});

test('admin vehicle create edit cancel and delete persist through real authorization and listeners', async ({ page, request }) => {
  await page.goto('/?panel=fleet'); await login(page, 'qa_admin');
  await page.getByRole('textbox', { name: 'New vehicle Bus ID', exact: true }).fill('qa_new');
  await page.getByRole('textbox', { name: 'New vehicle display name', exact: true }).fill('Synthetic new vehicle');
  const assignment = page.getByRole('checkbox', { name: 'Synthetic route', exact: true });
  await assignment.focus(); await assignment.press('Space'); await expect(assignment).toBeChecked();
  await page.getByRole('button', { name: 'Add new vehicle', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit vehicle Synthetic new vehicle', exact: true })).toBeVisible();
  expect((await evidence(request)).buses.find((bus: { id: string }) => bus.id === 'qa_new')).toMatchObject({ name: 'Synthetic new vehicle', assignedRoutes: ['qa_route'] });
  await page.getByRole('button', { name: 'Edit vehicle Synthetic new vehicle', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit vehicle display name', exact: true }).fill('Unsaved draft');
  await page.getByRole('button', { name: 'Cancel editing vehicle', exact: true }).click();
  expect((await evidence(request)).buses.find((bus: { id: string }) => bus.id === 'qa_new').name).toBe('Synthetic new vehicle');
  await page.getByRole('button', { name: 'Delete vehicle Synthetic new vehicle', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await evidence(request)).buses.some((bus: { id: string }) => bus.id === 'qa_new')).toBe(true);
  await page.getByRole('button', { name: 'Delete vehicle Synthetic new vehicle', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Vehicle', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit vehicle Synthetic new vehicle', exact: true })).toHaveCount(0);
  expect((await evidence(request)).buses.some((bus: { id: string }) => bus.id === 'qa_new')).toBe(false);
});

test('actual route editor keeps identity immutable and cancels a local rename without a write', async ({ page }) => {
  await page.goto('/?panel=routes'); await login(page, 'qa_admin');
  await page.getByRole('button', { name: 'Edit route Synthetic route', exact: true }).click();
  await expect(page.getByLabel('Route ID', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /^Synthetic origin / }).click();
  await page.getByRole('textbox', { name: 'Rename stop Synthetic origin', exact: true }).fill('Unsaved origin');
  await page.getByRole('textbox', { name: 'Rename stop Synthetic origin', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Cancel route editing', exact: true }).click();
  await page.getByRole('button', { name: 'Edit route Synthetic route', exact: true }).click();
  await page.getByRole('button', { name: /^Synthetic origin / }).click();
  await expect(page.getByRole('textbox', { name: 'Rename stop Synthetic origin', exact: true })).toHaveValue('Synthetic origin');
});

test('10m stop arrival updates the real passenger timeline only after authenticated telemetry reaches the circle', async ({ page, request }, testInfo) => {
  await page.goto('/'); await login(page); await board(page);
  const timeline = page.getByRole('button', { name: 'Route Timeline', exact: true });
  await timeline.click();
  const nextStop = page.getByText('Next Stop', { exact: true }).locator('..');
  const outside = await request.post(`${control}/telemetry/middle-outside`);
  expect(outside.ok()).toBe(true); expect((await outside.json()).statuses).toEqual([202]);
  await expect(nextStop).toContainText('Synthetic middle');
  expect((await evidence(request)).live.currentStopIndex).toBe(1);
  const inside = await request.post(`${control}/telemetry/middle-inside`);
  expect(inside.ok()).toBe(true); expect((await inside.json()).statuses).toEqual([202]);
  await expect(nextStop).toContainText('Synthetic end');
  const stored = await evidence(request);
  expect(stored.live.currentStopIndex).toBe(2);
  expect(stored.sessions.find((ride: { id: string }) => ride.id === 'qa_session').status).toBe('active');
  await page.screenshot({ path: testInfo.outputPath('arrival-10m-next-stop.png'), fullPage: true });
  await testInfo.attach('arrival-boundary', { body: JSON.stringify({ outsideMeters: 11, insideMeters: 9,
    currentStopIndex: stored.live.currentStopIndex, physicalGnss: false, providers: 'synthetic' }), contentType: 'application/json' });
  // Reuse the fixture immediately, without browser/sign-in delays masking a
  // backwards sample clock in the next journey's telemetry controller.
  expect((await request.post(`${control}/reset`)).ok()).toBe(true);
  const restarted = await request.post(`${control}/telemetry/middle`);
  expect(restarted.ok(), await restarted.text()).toBe(true);
  expect((await restarted.json()).statuses).toEqual([202, 202]);
  expect((await evidence(request)).live.currentStopIndex).toBe(2);
});

test('authenticated telemetry completes the joined ride and arms a distinct return while feedback and history retain identity', async ({ page, request, context }) => {
  test.setTimeout(60000);
  await page.goto('/'); await login(page); await board(page);
  const chatResult = await page.evaluate(async () => {
    const { auth } = await import('/firebase.ts');
    const token = await auth.currentUser!.getIdToken();
    const response = await fetch('http://127.0.0.1:3116/api/sessions/qa_session/messages', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Synthetic journey message retained in history.', requestId: 'routing_history_chat_12345678' }),
    });
    return { status: response.status, token };
  });
  expect(chatResult.status).toBe(201);
  const joined = (await evidence(request)).passengers.qa_passenger;
  const middle = await request.post(`${control}/telemetry/middle`);
  expect(middle.ok()).toBe(true); expect((await middle.json()).statuses).toEqual([202, 202]);
  await expect.poll(async () => (await evidence(request)).live.currentStopIndex).toBe(2);
  const end = await request.post(`${control}/telemetry/end`);
  const terminalResult = await end.json();
  expect(end.ok(), JSON.stringify(terminalResult)).toBe(true); expect(terminalResult.statuses).toEqual([202, 202, 202]);
  await expect(page.getByText('Route ended', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => (await evidence(request)).sessions.filter((ride: { automaticTurnaround?: boolean }) => ride.automaticTurnaround).length,
    { timeout: 15000 }).toBe(1);
  const completed = await evidence(request);
  const original = completed.sessions.find((ride: { id: string }) => ride.id === 'qa_session');
  const returning = completed.sessions.find((ride: { automaticTurnaround?: boolean }) => ride.automaticTurnaround);
  expect(original).toMatchObject({ status: 'completed', direction: 'forward', passengerIds: ['qa_passenger'] });
  expect(original.passengers.qa_passenger).toEqual(joined);
  expect(original.lastKnownLocation).toMatchObject({ lat: 23.0036, lng: 72 });
  expect(completed.messages).toEqual([expect.objectContaining({ text: 'Synthetic journey message retained in history.' })]);
  expect(returning).toMatchObject({ direction: 'reverse', previousSessionId: 'qa_session', passengers: {} });
  expect(returning.status).toBe('armed');
  expect(completed.live).toMatchObject({ direction: 'reverse', tripState: 'pre_departure', hasDepartedOrigin: false });
  expect(returning.id).not.toBe('qa_session');
  expect(completed.lock.sessionId).toBe(returning.id);
  expect(completed.completions).toEqual([expect.objectContaining({ id: 'qa_session', sessionId: 'qa_session', direction: 'forward' })]);
  await expect(page.getByRole('heading', { name: 'Rate your ride', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('dialog').getByRole('textbox').fill('Synthetic completed ride feedback.');
  await page.getByRole('button', { name: 'Submit Feedback', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thank you!', exact: true })).toBeVisible();
  expect((await evidence(request)).feedbacks).toEqual([expect.objectContaining({ userId: 'qa_passenger', type: 'ride',
    sessionId: 'qa_session', busId: 'qa_bus', driverId: 'qa_driver' })]);
  await page.goto('/?panel=history'); await login(page, 'qa_admin');
  const cleared = await page.evaluate(async () => {
    const { auth } = await import('/firebase.ts');
    const token = await auth.currentUser!.getIdToken();
    const response = await fetch('http://127.0.0.1:3116/api/shifts/qa_session/messages', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  });
  expect(cleared).toEqual({ status: 200, body: { deleted: 1 } });
  const archivedReplay = await request.post('http://127.0.0.1:3116/api/sessions/qa_session/messages', {
    headers: { Authorization: `Bearer ${chatResult.token}` },
    data: { text: 'Synthetic journey message retained in history.', requestId: 'routing_history_chat_12345678' },
  });
  expect(archivedReplay.status()).toBe(200);
  const archived = await evidence(request);
  expect(archived.messages).toHaveLength(0);
  expect(archived.archivedMessages).toEqual([expect.objectContaining({ text: 'Synthetic journey message retained in history.' })]);
  const row = page.getByRole('button').filter({ hasText: 'Completed' });
  await expect(row).toHaveCount(1); await row.click();
  const details = page.locator('#ride-history-details-qa_session');
  await expect(details).toContainText('qa_passenger');
  await expect(details).toContainText('Synthetic origin'); await expect(details).toContainText('Synthetic end');
  await expect(details).toContainText('Synthetic journey message retained in history.');
  await expect(details).toContainText('Last received GNSS: 23.003600, 72.000000');
  await page.reload();
  await expect(page.getByLabel('Verified fixture account')).toHaveText('qa_admin');
  await expect(page.getByRole('button').filter({ hasText: 'Completed' })).toHaveCount(1);
  expect((await evidence(request)).sessions.find((ride: { id: string }) => ride.id === returning.id).passengers).toEqual({});
  await page.getByRole('button').filter({ hasText: 'Completed' }).click();
  await page.getByRole('button', { name: 'Delete ride history', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await evidence(request)).completions).toHaveLength(1);
  await page.getByRole('button', { name: 'Delete ride history', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Permanently delete', exact: true }).click();
  await expect(page.getByText('Ride history deleted.', { exact: true })).toBeVisible();
  const deleted = await evidence(request);
  expect(deleted.sessions.map((ride: { id: string }) => ride.id)).toEqual([returning.id]);
  expect(deleted.completions).toEqual([]); expect(deleted.lock.sessionId).toBe(returning.id);
  expect(deleted.archivedMessages).toEqual([]);
  await page.goto('/?panel=feedback');
  const feedbackCard = page.getByRole('button').filter({ hasText: 'Synthetic completed ride feedback.' });
  await feedbackCard.click();
  let statusRequestPending = false;
  let releaseStatusWrite: () => void = () => {};
  const statusWriteGate = new Promise<void>(resolve => { releaseStatusWrite = resolve; });
  feedbackStatusGates.set(context, async () => {
    statusRequestPending = true;
    await statusWriteGate;
  });
  try {
    await page.getByRole('button', { name: 'reviewed', exact: true }).click();
    await expect.poll(() => statusRequestPending).toBe(true);
    await expect(page.getByRole('button', { name: 'reviewed', exact: true })).toBeDisabled();
    // Pending disable is not a confirmed write: no request has reached Express yet.
    expect((await evidence(request)).feedbacks[0].status).toBe('new');
  } finally { feedbackStatusGates.delete(context); releaseStatusWrite(); }
  await expect.poll(async () => (await evidence(request)).feedbacks[0].status).toBe('reviewed');
  await expect(feedbackCard).toContainText('reviewed');
  await expect(page.getByRole('button', { name: 'resolved', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'resolved', exact: true }).click();
  await expect.poll(async () => (await evidence(request)).feedbacks[0].status).toBe('resolved');
  await expect(feedbackCard).toContainText('resolved');
  await expect(page.getByRole('button', { name: 'resolved', exact: true })).toBeDisabled();
});

test('admin operator creation edit cancellation and deletion update real claims without changing a running operator', async ({ page, request }) => {
  await page.goto('/?panel=fleet'); await login(page, 'qa_admin');
  await page.getByRole('textbox', { name: 'New vehicle Bus ID', exact: true }).fill('qa_spare');
  await page.getByRole('textbox', { name: 'New vehicle display name', exact: true }).fill('Synthetic spare');
  await page.getByRole('button', { name: 'Add new vehicle', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit vehicle Synthetic spare', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'New operator ID', exact: true }).fill('qa_operator');
  await page.getByRole('textbox', { name: 'New operator display name', exact: true }).fill('Synthetic new operator');
  await page.getByRole('textbox', { name: 'Firebase Auth UID for new operator', exact: true }).fill('qa_other');
  await select(page, 'Assign vehicle to new operator', 'Synthetic spare (qa_spare)');
  const rejectedAcknowledgement = page.waitForResponse(response => response.url() === 'http://127.0.0.1:3116/api/fleet/drivers/qa_operator'
    && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Add new operator', exact: true }).click();
  expect((await rejectedAcknowledgement).status()).toBe(400);
  await expect(page.getByText('Failed to add Operator: Assigned bus must have at least one valid route.', { exact: true })).toBeVisible();
  expect((await evidence(request)).drivers.map((driver: { id: string }) => driver.id)).toEqual(['qa_driver']);
  expect((await evidence(request)).otherAccountClaims).toEqual({ role: 'passenger' });
  await page.getByRole('button', { name: 'Edit vehicle Synthetic spare', exact: true }).click();
  const allowedRoute = page.getByRole('textbox', { name: 'Edit vehicle display name', exact: true }).locator('..')
    .getByRole('checkbox', { name: 'Synthetic route', exact: true });
  await allowedRoute.focus(); await allowedRoute.press('Space'); await expect(allowedRoute).toBeChecked();
  await page.getByRole('button', { name: 'Save vehicle changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel editing vehicle', exact: true })).toHaveCount(0);
  const acknowledgement = page.waitForResponse(response => response.url() === 'http://127.0.0.1:3116/api/fleet/drivers/qa_operator'
    && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Add new operator', exact: true }).click();
  const saved = await acknowledgement; expect(saved.status()).toBe(200); expect(await saved.json()).toEqual({ saved: true });
  await expect(page.getByRole('button', { name: 'Edit operator Synthetic new operator', exact: true })).toBeVisible();
  const created = await evidence(request);
  expect(created.drivers.find((driver: { id: string }) => driver.id === 'qa_operator')).toMatchObject({ authUid: 'qa_other', assignedBusId: 'qa_spare' });
  expect(created.otherAccountClaims).toMatchObject({ role: 'driver', driverId: 'qa_operator', assignedBusId: 'qa_spare' });
  await page.getByRole('button', { name: 'Edit operator Synthetic new operator', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit operator display name', exact: true }).fill('Unsaved operator draft');
  await page.getByRole('button', { name: 'Cancel editing operator', exact: true }).click();
  expect((await evidence(request)).drivers.find((driver: { id: string }) => driver.id === 'qa_operator').name).toBe('Synthetic new operator');
  await page.getByRole('button', { name: 'Delete operator Synthetic new operator', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await evidence(request)).otherAccountClaims.role).toBe('driver');
  await page.getByRole('button', { name: 'Delete operator Synthetic new operator', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Operator', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit operator Synthetic new operator', exact: true })).toHaveCount(0);
  const removed = await evidence(request);
  expect(removed.otherAccountClaims).toEqual({ role: 'passenger', authorizationVersion: expect.any(String) });
  expect(removed.otherAccountClaims.authorizationVersion).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  expect(removed.otherAccountClaims.authorizationVersion).not.toBe(created.otherAccountClaims.authorizationVersion);
  expect(removed.drivers.map((driver: { id: string }) => driver.id)).toEqual(['qa_driver']);
  expect(removed.lock.sessionId).toBe('qa_session');
});

test('admin live service controls persist bounded delay and interrupt safely before a distinct restart', async ({ page, request }) => {
  await page.goto('/?panel=ops'); await login(page, 'qa_admin');
  await page.getByRole('button', { expanded: false }).filter({ hasText: 'Synthetic bus' }).click();
  const saveDelay = async (buttonName: string, delayMinutes: number) => {
    // Match the start-service oracle below: observe the actual request before
    // starting the UI assertion window. A pending request is not a failed toast.
    const acknowledgement = page.waitForResponse(response =>
      response.url() === 'http://127.0.0.1:3116/api/shifts/delay'
        && response.request().method() === 'PATCH', { timeout: 15_000 });
    await page.getByRole('button', { name: buttonName, exact: true }).click();
    const response = await acknowledgement;
    const result = await response.json();
    const stored = await evidence(request);
    expect(response.status(), JSON.stringify({ acknowledgement: result, live: stored.live })).toBe(200);
    expect(result).toMatchObject({ saved: true, delayMinutes });
    await expect(page.getByText(`Delay updated to ${delayMinutes} minutes for qa_bus.`, { exact: true })).toBeVisible();
    expect(stored.live.delayMinutes).toBe(delayMinutes);
  };
  await saveDelay('Decrease delay by 1 minutes for qa_bus', 0);
  await saveDelay('Increase delay by 1 minutes for qa_bus', 1);
  await saveDelay('Decrease delay by 1 minutes for qa_bus', 0);
  await page.getByRole('button', { name: 'Boarding code', exact: true }).click();
  await expect(page.getByRole('button', { name: /^[A-Z0-9]{4}-[A-Z0-9]{4}$/ })).toBeVisible();
  await page.getByRole('button', { name: 'End ride early', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Keep running', exact: true }).click();
  expect((await evidence(request)).sessions.find((ride: { id: string }) => ride.id === 'qa_session').status).toBe('active');
  await page.getByRole('button', { name: 'End ride early', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'End ride', exact: true }).click();
  await expect(page.getByText('Ride qa_session ended early and was saved to history.', { exact: true })).toBeVisible();
  expect((await evidence(request)).sessions.find((ride: { id: string }) => ride.id === 'qa_session').status).toBe('interrupted');
  const movingAfterEnd = await request.post(`${control}/telemetry/moving-after-end`);
  expect(movingAfterEnd.ok()).toBe(true);
  expect((await movingAfterEnd.json()).statuses).toEqual([202]);
  await expect.poll(async () => {
    const stored = await evidence(request);
    return {
      status: stored.sessions.find((ride: { id: string }) => ride.id === 'qa_session').status,
      reason: stored.sessions.find((ride: { id: string }) => ride.id === 'qa_session').interruptionReason,
      activeRide: stored.activeRide, lock: stored.lock,
      seq: stored.live?.seq, sessionId: stored.live?.sessionId ?? null,
      publicSession: stored.publicRoute?.buses?.['node:qa_bus_qa_route']?.sessionId ?? null,
      publicDeviceState: stored.publicRoute?.buses?.['node:qa_bus_qa_route']?.deviceState,
      deviceState: stored.live?.deviceState,
    };
  }, { timeout: 10_000 }).toEqual({ status: 'interrupted', reason: 'manual_end_early', activeRide: null,
    lock: null, seq: 6, sessionId: null, publicSession: null, publicDeviceState: 'online', deviceState: 'online' });
  // A slow worker may legitimately age the original seed beyond the real
  // sixty-second arm policy. Supply a new authenticated fix before restarting.
  const freshFix = await request.post(`${control}/telemetry/fresh-origin`);
  expect(freshFix.ok()).toBe(true); expect((await freshFix.json()).statuses).toEqual([202]);
  await select(page, 'Operator', 'Synthetic operator (qa_driver)');
  await expect(page.getByRole('combobox', { name: 'Assigned vehicle', exact: true })).toBeDisabled();
  // The API has a ten-second request budget. Observe its acknowledgement before
  // checking the UI, rather than treating a valid pending request as a failure
  // after Playwright's default five-second assertion window.
  const startAcknowledgement = page.waitForResponse(response =>
    response.url() === 'http://127.0.0.1:3116/api/v2/ride-sessions'
      && response.request().method() === 'POST', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Start service', exact: true }).click();
  const startResponse = await startAcknowledgement;
  const startResult = await startResponse.json();
  const startEvidence = startResponse.ok() ? null : await evidence(request);
  expect(startResponse.ok(), JSON.stringify({ acknowledgement: startResult, live: startEvidence?.live, lock: startEvidence?.lock })).toBe(true);
  expect(startResult.sessionId).toEqual(expect.any(String));
  expect(startResult.resumed).not.toBe(true);
  await expect(page.getByText(/^Service started /)).toBeVisible();
  const restarted = await evidence(request);
  const fresh = restarted.sessions.find((ride: { id: string }) => ride.id !== 'qa_session');
  expect(fresh.id).toBe(startResult.sessionId);
  expect(fresh).toMatchObject({ busId: 'qa_bus', driverId: 'qa_driver', routeId: 'qa_route', passengers: {} });
  expect(restarted.sessions).toHaveLength(2); expect(restarted.lock.sessionId).toBe(fresh.id);
  expect(restarted.completions).toEqual([]);
});
