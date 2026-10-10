// 限界モードのオンラインランキング（Cloudflare Workers + D1）
// 送信はいったん pending で受け付け、tools/verify-scores.mjs（GitHub Actions）が
// replayRound で再現して verified / rejected を付ける。順位に出すのは verified だけ。
import { STAGE_ORDER } from '../../dist/js/structure-stages.js';
import { dailyLevel } from '../../dist/js/structure-levels.js';
import { dailySeed, jstDay } from '../../dist/js/structure-motion.js';

const LEVELS = new Set(STAGE_ORDER);
const MAX_ACTIONS = 400;
const MAX_NAME = 12;
const MAX_DAILY_SUBMISSIONS = 60;
const MAX_PENDING = 3000;
const BOARD_SIZE = 10;
const DAY_MS = 24 * 3600e3;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...headers },
  });
const fail = (status, error) => json({ error }, status);

export function cleanName(value) {
  if (typeof value !== 'string') return null;
  // 制御文字・書式文字・改行を除き、空白を詰める
  const name = value
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const length = [...name].length;
  return length >= 1 && length <= MAX_NAME ? name : null;
}

export function validActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > MAX_ACTIONS) return false;
  let previous = -1;
  for (const action of actions) {
    if (!action || typeof action !== 'object') return false;
    if (!Number.isInteger(action.step) || action.step < previous || action.step > 60 * 60 * 30) return false;
    previous = action.step;
    const keys = Object.keys(action).sort().join(',');
    if (keys === 'finish,step' ? action.finish !== true : keys !== 'id,step' || !Number.isInteger(action.id))
      return false;
  }
  return true;
}

const authorized = (request, env) =>
  Boolean(env.VERIFY_TOKEN) && request.headers.get('Authorization') === `Bearer ${env.VERIFY_TOKEN}`;

async function submit(request, env, now) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'invalid json');
  }
  const { level, day, seed, actions, score, player } = body ?? {};
  const name = cleanName(body?.name);
  if (!LEVELS.has(level)) return fail(400, 'unknown level');
  // 日付の境目をまたいだ挑戦も受け付けるよう、今日と前日だけ許す
  if (day !== jstDay(now) && day !== jstDay(now - DAY_MS)) return fail(400, 'day closed');
  // 限界モードはその日の構造だけ。ほかの構造の送信は受け付けない
  if (level !== dailyLevel(day)) return fail(400, 'not the daily structure');
  if (seed !== dailySeed(day, level)) return fail(400, 'seed mismatch');
  if (!name) return fail(400, 'invalid name');
  if (typeof player !== 'string' || !/^[0-9a-f-]{16,64}$/i.test(player)) return fail(400, 'invalid player');
  if (!Number.isInteger(score) || score < 0 || score > 1e7) return fail(400, 'invalid score');
  if (!validActions(actions)) return fail(400, 'invalid actions');

  const today = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE player = ? AND created_day = ?')
    .bind(player, jstDay(now))
    .first();
  if (today.n >= MAX_DAILY_SUBMISSIONS) return fail(429, 'too many submissions');
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM scores WHERE status = 'pending'").first();
  if (pending.n >= MAX_PENDING) return fail(503, 'busy');

  const row = await env.DB.prepare(
    `INSERT INTO scores (level, day, seed, player, name, claimed, actions, status, created_at, created_day)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?) RETURNING id`,
  )
    .bind(
      level,
      day,
      seed,
      player,
      name,
      score,
      JSON.stringify(actions),
      new Date(now).toISOString(),
      jstDay(now),
    )
    .first();
  return json({ id: row.id, status: 'pending' }, 201);
}

async function board(url, env, now) {
  const level = url.searchParams.get('level');
  const day = url.searchParams.get('day') ?? jstDay(now);
  const player = url.searchParams.get('player');
  if (!LEVELS.has(level) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail(400, 'invalid query');
  // プレイヤーごとの最高点だけを並べる（SQLite は MAX() と同じ行の列を返す）
  const top = (where, ...args) =>
    env.DB.prepare(
      `SELECT name, MAX(score) AS score, day FROM scores
       WHERE level = ? AND status = 'verified' ${where}
       GROUP BY player ORDER BY score DESC, MIN(id) ASC LIMIT ${BOARD_SIZE}`,
    )
      .bind(level, ...args)
      .all();
  const [daily, allTime] = await Promise.all([top('AND day = ?', day), top('')]);
  let mine = [];
  if (player && /^[0-9a-f-]{16,64}$/i.test(player))
    mine = (
      await env.DB.prepare(
        `SELECT id, name, claimed, score, status FROM scores
         WHERE level = ? AND day = ? AND player = ? ORDER BY id DESC LIMIT 5`,
      )
        .bind(level, day, player)
        .all()
    ).results;
  return json({ level, day, daily: daily.results, allTime: allTime.results, mine }, 200, {
    'Cache-Control': 'public, max-age=30',
  });
}

async function pendingList(url, env) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const { results } = await env.DB.prepare(
    "SELECT id, level, day, seed, claimed, actions FROM scores WHERE status = 'pending' ORDER BY id LIMIT ?",
  )
    .bind(limit)
    .all();
  return json({ pending: results.map((row) => ({ ...row, actions: JSON.parse(row.actions) })) });
}

async function verdicts(request, env, now) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'invalid json');
  }
  if (!Array.isArray(body?.verdicts)) return fail(400, 'invalid verdicts');
  const statements = [];
  for (const { id, status, score, reason } of body.verdicts) {
    if (!Number.isInteger(id) || !['verified', 'rejected'].includes(status))
      return fail(400, 'invalid verdict');
    statements.push(
      env.DB.prepare(
        "UPDATE scores SET status = ?, score = ?, reason = ?, verified_at = ? WHERE id = ? AND status = 'pending'",
      ).bind(
        status,
        status === 'verified' && Number.isInteger(score) ? score : null,
        typeof reason === 'string' ? reason.slice(0, 120) : null,
        new Date(now).toISOString(),
        id,
      ),
    );
  }
  if (statements.length) await env.DB.batch(statements);
  return json({ updated: statements.length });
}

export async function handle(request, env, now = Date.now()) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    if (url.pathname === '/scores' && request.method === 'GET') return await board(url, env, now);
    if (url.pathname === '/scores' && request.method === 'POST') return await submit(request, env, now);
    if (url.pathname === '/pending' && request.method === 'GET')
      return authorized(request, env) ? await pendingList(url, env) : fail(401, 'unauthorized');
    if (url.pathname === '/verdicts' && request.method === 'POST')
      return authorized(request, env) ? await verdicts(request, env, now) : fail(401, 'unauthorized');
    return fail(404, 'not found');
  } catch (error) {
    console.error(error);
    return fail(500, 'server error');
  }
}

export default { fetch: (request, env) => handle(request, env) };
