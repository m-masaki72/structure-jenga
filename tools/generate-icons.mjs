import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 180, height: 180 }, deviceScaleFactor: 1 });
  const svg = await readFile(new URL('../dist/favicon.svg', import.meta.url), 'utf8');
  await page.setContent(`<style>body{margin:0}svg{width:180px;height:180px;display:block}</style>${svg}`);
  await page.screenshot({ path: fileURLToPath(new URL('../dist/apple-touch-icon.png', import.meta.url)) });
} finally {
  await browser.close();
}
