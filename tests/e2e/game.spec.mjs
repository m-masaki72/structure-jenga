import { test, expect } from '@playwright/test';

const canonical = 'https://m-masaki72.github.io/structure-jenga/';
async function openGame(page) {
  await page.goto('/?seed=17');
  await expect
    .poll(() => page.evaluate(() => window.structureStudy?.snapshot().ready), { timeout: 30000 })
    .toBe(true);
  await expect(page.locator('#startup-error')).toBeHidden();
}

test('public metadata and bundled assets are present', async ({ page, request }) => {
  await openGame(page);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonical);
  const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
  expect(ld['@type']).toBe('VideoGame');
  expect(ld.url).toBe(canonical);
  for (const asset of [
    '/favicon.svg',
    '/apple-touch-icon.png',
    '/images/ogp.jpg',
    '/sitemap.xml',
    '/robots.txt',
  ]) {
    expect((await request.get(asset)).ok(), asset).toBe(true);
  }
  const missing = await request.get('/missing-page');
  expect(missing.status()).toBe(404);
  const recovery = await request.get('/404.html');
  expect(await recovery.text()).toContain('ゲームに戻る');
});

test('game starts without API or external asset requests', async ({ page }, testInfo) => {
  const failures = [],
    errors = [],
    unexpected = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(response.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.includes('/api/') ||
      (url.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(url.hostname))
    )
      unexpected.push(request.url());
  });
  await openGame(page);
  await expect(page.locator('#structure-viewport canvas')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});

test('share links and clipboard fallback work on a narrow screen', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openGame(page);
  for (const label of ['Xで共有（新しいタブで開く）', 'LINEで共有（新しいタブで開く）']) {
    const link = page.getByRole('link', { name: label });
    expect(new URL(await link.getAttribute('href')).searchParams.get('url')).toBe(canonical);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  await page.locator('#copy-link').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(canonical);
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error('blocked');
    };
  });
  await page.locator('#copy-link').click();
  await expect(page.locator('#share-url')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});

test('blocked storage does not prevent playing', async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem', 'removeItem'])
      Storage.prototype[method] = () => {
        throw new Error('Storage blocked');
      };
  });
  await openGame(page);
  await expect(page.locator('#structure-viewport canvas')).toBeVisible();
});

test('failed module loading offers reload and disables gameplay', async ({ page }) => {
  await page.route('**/js/structure.js', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('#startup-error')).toBeVisible();
  expect(await page.locator('main').evaluate((node) => node.inert)).toBe(true);
});

test('clearing data affects only this game and reloads another tab', async ({ page, context }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openGame(page);
  const other = await context.newPage();
  await other.setViewportSize({ width: 800, height: 600 });
  await other.route('**/js/structure.js', (route) => route.abort());
  await other.goto('/');
  await expect(other.locator('#startup-error')).toBeVisible();
  await page.evaluate(() => localStorage.setItem('another-game-record', 'preserve'));
  const reloaded = other.waitForEvent('load');
  page.once('dialog', (dialog) => dialog.accept());
  await Promise.all([page.waitForEvent('load'), page.locator('#clear-saved-data').click()]);
  await reloaded;
  await expect(other.locator('#startup-error')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('another-game-record'))).toBe('preserve');
});

test('keyboard probes and removes a member', async ({ page }) => {
  await openGame(page);
  const viewport = page.locator('#structure-viewport');
  await viewport.focus();
  await viewport.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.structureStudy.snapshot().selected)).not.toBeNull();
  const probes = await page.evaluate(() => window.structureStudy.snapshot().probes);
  await viewport.press('Space');
  await expect
    .poll(() => page.evaluate(() => window.structureStudy.snapshot().probes))
    .toBeGreaterThan(probes);
  await viewport.press('x');
  await expect.poll(() => page.evaluate(() => window.structureStudy.snapshot().removed.length)).toBe(1);
});

test('architecture and audio preferences survive reload', async ({ page }, testInfo) => {
  await openGame(page);
  await page.locator('#sound-toggle').click();
  await page.locator('#settings-open').click();
  await page.locator('[data-chapter="初級"]').click();
  await page.locator('[data-level="cube"]').click();
  await page.locator('#setup-apply').click();
  await expect.poll(() => page.evaluate(() => window.structureStudy.snapshot().level)).toBe('cube');
  await page.screenshot({ path: testInfo.outputPath('architecture.png'), fullPage: true });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => window.structureStudy?.snapshot().ready), { timeout: 30000 })
    .toBe(true);
  expect(await page.evaluate(() => window.structureStudy.snapshot().level)).toBe('cube');
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
});
