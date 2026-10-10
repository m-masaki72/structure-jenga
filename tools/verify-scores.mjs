// ランキングに届いた未検証スコアを replayRound で再現し、結果を Worker に返す（GitHub Actions から定期実行）
// 必要な環境変数: RANKING_URL（Worker の URL）, RANKING_TOKEN（wrangler secret の VERIFY_TOKEN と同じ値）
import { replayRound } from '../dist/js/structure-game.js';
import { dailySeed } from '../dist/js/structure-motion.js';

export function judge({ level, day, seed, claimed, actions }) {
  if (seed !== dailySeed(day, level)) return { status: 'rejected', reason: 'seed mismatch' };
  let game;
  try {
    game = replayRound(level, seed, 'limit', actions);
  } catch (error) {
    return { status: 'rejected', reason: `replay error: ${error.message}` };
  }
  if (!game) return { status: 'rejected', reason: 'invalid actions' };
  const score = game.stats.score;
  if (score !== claimed) return { status: 'rejected', reason: `score ${claimed} != replay ${score}` };
  return { status: 'verified', score };
}

async function main() {
  const base = process.env.RANKING_URL?.replace(/\/$/, '');
  const token = process.env.RANKING_TOKEN;
  if (!base || !token) throw new Error('RANKING_URL and RANKING_TOKEN are required');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  // Actions の 1 回の実行が長引きすぎないよう、時間で区切る
  const deadline = Date.now() + 8 * 60 * 1000;
  let total = 0;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/pending?limit=50`, { headers });
    if (!response.ok) throw new Error(`pending: ${response.status} ${await response.text()}`);
    const { pending } = await response.json();
    if (!pending.length) break;
    const verdicts = [];
    for (const entry of pending) {
      verdicts.push({ id: entry.id, ...judge(entry) });
      if (Date.now() >= deadline) break;
    }
    const posted = await fetch(`${base}/verdicts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ verdicts }),
    });
    if (!posted.ok) throw new Error(`verdicts: ${posted.status} ${await posted.text()}`);
    total += verdicts.length;
    for (const v of verdicts) console.log(v.id, v.status, v.score ?? v.reason);
  }
  console.log(`verified ${total} submissions`);
}

// テストから judge だけを import できるよう、直接実行されたときだけ動かす
if (process.argv[1]?.endsWith('verify-scores.mjs')) await main();
