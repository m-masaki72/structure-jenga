import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../dist/index.html', import.meta.url), 'utf8');
const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)[1];

test('CSP allows the inline importmap by hash', () => {
  const body = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
  const hash = `'sha256-${createHash('sha256').update(body).digest('base64')}'`;
  assert.ok(csp.includes(hash), `script-src に ${hash} を入れる`);
});

test('CSP allows connecting to the ranking endpoint', () => {
  const endpoint = html.match(/<meta name="ranking-endpoint" content="([^"]*)"/)[1];
  if (endpoint) assert.match(csp, new RegExp(`connect-src [^;]*${endpoint.replace(/[.]/g, '\\.')}`));
});
