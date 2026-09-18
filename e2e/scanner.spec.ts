import { expect, test } from '@playwright/test';

test('captures browser calls once, searches, filters, and restores keyboard focus', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  const panel = page.getByRole('region', { name: 'Log Scanner', exact: true });
  await expect(panel.getByLabel('Search logs')).toBeFocused();
  await expect(panel.getByText('Browser + server connected', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('button', { name: 'Log a message', exact: true }).click();
  await page.getByRole('button', { name: 'Log a warning', exact: true }).click();
  await expect(panel.locator('li').filter({ hasText: 'Hello from the browser' })).toHaveCount(1);
  await panel.getByLabel('Level', { exact: true }).selectOption('warn');
  await expect(panel.locator('li')).toHaveCount(1);
  await expect(panel.locator('li')).toContainText('A development warning');
  await panel.getByLabel('Level', { exact: true }).selectOption('all');
  await panel.getByLabel('Search logs').fill('Hello from');
  await expect(panel.locator('li')).toHaveCount(1);
  await panel.getByLabel('Search logs').fill('nothing matches this');
  await expect(panel.getByText('No matching logs', { exact: true })).toBeVisible();
  await panel.getByLabel('Search logs').press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Log Scanner' })).toBeFocused();
});

test('streams real Node.js logs separately from browser response logs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  const panel = page.getByRole('region', { name: 'Log Scanner', exact: true });
  await expect(panel.getByText('Browser + server connected', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('button', { name: 'Run server check' }).click();
  await panel.getByLabel('Source', { exact: true }).selectOption('server');
  await expect(panel.locator('li').filter({ hasText: 'Node.js received a server check' })).toHaveCount(1);
  await expect(panel.locator('li').filter({ hasText: 'this is server responce' })).toHaveCount(1);
  await expect(panel.locator('li').filter({ hasText: 'send data to server' })).toHaveCount(0);
  await panel.getByLabel('Source', { exact: true }).selectOption('browser');
  await expect(panel.locator('li').filter({ hasText: 'send data to server' })).toHaveCount(1);
  await expect(panel.locator('li').filter({ hasText: 'this is server responce' })).toHaveCount(1);
});

test('inspects object snapshots and copies an entry', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('button', { name: 'Log an object', exact: true }).click();
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  const panel = page.getByRole('region', { name: 'Log Scanner', exact: true });
  const entry = panel.locator('li').filter({ hasText: 'Object inspection' });
  await expect(entry).toHaveCount(1);
  await entry.locator('summary').click();
  await expect(entry.locator('pre').nth(1)).toContainText('[Circular]');
  await expect(entry.locator('pre').nth(2)).toContainText('42n');
  await entry.getByRole('button', { name: 'Copy info entry' }).click();
  await expect(panel.getByText('Log copied to clipboard.', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Object inspection');
});

test('retains bounded history and does not pull the reader away from older entries', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  const panel = page.getByRole('region', { name: 'Log Scanner', exact: true });
  await expect(panel.getByText('Browser + server connected', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('button', { name: 'Send 100 logs' }).click();
  await expect(panel.locator('li')).toHaveCount(100);
  const list = panel.getByLabel('Captured logs', { exact: true });
  await expect.poll(() => list.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(40);
  await list.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Log a warning', exact: true }).click();
  await expect(panel.locator('li')).toHaveCount(101);
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBe(0);
  for (let index = 0; index < 5; index += 1) await page.getByRole('button', { name: 'Send 100 logs' }).click();
  await expect(panel.locator('li')).toHaveCount(500);
});

test('disabled mode does not connect or render, and enabling/disabling cleans up', async ({ page }) => {
  const streams: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/__log-scanner/events')) streams.push(request.url());
  });
  await page.goto('/?disabled');
  await expect(page.getByRole('button', { name: 'Open Log Scanner' })).toHaveCount(0);
  expect(streams).toHaveLength(0);
  await page.getByRole('button', { name: 'Enable scanner' }).click();
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  await expect(page.getByText('Browser + server connected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Disable scanner' }).click();
  await expect(page.getByRole('region', { name: 'Log Scanner', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Log a warning', exact: true }).click();
  await page.getByRole('button', { name: 'Enable scanner' }).click();
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  const panel = page.getByRole('region', { name: 'Log Scanner', exact: true });
  await panel.getByLabel('Source', { exact: true }).selectOption('browser');
  await expect(panel.locator('li').filter({ hasText: 'A development warning' })).toHaveCount(0);
});

test('panel fits a narrow screen and keeps app styles intact', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  const panel = page.getByRole('region', { name: 'Log Scanner', exact: true });
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(812);
  await expect(page.getByRole('heading', { name: 'Console playground' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/playground-mobile.png', fullPage: true });
});

test('desktop panel screenshot', async ({ page }) => {
  await page.goto('/');
  await page.screenshot({ path: 'artifacts/playground-overview.png', fullPage: true });
  await page.getByRole('button', { name: 'Log a message', exact: true }).click();
  await page.getByRole('button', { name: 'Log a warning', exact: true }).click();
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  await expect(page.getByText('Browser + server connected', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/playground-desktop.png', fullPage: true });
});

test('captures real fetch traffic with status, timing, and response body', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  const panel = page.getByRole('region', { name: 'Log Scanner', exact: true });
  await panel.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('button', { name: 'Run server check' }).click();
  await panel.getByLabel('Source', { exact: true }).selectOption('network');

  const entry = panel.locator('li').filter({ hasText: '/api/check' });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('POST');
  await expect(entry).toContainText('200');
  await expect(entry).toContainText(/\d+ ms/);
  await entry.locator('summary').click();
  await expect(entry.getByText('Response body')).toBeVisible();
  await expect(entry.locator('pre').filter({ hasText: 'requestId' })).toBeVisible();

  await page.getByRole('button', { name: 'Fetch a missing route' }).click();
  const missing = panel.locator('li').filter({ hasText: '/api/missing' });
  await expect(missing).toHaveCount(1);
  await expect(missing).toContainText('404');
  // The application's own console output stays out of the network view.
  await expect(panel.locator('li').filter({ hasText: 'send data to server' })).toHaveCount(0);
});

test('collapsing the toolbar returns its height to the log list', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Send 100 logs' }).click();
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  const panel = page.getByRole('region', { name: 'Log Scanner', exact: true });
  const list = panel.getByLabel('Captured logs', { exact: true });

  const before = (await list.boundingBox())!;
  const panelBefore = (await panel.boundingBox())!;
  await panel.getByRole('button', { name: 'Hide filters' }).click();
  await expect(panel.getByLabel('Search logs')).toHaveCount(0);

  const after = (await list.boundingBox())!;
  // The panel keeps its size; the reclaimed toolbar height goes to the list.
  expect((await panel.boundingBox())!.height).toBeCloseTo(panelBefore.height, 0);
  expect(after.height).toBeGreaterThan(before.height + 30);

  await page.reload();
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  await expect(panel.getByRole('button', { name: 'Show filters' })).toBeVisible();
  await expect(panel.getByLabel('Search logs')).toHaveCount(0);
});

test('launcher honours a requested corner', async ({ page }) => {
  await page.goto('/?position=top-left');
  const launcher = page.getByRole('button', { name: 'Open Log Scanner' });
  const box = (await launcher.boundingBox())!;
  expect(box.x).toBeLessThan(60);
  expect(box.y).toBeLessThan(60);
  await launcher.click();
  const panel = page.getByRole('region', { name: 'Log Scanner', exact: true });
  const bounds = (await panel.boundingBox())!;
  // The panel docks under the launcher rather than on top of it.
  expect(bounds.y).toBeGreaterThanOrEqual(box.y + box.height);
});

test('panel geometry survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  const panel = page.getByRole('region', { name: 'Log Scanner', exact: true });
  const handle = page.getByRole('button', { name: 'Move log panel' });
  await handle.focus();
  await handle.press('ArrowLeft');
  await handle.press('ArrowUp');
  const moved = (await panel.boundingBox())!;

  await page.reload();
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  expect((await panel.boundingBox())!).toEqual(moved);
});

test('logo-only launcher renders the inline mark without an image request', async ({ page }) => {
  const imageRequests: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'image') imageRequests.push(request.url());
  });
  await page.goto('/');
  const launcher = page.getByRole('button', { name: 'Open Log Scanner' });
  await expect(launcher).toHaveText('');
  const logo = launcher.getByRole('img', { name: 'Log Scanner' });
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((element) => element.tagName.toLowerCase())).toBe('svg');
  const box = (await logo.boundingBox())!;
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  expect(imageRequests).toHaveLength(0);
});

test('drags and resizes the panel, preserves geometry on reopen, and supports keyboard adjustments', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  const panel = page.getByRole('region', { name: 'Log Scanner', exact: true });
  const initial = (await panel.boundingBox())!;
  const dragHandle = page.getByRole('button', { name: 'Move log panel' });
  const dragBox = (await dragHandle.boundingBox())!;
  await page.mouse.move(dragBox.x + 60, dragBox.y + dragBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragBox.x - 120, dragBox.y + dragBox.height / 2 - 40, { steps: 8 });
  await page.mouse.up();
  let moved = (await panel.boundingBox())!;
  expect(moved.x).toBeCloseTo(initial.x - 180, 0);
  expect(moved.y).toBeCloseTo(initial.y - 40, 0);

  const resizeHandle = page.getByRole('button', { name: 'Resize log panel', exact: true });
  const resizeBox = (await resizeHandle.boundingBox())!;
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 100, resizeBox.y + resizeBox.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  const resized = (await panel.boundingBox())!;
  expect(resized.width).toBeCloseTo(initial.width + 100, 0);
  expect(resized.height).toBeCloseTo(initial.height + 20, 0);

  await page.getByRole('button', { name: 'Close log panel' }).click();
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  expect((await panel.boundingBox())!).toEqual(resized);
  await dragHandle.focus();
  await dragHandle.press('ArrowLeft');
  moved = (await panel.boundingBox())!;
  expect(moved.x).toBeCloseTo(resized.x - 10, 0);
  await resizeHandle.focus();
  await resizeHandle.press('Shift+ArrowLeft');
  expect((await panel.boundingBox())!.width).toBeCloseTo(resized.width - 1, 0);
  await page.screenshot({ path: 'artifacts/panel-moved-resized.png', fullPage: true });
});

test('keeps the panel usable after extreme dragging, resizing, and viewport changes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  const panel = page.getByRole('region', { name: 'Log Scanner', exact: true });
  const dragHandle = page.getByRole('button', { name: 'Move log panel' });
  const dragBox = (await dragHandle.boundingBox())!;
  await page.mouse.move(dragBox.x + 50, dragBox.y + 12);
  await page.mouse.down();
  await page.mouse.move(-1000, -1000, { steps: 5 });
  await page.mouse.up();
  let bounds = (await panel.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);

  const resizeHandle = page.getByRole('button', { name: 'Resize log panel', exact: true });
  let grip = (await resizeHandle.boundingBox())!;
  await page.mouse.move(grip.x + 10, grip.y + 10);
  await page.mouse.down();
  await page.mouse.move(-1000, -1000, { steps: 5 });
  await page.mouse.up();
  bounds = (await panel.boundingBox())!;
  expect(bounds.width).toBe(320);
  expect(bounds.height).toBe(280);
  await expect(panel.getByLabel('Search logs')).toBeVisible();
  await expect(panel.getByLabel('Level', { exact: true })).toBeVisible();
  await expect(panel.getByLabel('Source', { exact: true })).toBeVisible();

  grip = (await resizeHandle.boundingBox())!;
  await page.mouse.move(grip.x + 10, grip.y + 10);
  await page.mouse.down();
  await page.mouse.move(2500, 2000, { steps: 5 });
  await page.mouse.up();
  await page.setViewportSize({ width: 375, height: 667 });
  await expect.poll(async () => {
    const box = (await panel.boundingBox())!;
    return box.x + box.width;
  }).toBeLessThanOrEqual(375);
  bounds = (await panel.boundingBox())!;
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(667);
  await expect(page.getByRole('button', { name: 'Hide Log Scanner' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close log panel' })).toBeVisible();
});

test('enlarges a docked panel from its top-left corner', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  const panel = page.getByRole('region', { name: 'Log Scanner', exact: true });
  const before = (await panel.boundingBox())!;
  const corner = page.getByRole('button', { name: 'Resize log panel from top left', exact: true });
  const grip = (await corner.boundingBox())!;
  await page.mouse.move(grip.x + 10, grip.y + 10);
  await page.mouse.down();
  await page.mouse.move(grip.x - 90, grip.y - 40, { steps: 8 });
  await page.mouse.up();
  const after = (await panel.boundingBox())!;
  expect(after.width).toBeCloseTo(before.width + 100, 0);
  expect(after.height).toBeCloseTo(before.height + 50, 0);
  expect(after.x + after.width).toBeCloseTo(before.x + before.width, 0);
  expect(after.y + after.height).toBeCloseTo(before.y + before.height, 0);
});

test('opens existing history at the latest entry and follows it while resizing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Send 100 logs' }).click();
  await page.getByRole('button', { name: 'Open Log Scanner' }).click();
  const panel = page.getByRole('region', { name: 'Log Scanner', exact: true });
  const list = panel.getByLabel('Captured logs', { exact: true });
  await expect.poll(() => list.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(2);
  const resizeHandle = page.getByRole('button', { name: 'Resize log panel', exact: true });
  await resizeHandle.focus();
  await resizeHandle.press('ArrowUp');
  await expect.poll(() => list.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(2);
});
