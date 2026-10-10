import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// tools/assets/ogp-base.jpg（イラスト）に遊び方の帯を重ねて dist/images/ogp.jpg を作る
const base = (await readFile(new URL('./assets/ogp-base.jpg', import.meta.url))).toString('base64');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>
    body { margin: 0; width: 1200px; height: 630px; background: url(data:image/jpeg;base64,${base}) 0 0 / cover; }
    ul { position: absolute; left: 62px; top: 448px; margin: 0; padding: 0; list-style: none; display: flex; gap: 12px; }
    li { padding: 9px 18px 10px; border-radius: 4px; background: #23402c; color: #f4f2e9;
      font: 600 26px/1 'Yu Mincho', 'Hiragino Mincho ProN', serif; letter-spacing: 0.08em;
      box-shadow: 0 2px 6px rgb(0 0 0 / 0.18); }
  </style><ul><li>限界モード</li><li>日替わりランキング</li></ul>`);
  await page.screenshot({
    path: fileURLToPath(new URL('../dist/images/ogp.jpg', import.meta.url)),
    type: 'jpeg',
    quality: 88,
  });
} finally {
  await browser.close();
}
