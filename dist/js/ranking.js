// 限界モードのオンラインランキング（ranking/ の Cloudflare Worker）との通信
// <meta name="ranking-endpoint"> が空ならランキングは表示しない
import { PLAYER_KEY } from './storage-keys.js';

const endpoint = (document.querySelector('meta[name="ranking-endpoint"]')?.content ?? '')
  .trim()
  .replace(/\/$/, '');
export const rankingEnabled = /^https?:\/\//.test(endpoint);

let sessionPlayer;
// 端末ごとの匿名 ID。自分の送信の検証状況を引くためだけに使う
export function playerId() {
  try {
    let id = localStorage.getItem(PLAYER_KEY);
    if (!/^[0-9a-f-]{16,64}$/i.test(id ?? '')) {
      id = crypto.randomUUID();
      localStorage.setItem(PLAYER_KEY, id);
    }
    return id;
  } catch {
    sessionPlayer ??= crypto.randomUUID();
    return sessionPlayer;
  }
}

async function request(path, init = {}) {
  const response = await fetch(`${endpoint}${path}`, {
    ...init,
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export const fetchBoard = (level, day) =>
  request(`/scores?${new URLSearchParams({ level, day, player: playerId() })}`);

export const submitScore = (entry) =>
  request('/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...entry, player: playerId() }),
  });
