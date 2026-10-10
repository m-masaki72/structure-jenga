import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, prepareAnalysis } from '../../dist/js/structure-solver.js';
import { makeStructure, CATALOG, dailyLevel, DAILY_POOL } from '../../dist/js/structure-levels.js';
import {
  StructureGame,
  readRecords,
  saveRecord,
  recordCleared,
  SAVE_KEY,
} from '../../dist/js/structure-game.js';
import { voiceProfile, soundImpression } from '../../dist/js/structure-audio.js';
import { swayAt } from '../../dist/js/structure-motion.js';

test('axial solution matches F L / E A and has balanced residual', () => {
  const structure = {
    nodes: [
      { p: [0, 0, 0], fixed: true, mass: 0 },
      { p: [0, 2, 0], fixed: [true, false, true], mass: 0, force: [0, -100, 0] },
    ],
    members: [{ id: 0, a: 0, b: 1, radius: 0.1, area: 0.01, inertia: 0.001, modulus: 20000000, density: 0 }],
  };
  const result = analyze(structure);
  assert.equal(result.stable, true);
  assert.ok(Math.abs(result.displacement[1][1] - -0.001) < 1e-10);
  assert.ok(Math.abs(result.members.get(0).force - -100) < 1e-9);
  assert.ok(result.residual < 1e-9);
  assert.deepEqual(result.displacement[0], [0, 0, 0]);
  assert.equal(analyze(structure, new Set([0])).reason, 'mechanism');
});

test('a sideways mechanism is rejected even with purely vertical loading', () => {
  const result = analyze({
    nodes: [{ p: [0, 0, 0], fixed: true }, { p: [0, 1, 0] }],
    members: [{ id: 0, a: 0, b: 1, radius: 0.1 }],
  });
  assert.equal(result.stable, false);
  assert.equal(result.reason, 'mechanism');
});

for (const level of CATALOG)
  for (const seed of [17, 204, 9901]) {
    test(`${level.id}/seed ${seed}: stable waves, attainable target, real failure`, () => {
      const game = new StructureGame(level.id, { seed });
      assert.ok(game.result.residual < 1e-7);
      game.advance(14);
      assert.equal(game.status, 'playing', 'untouched structure survives changing loads');
      const originalMass = game.initial.mass;
      let steps = 0;
      while (!game.stats.cleared && steps++ < game.structure.members.length) {
        const candidates = [...game.result.members.values()]
          .filter((m) => !m.foundation)
          .sort((a, b) => a.energy - b.energy);
        const candidate = candidates.find(
          (m) => analyze(game.structure, new Set([...game.removed, m.id]), 'quake').stable,
        );
        if (!candidate) break;
        const event = game.remove(candidate.id);
        game.advance(8);
        assert.equal(game.status, 'playing');
        assert.equal(game.pending, null);
        assert.equal(event.after.stable, true);
        assert.ok(game.result.residual < 1e-7);
      }
      assert.ok(
        game.stats.count >= level.target,
        `${game.stats.count} safe removals; expected ${level.target}`,
      );
      assert.ok(game.lastSafe.mass < originalMass);
      let count, score;
      while (game.status === 'playing') {
        count = game.stats.count;
        score = game.stats.score;
        game.remove([...game.result.members.values()].find((m) => !m.foundation).id);
        game.advance(14);
        assert.equal(game.pending, null);
      }
      assert.equal(game.status, 'collapsed');
      assert.equal(game.stats.count, count);
      assert.equal(game.stats.score, score);
      assert.equal(game.remove(1), null);
      assert.equal(game.finish(), false);
      game.reset();
      assert.equal(game.stats.count, 0);
      assert.equal(game.status, 'playing');
    });
  }

test('unloaded removal earns progress and points without double counting', () => {
  const game = new StructureGame('spire', { seed: 17 });
  const weak = [...game.result.members.values()].find(
    (m) => m.energy / game.initial.energy < 0.003 && analyze(game.structure, new Set([m.id])).stable,
  );
  assert.ok(weak);
  const result = game.remove(weak.id);
  assert.equal(result.points, 50);
  assert.equal(game.stats.count, 0);
  game.advance(8);
  assert.equal(game.stats.empty, 1);
  assert.equal(game.remove(weak.id), null);
});

test('the first level is a regular tetrahedron with obvious removable foot decorations', () => {
  const game = new StructureGame('tetra', { seed: 17 });
  const ideal = makeStructure('tetra');
  const core = ideal.members.slice(0, 6);
  for (const member of core) {
    const a = ideal.nodes[member.a].p,
      b = ideal.nodes[member.b].p;
    assert.ok(Math.abs(Math.hypot(...a.map((v, i) => v - b[i])) - 3) < 1e-10);
  }
  for (const id of [6, 7, 8]) {
    assert.ok(game.remove(id).after.stable);
    game.advance(8);
  }
  assert.equal(game.stats.cleared, true);
  assert.equal(game.stats.score, 150);
  assert.ok(game.finish());
});

test('there are twenty ordered stages with many initially removable members', () => {
  assert.equal(CATALOG.length, 20);
  assert.equal(new Set(CATALOG.map((l) => l.id)).size, 20);
  CATALOG.forEach((level, i) => assert.equal(level.number, String(i + 1).padStart(2, '0')));
  for (const level of CATALOG.slice(0, 10)) {
    const structure = makeStructure(level.id);
    const safe = structure.members.filter((m) => analyze(structure, new Set([m.id])).stable).length;
    assert.ok(safe / structure.members.length >= 0.5, `${level.id}: ${safe} safe openings`);
  }
});

test('a single knock conveys resistance from force magnitude, not a safety answer', () => {
  const member = { span: 2, mass: 5 };
  const neutral = voiceProfile({ ...member, force: 0 });
  const tension = voiceProfile({ ...member, force: 600 });
  const compression = voiceProfile({ ...member, force: -600 });
  assert.equal(neutral.grip, 0);
  assert.ok(tension.grip > 0.7);
  assert.equal(tension.grip, compression.grip);
  assert.ok(tension.frequency < neutral.frequency);
  assert.ok(tension.decay < neutral.decay * 0.5);
  assert.ok(tension.volume > neutral.volume);
  const longer = voiceProfile({ ...member, span: 4, force: -600 });
  assert.equal(compression.grip, longer.grip);
  for (const profile of [neutral, tension, compression, longer]) {
    assert.ok(Number.isFinite(profile.frequency));
    assert.equal(profile.delay, undefined);
    assert.equal(profile.reference, undefined);
    assert.ok(!/安全|危険|大丈夫|正解/.test(soundImpression(profile)));
  }
});

test('the same structure has different member forces and decisions under wind', () => {
  const structure = makeStructure('spire');
  const calm = analyze(structure),
    wind = analyze(structure, new Set(), 'wind');
  assert.ok([...calm.members].some(([id, m]) => Math.abs(m.force - wind.members.get(id).force) > 100));
  const removed = new Set();
  let found = false;
  for (const m of structure.members) {
    const next = new Set([...removed, m.id]);
    if (!analyze(structure, next, 'calm').stable) continue;
    removed.add(m.id);
    if (!analyze(structure, removed, 'wind').stable) {
      found = true;
      break;
    }
  }
  assert.equal(found, true);
});

test('more axial load makes the knock drier for either sign', () => {
  const member = { span: 2, force: 100, utilization: 0.1 };
  assert.ok(voiceProfile({ ...member, utilization: 0.9 }).decay < voiceProfile(member).decay);
  assert.ok(
    voiceProfile({ ...member, force: -100, utilization: 0.9 }).decay <
      voiceProfile({ ...member, force: -100 }).decay,
  );
});

test('finish waits through a wave; unified records preserve older saves and handle unavailable storage', () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = new StructureGame('spire', { seed: 17 });
  assert.equal(game.finish(), false);
  const candidate = [...game.result.members.values()].find(
    (m) => m.energy > game.initial.energy * 0.003 && analyze(game.structure, new Set([m.id])).stable,
  );
  game.remove(candidate.id);
  assert.equal(game.finish(), false);
  game.advance(3.3);
  const score = game.stats.score;
  assert.equal(saveRecord(storage, game).saved, false);
  assert.equal(game.finish(), true);
  assert.equal(game.status, 'playing', 'finish cannot dodge the next wave');
  assert.equal(saveRecord(storage, game).saved, false);
  game.advance(8);
  assert.equal(game.status, 'finished');
  assert.ok(game.stats.score > score);
  assert.equal(saveRecord(storage, game).best, true);
  assert.equal(saveRecord(storage, game).best, false);
  assert.equal(readRecords(storage).spire.score, game.stats.score);
  assert.equal(readRecords(storage).spire.seed, 17);
  storage.setItem('structure-study-records-v2', 'older records');
  saveRecord(storage, game);
  assert.equal(storage.getItem('structure-study-records-v2'), 'older records');
  storage.setItem(SAVE_KEY, '{broken');
  assert.deepEqual(readRecords(storage), {});
  assert.equal(
    saveRecord(
      {
        getItem() {
          throw new Error('denied');
        },
        setItem() {
          throw new Error('denied');
        },
      },
      game,
    ).saved,
    false,
  );
});

test('bounded, repeatable imperfections and sway vary between rounds', () => {
  const a = new StructureGame('spire', { seed: 17 });
  const b = new StructureGame('spire', { seed: 17 });
  const c = new StructureGame('spire', { seed: 18 });
  assert.deepEqual(a.structure, b.structure);
  assert.notDeepEqual(a.structure.nodes, c.structure.nodes);
  for (let t = 0; t < 60; t += 0.2) {
    assert.deepEqual(swayAt(a.environment, t), swayAt(b.environment, t));
    assert.ok(Math.hypot(...swayAt(a.environment, t)) < 0.065, 'self weight remains dominant');
  }
  const ideal = makeStructure('spire');
  a.structure.nodes.forEach((node, i) =>
    node.p.forEach((v, axis) => {
      assert.ok(Math.abs(v - ideal.nodes[i].p[axis]) <= 0.008);
      if (node.fixed) assert.equal(v, ideal.nodes[i].p[axis]);
    }),
  );
  const first = a.seed;
  a.reset();
  assert.notEqual(a.seed, first);
});

test('a standing structure can still fail on the returning sway after holding briefly', () => {
  const g = new StructureGame('spire', { seed: 17 });
  for (const id of [48, 49, 50, 38, 36, 37, 4]) {
    g.remove(id);
    g.advance(8);
  }
  const afterRemoval = prepareAnalysis(g.structure, new Set([...g.removed, 8]))(g.sway);
  assert.equal(afterRemoval.stable, true);
  const count = g.stats.count;
  g.remove(8);
  g.advance(2);
  assert.equal(g.status, 'playing');
  g.advance(8);
  assert.equal(g.status, 'collapsed');
  assert.equal(g.failure.delayed, true);
  assert.equal(g.stats.count, count);
  assert.equal(g.finish(), false);
});

test('a later wave interrupts completion and does not bank the failed removal', () => {
  const g = new StructureGame('spire', { seed: 17 });
  for (const id of [48, 49, 50, 38, 36, 37, 4]) {
    g.remove(id);
    g.advance(8);
  }
  g.advance(4);
  const count = g.stats.count;
  g.remove(8);
  g.advance(3.3);
  assert.equal(g.status, 'playing');
  assert.equal(g.pending, null);
  assert.equal(g.stats.count, count + 1);
  assert.equal(g.finish(), true);
  g.advance(8);
  assert.equal(g.status, 'collapsed');
  assert.equal(g.stats.count, count);
  assert.equal(g.history.at(-1).points, 0);
});

test('a brief lean beyond the ordinary drift limit can recover and keep its score', () => {
  const g = new StructureGame('spire', { seed: 17 });
  for (const id of [48, 49, 50, 38, 36, 37]) {
    g.remove(id);
    g.advance(8);
  }
  const count = g.stats.count;
  g.remove(41);
  let peak = 0,
    recovered = false;
  for (let i = 0; i < 30 * 15; i++) {
    const events = g.advance(1 / 30);
    peak = Math.max(peak, g.result.maxDisplacement);
    recovered ||= events.some((e) => e.type === 'settled' && e.heldOn);
  }
  assert.ok(peak > g.structure.displacementLimit * 1.15, 'visible lean exceeds the ordinary limit');
  assert.ok(recovered, 'the structure arrests its lean and earns a held-on result');
  assert.equal(g.status, 'playing');
  assert.equal(g.stats.count, count + 1);
  assert.equal(g.finish(), true);
  g.advance(12);
  assert.equal(g.status, 'finished');
});

test('motion is fixed-step and reset clears pending motion and completion', () => {
  const run = (fps) => {
    const game = new StructureGame('spire', { seed: 17 });
    game.remove(38);
    for (let i = 0; i < fps * 8; i++) game.advance(1 / fps);
    return game;
  };
  const a = run(30),
    b = run(60),
    c = run(144);
  assert.deepEqual(a.displacement, b.displacement);
  assert.deepEqual(a.displacement, c.displacement);
  a.finish();
  a.reset('tetra', { seed: 18 });
  assert.equal(a.pending, null);
  assert.equal(a.finishing, false);
  assert.equal(a.failure, null);
  assert.equal(a.time, 0);
  assert.equal(a.stats.count, 0);
});

test('readRecords drops malformed entries and non-object payloads', () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  data.set(
    SAVE_KEY,
    JSON.stringify({
      ok: { score: 120, count: 2 },
      negative: { score: -1, count: 2 },
      fractional: { score: 10, count: 1.5 },
      text: { score: '100', count: 1 },
      empty: null,
    }),
  );
  assert.deepEqual(Object.keys(readRecords(storage)), ['ok']);
  data.set(SAVE_KEY, '[1,2]');
  assert.deepEqual(readRecords(storage), {});
  data.set(SAVE_KEY, 'null');
  assert.deepEqual(readRecords(storage), {});
});

test('a collapsed round is saved without the failed member and never beats a better record', () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = new StructureGame('spire', { seed: 17 });
  while (game.status === 'playing') {
    game.remove([...game.result.members.values()].find((m) => !m.foundation).id);
    game.advance(8);
  }
  assert.equal(game.status, 'collapsed');
  const first = saveRecord(storage, game);
  assert.equal(first.saved, true);
  assert.equal(first.best, true);
  assert.equal(first.record.count, game.stats.count);
  data.set(SAVE_KEY, JSON.stringify({ spire: { score: game.stats.score + 1, count: 9 } }));
  assert.equal(saveRecord(storage, game).best, false);
  assert.equal(readRecords(storage).spire.count, 9);
});

test('grounded members are locked outside the first chapter', () => {
  for (const level of CATALOG) {
    const structure = makeStructure(level.id);
    const anchored = (node) => (Array.isArray(node.fixed) ? node.fixed.every(Boolean) : node.fixed === true);
    for (const member of structure.members) {
      const grounded = anchored(structure.nodes[member.a]) && anchored(structure.nodes[member.b]);
      assert.equal(
        Boolean(member.foundation),
        grounded && level.chapter !== '入門',
        `${level.id}/${member.id}`,
      );
    }
  }
  const game = new StructureGame('cube', { seed: 17 });
  const footing = [...game.result.members.values()].find((m) => m.foundation);
  assert.ok(footing, 'cube has grounded members');
  assert.equal(game.remove(footing.id), null);
  assert.equal(game.removed.size, 0);
  const tutorial = new StructureGame('tetra', { seed: 17 });
  assert.ok(![...tutorial.result.members.values()].some((m) => m.foundation));
});

test('the daily structure skips the first chapter, cycles through all and never repeats two days in a row', () => {
  assert.deepEqual(
    DAILY_POOL,
    CATALOG.filter((level) => level.chapter !== CATALOG[0].chapter).map((level) => level.id),
  );
  assert.equal(DAILY_POOL.length, 15);
  const day = (n) => new Date(Date.UTC(2026, 0, 1) + n * 86400e3).toISOString().slice(0, 10);
  const levels = Array.from({ length: 1200 }, (_, n) => dailyLevel(day(n)));
  assert.equal(dailyLevel('2026-10-11'), dailyLevel('2026-10-11'));
  for (let n = 1; n < levels.length; n++) assert.notEqual(levels[n], levels[n - 1], day(n));
  for (const id of levels) assert.ok(DAILY_POOL.includes(id));
  // 15日ごとの区切りの中では、どの構造もちょうど一回ずつ出る
  const start = Math.ceil(Date.UTC(2026, 0, 1) / 86400e3 / 15) * 15 - Date.UTC(2026, 0, 1) / 86400e3;
  assert.equal(new Set(levels.slice(start, start + 15)).size, 15);
  assert.ok(DAILY_POOL.includes(dailyLevel('not a day')));
});

test('a cleared stage stays cleared, and old records infer it from the count', () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = new StructureGame('spire', { seed: 17 });
  while (game.status === 'playing') {
    game.remove([...game.result.members.values()].find((m) => !m.foundation).id);
    game.advance(8);
  }
  assert.equal(game.status, 'collapsed');
  saveRecord(storage, game);
  assert.equal(readRecords(storage).spire.cleared, false);
  data.set(SAVE_KEY, JSON.stringify({ spire: { score: 0, count: 0, cleared: true } }));
  saveRecord(storage, game);
  assert.equal(readRecords(storage).spire.score, game.stats.score);
  assert.equal(readRecords(storage).spire.cleared, true, 'a later collapse keeps the clear');
  const target = makeStructure('spire').target;
  assert.equal(recordCleared(undefined, target), false);
  assert.equal(recordCleared({ score: 10, count: target }, target), true);
  assert.equal(recordCleared({ score: 10, count: target - 1 }, target), false);
  assert.equal(recordCleared({ score: 10, count: target, cleared: false }, target), false);
});
