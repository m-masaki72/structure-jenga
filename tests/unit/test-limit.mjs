import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAnalysis } from '../../dist/js/structure-solver.js';
import {
  StructureGame,
  LIMIT_RULES,
  STEP,
  replayRound,
  recordKey,
  saveRecord,
  readRecords,
} from '../../dist/js/structure-game.js';
import { swayAt } from '../../dist/js/structure-motion.js';

const SEED = 7;

function candidate(game, accept) {
  for (const [id, member] of game.result.members) {
    if (game.removed.has(id) || member.foundation) continue;
    const result = prepareAnalysis(game.structure, new Set([...game.removed, id]))(game.sway);
    if (accept(result, member)) return id;
  }
  return null;
}
const safe = (game) => candidate(game, (r, m) => r.stable && r.maxUtilization < 0.6 && m.energy > 0);
const breaking = (game) => candidate(game, (r) => r.reason === 'mechanism' || !r.stable);
function settle(game) {
  while (game.pending && game.status === 'playing') game.advance(STEP);
}
function run(game, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP) && game.status === 'playing'; i++) game.advance(STEP);
}

test('limit mode scales the time budget with the target and strengthens the sway', () => {
  const game = new StructureGame('cube', { seed: SEED, mode: 'limit' });
  assert.equal(game.timeLimit, game.structure.target * LIMIT_RULES.secondsPerTarget);
  const t = game.timeLimit;
  const base = swayAt(game.environment, t);
  game
    .swayAt(t)
    .forEach((value, i) => assert.ok(Math.abs(value - base[i] * (1 + LIMIT_RULES.swayGrowth)) < 1e-12));
  const classic = new StructureGame('cube', { seed: SEED });
  assert.equal(classic.timeLimit, Infinity);
  assert.deepEqual(classic.swayAt(t), base);
});

test('a collapse in limit mode keeps a fixed share of the confirmed points', () => {
  // spire には抜くと揺れに耐えられなくなる部材がある
  const game = new StructureGame('spire', { seed: SEED, mode: 'limit' });
  game.remove(safe(game));
  settle(game);
  game.remove(safe(game));
  settle(game);
  assert.equal(game.stats.count, 2);
  game.remove(breaking(game));
  run(game, 10);
  assert.equal(game.status, 'collapsed');
  const confirmed = game.history.filter((entry) => entry.stable);
  assert.equal(confirmed.length, 2, 'confirmed removals are not revoked');
  const base = confirmed.reduce((sum, entry) => sum + entry.points, 0);
  assert.equal(game.stats.score, Math.round(base * LIMIT_RULES.collapseKeep));
});

test('time running out closes the round without a finish bonus and blocks removals', () => {
  const game = new StructureGame('cube', { seed: SEED, mode: 'limit' });
  game.remove(safe(game));
  settle(game);
  const base = game.stats.score;
  run(game, game.timeLimit);
  assert.equal(game.status, 'finished');
  assert.equal(game.endReason, 'timeout');
  assert.equal(game.stats.score, base);
  assert.equal(game.remove(safe(game) ?? 0), null);
});

test('finishing early adds a bonus proportional to the remaining time', () => {
  const game = new StructureGame('cube', { seed: SEED, mode: 'limit' });
  game.remove(safe(game));
  settle(game);
  const base = game.stats.score;
  assert.equal(game.finish(), true);
  const remaining = game.finishRemaining;
  run(game, game.environment.period + 1);
  assert.equal(game.status, 'finished');
  assert.equal(game.endReason, 'finish');
  assert.equal(
    game.stats.finishBonus,
    Math.round(((base * remaining) / game.timeLimit) * LIMIT_RULES.finishBonusRate),
  );
});

test('a recorded round replays to the same score and rejects tampered actions', () => {
  const game = new StructureGame('lantern', { seed: SEED, mode: 'limit' });
  for (let i = 0; i < 3; i++) {
    run(game, 1.5);
    game.remove(safe(game));
    settle(game);
  }
  run(game, 0.7);
  game.finish();
  run(game, game.environment.period + 1);
  assert.equal(game.status, 'finished');
  const replayed = replayRound('lantern', SEED, 'limit', game.actions);
  assert.equal(replayed.stats.score, game.stats.score);
  assert.deepEqual(replayed.actions, game.actions);
  // 判定中に次の部材を抜く、順序が逆、存在しない部材、はすべて無効
  const [first, second] = game.actions;
  assert.equal(replayRound('lantern', SEED, 'limit', [first, { ...second, step: first.step + 1 }]), null);
  assert.equal(replayRound('lantern', SEED, 'limit', [second, first]), null);
  assert.equal(replayRound('lantern', SEED, 'limit', [{ step: 10, id: 99999 }]), null);
});

test('limit records are stored apart from the classic best', () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const game = new StructureGame('cube', { seed: SEED, mode: 'limit' });
  game.remove(safe(game));
  settle(game);
  run(game, game.timeLimit);
  assert.equal(saveRecord(storage, game).best, true);
  const records = readRecords(storage);
  assert.equal(records[recordKey('cube', 'limit')].score, game.stats.score);
  assert.equal(records.cube, undefined);
});
