import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handle, cleanName, validActions } from '../../ranking/src/index.js';
import { judge } from '../../tools/verify-scores.mjs';
import { StructureGame, STEP } from '../../dist/js/structure-game.js';
import { dailySeed, jstDay } from '../../dist/js/structure-motion.js';
import { prepareAnalysis } from '../../dist/js/structure-solver.js';

// D1 の API を node:sqlite で真似る
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const schema = readFileSync(new URL('../../ranking/schema.sql', import.meta.url), 'utf8')
    .replace(/--.*$/gm, '')
    .split(';')
    .map((sql) => sql.trim())
    .filter(Boolean);
  for (const sql of schema) db.prepare(sql).run();
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => Promise.all(statements.map((s) => s.run())),
  };
}

const NOW = Date.parse('2026-10-10T03:00:00Z');
const DAY = jstDay(NOW);
const PLAYER = '0123456789abcdef0123';
const env = () => ({ DB: fakeD1(), VERIFY_TOKEN: 'secret' });
const call = (environment, method, path, body, headers = {}) =>
  handle(
    new Request(`https://ranking.example${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    environment,
    NOW,
  );

function playedRound(level = 'pyramid') {
  const game = new StructureGame(level, { seed: dailySeed(DAY, level), mode: 'limit' });
  for (let n = 0; n < 2; n++) {
    for (let i = 0; i < 30; i++) game.advance(STEP);
    const id = [...game.result.members.keys()].find((candidate) => {
      if (game.removed.has(candidate) || game.result.members.get(candidate).foundation) return false;
      const result = prepareAnalysis(game.structure, new Set([...game.removed, candidate]))(game.sway);
      return result.stable && result.maxUtilization < 0.6;
    });
    game.remove(id);
    while (game.pending) game.advance(STEP);
  }
  while (game.status === 'playing') game.advance(STEP);
  return game;
}

test('names are normalized and bounded', () => {
  assert.equal(cleanName('  ｃｈｉｎａ​ \n 様 '), 'china 様');
  assert.equal(cleanName(''), null);
  assert.equal(cleanName('あ'.repeat(13)), null);
  assert.equal(cleanName(42), null);
});

test('actions must be ordered steps with either a member id or a finish flag', () => {
  assert.equal(
    validActions([
      { step: 3, id: 1 },
      { step: 9, finish: true },
    ]),
    true,
  );
  assert.equal(validActions([]), false);
  assert.equal(
    validActions([
      { step: 9, id: 1 },
      { step: 3, id: 2 },
    ]),
    false,
  );
  assert.equal(validActions([{ step: 1, id: 1, extra: true }]), false);
  assert.equal(validActions([{ step: 1, finish: false }]), false);
});

test('a submitted round stays off the board until the verifier replays it', async () => {
  const environment = env();
  const game = playedRound();
  const submission = {
    level: 'pyramid',
    day: DAY,
    seed: game.seed,
    actions: game.actions,
    score: game.stats.score,
    name: 'ちな',
    player: PLAYER,
  };
  const posted = await call(environment, 'POST', '/scores', submission);
  assert.equal(posted.status, 201);
  let board = await (await call(environment, 'GET', `/scores?level=pyramid&player=${PLAYER}`)).json();
  assert.equal(board.daily.length, 0);
  assert.equal(board.mine[0].status, 'pending');

  assert.equal((await call(environment, 'GET', '/pending')).status, 401);
  const auth = { Authorization: 'Bearer secret' };
  const { pending } = await (await call(environment, 'GET', '/pending', undefined, auth)).json();
  assert.equal(pending.length, 1);
  const verdicts = pending.map((entry) => ({ id: entry.id, ...judge(entry) }));
  assert.equal(verdicts[0].status, 'verified');
  await call(environment, 'POST', '/verdicts', { verdicts }, auth);

  board = await (await call(environment, 'GET', `/scores?level=pyramid&player=${PLAYER}`)).json();
  assert.deepEqual(
    board.daily.map(({ name, score }) => ({ name, score })),
    [{ name: 'ちな', score: game.stats.score }],
  );
  assert.equal(board.allTime.length, 1);
  assert.equal(board.mine[0].status, 'verified');
});

test('the verifier rejects an inflated score', () => {
  const game = playedRound();
  const entry = { level: 'pyramid', day: DAY, seed: game.seed, actions: game.actions };
  assert.equal(judge({ ...entry, claimed: game.stats.score }).status, 'verified');
  assert.equal(judge({ ...entry, claimed: game.stats.score + 1 }).status, 'rejected');
  assert.equal(judge({ ...entry, seed: game.seed + 1, claimed: game.stats.score }).status, 'rejected');
});

test('submissions for another day, seed or level are refused', async () => {
  const environment = env();
  const base = {
    level: 'pyramid',
    day: DAY,
    seed: dailySeed(DAY, 'pyramid'),
    actions: [{ step: 1, id: 0 }],
    score: 100,
    name: 'a',
    player: PLAYER,
  };
  const old = '2026-10-01';
  assert.equal((await call(environment, 'POST', '/scores', { ...base, level: 'nope' })).status, 400);
  assert.equal((await call(environment, 'POST', '/scores', { ...base, seed: 1 })).status, 400);
  assert.equal(
    (await call(environment, 'POST', '/scores', { ...base, day: old, seed: dailySeed(old, 'pyramid') }))
      .status,
    400,
  );
  assert.equal((await call(environment, 'POST', '/scores', { ...base, name: '' })).status, 400);
  assert.equal((await call(environment, 'POST', '/scores', base)).status, 201);
});
