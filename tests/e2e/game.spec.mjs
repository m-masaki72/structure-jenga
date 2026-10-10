import { test, expect } from '@playwright/test';
import { replayRound } from '../../dist/js/structure-game.js';
import { dailyLevel } from '../../dist/js/structure-levels.js';

const canonical = 'https://structure-jenga.morilab-garage.com/';
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
  expect(ld.publisher.url).toBe('https://morilab-garage.com/');
  await expect(page.locator('h1')).toHaveText('LESS, STILL. — 構造分解');
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
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) errors.push(message.text());
  });
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

test('the first stage guides each step and stays closed once dismissed', async ({ page, context }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openGame(page);
  const coach = () => page.evaluate(() => window.structureStudy.snapshot().coach);
  await expect(page.locator('#coach')).toBeVisible();
  expect(await coach()).toEqual({ name: 'guide', step: 1 });
  const viewport = page.locator('#structure-viewport');
  await viewport.focus();
  await viewport.press('ArrowRight');
  await expect.poll(coach).toEqual({ name: 'guide', step: 2 });
  await expect(page.locator('#extract')).toHaveClass(/coach-target/);
  await page.locator('#coach-close').click();
  await expect(page.locator('#coach')).toBeHidden();
  await page.close();
  const reopened = await context.newPage();
  await openGame(reopened);
  expect(await reopened.evaluate(() => window.structureStudy.snapshot().coach)).toBeNull();
  await reopened.locator('#help-open').click();
  await reopened.locator('#guide-replay').click();
  await expect(reopened.locator('#coach')).toBeVisible();
});

test('architecture and audio preferences survive a fresh page', async ({ page, context }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openGame(page);
  await page.locator('#sound-open').click();
  await page.locator('#sound-toggle').click();
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#sound-dialog [data-close]').first().click();
  await page.locator('#settings-open').click();
  await page.locator('[data-level="cube"]').click();
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.structureStudy.snapshot().level)).toBe('cube');
  await page.close();
  const reopened = await context.newPage();
  await reopened.setViewportSize({ width: 800, height: 600 });
  await openGame(reopened);
  expect(await reopened.evaluate(() => window.structureStudy.snapshot().level)).toBe('cube');
  await expect(reopened.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
});

test('limit mode runs a daily round through dialogs and submits it to the ranking', async ({ page }) => {
  test.setTimeout(150000);
  const endpoint = 'https://ranking.test';
  const posted = [];
  // ランキング Worker の URL（endpoint の meta と CSP）を差し替え、Worker 自体はモックする
  await page.route('**/index.html', async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const deployed = source.match(/<meta name="ranking-endpoint" content="([^"]+)"/)[1];
    const html = source.replaceAll(deployed, endpoint);
    await route.fulfill({ response, body: html });
  });
  await page.route(`${endpoint}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') posted.push(request.postDataJSON());
    await route.fulfill({
      status: request.method() === 'POST' ? 201 : 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(
        request.method() === 'POST'
          ? { id: 1, status: 'pending' }
          : {
              daily: [{ name: '<b>ちな</b>', score: 1234, day: '2026-10-10' }],
              allTime: [],
              mine: posted.length ? [{ claimed: posted[0].score, score: null, status: 'pending' }] : [],
            },
      ),
    });
  });
  await page.goto('/index.html');
  await expect
    .poll(() => page.evaluate(() => window.structureStudy?.snapshot().ready), { timeout: 30000 })
    .toBe(true);
  await page.locator('#daily-open').click();
  await expect(page.locator('#panel-daily')).toBeVisible();
  await expect(page.locator('#daily-compare table')).toBeVisible();
  await expect(page.locator('#daily-board li').first()).toContainText('<b>ちな</b>');
  await page.locator('#daily-start').click();
  const snapshot = () => page.evaluate(() => window.structureStudy.snapshot());
  expect((await snapshot()).mode).toBe('limit');
  expect((await snapshot()).level).toBe(dailyLevel((await snapshot()).day));
  await expect(page.locator('#limit-timer')).toBeVisible();

  // 限界モードはダイアログを開いても時間が進む
  const before = (await snapshot()).timeLeft;
  await page.locator('#help-open').click();
  await expect.poll(async () => (await snapshot()).timeLeft, { timeout: 15000 }).toBeLessThan(before - 1);
  await page.locator('#help-dialog [data-close]').first().click();

  const viewport = page.locator('#structure-viewport');
  await viewport.focus();
  await viewport.press('ArrowRight');
  await viewport.press('x');
  await expect.poll(async () => (await snapshot()).actions.length).toBe(1);
  await expect
    .poll(
      async () => {
        const { motion, status } = await snapshot();
        return status !== 'playing' || !motion.pending;
      },
      { timeout: 30000 },
    )
    .toBe(true);
  if ((await snapshot()).status === 'playing') await page.locator('#finish').click();
  // 完成でも崩壊でも時間切れでも、結果画面とランキングが出る
  await expect(page.locator('#result-dialog')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#ranking')).toBeVisible();
  await expect(page.locator('#ranking-list li').first()).toContainText('<b>ちな</b>');
  await page.locator('#ranking-name').fill('テスト');
  await page.locator('#ranking-submit').click();
  await expect(page.locator('#ranking-status')).toContainText('送りました');
  await expect(page.locator('#ranking-mine')).toContainText('検証待ち');
  const state = await snapshot();
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    level: state.level,
    day: state.day,
    seed: state.seed,
    score: state.stats.score,
    actions: state.actions,
    name: 'テスト',
  });
  expect(posted[0].player).toMatch(/^[0-9a-f-]{36}$/);
  // ブラウザで遊んだ操作列を、検証側と同じ replayRound で再現すると同じ点になる
  expect(replayRound(state.level, state.seed, 'limit', state.actions).stats.score).toBe(state.stats.score);
});
