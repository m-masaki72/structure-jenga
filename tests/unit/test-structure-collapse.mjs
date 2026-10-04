import test from 'node:test';
import assert from 'node:assert/strict';
import { StructureGame } from '../../dist/js/structure-game.js';
import { StructureCollapse } from '../../dist/js/structure-collapse.js';

await StructureCollapse.init();

function failedGame(level) {
  const game = new StructureGame(level, { seed: 17 });
  while (game.status === 'playing') {
    game.remove(game.result.members.keys().next().value);
    game.advance(12);
  }
  const positions = game.structure.nodes.map((node, i) =>
    node.p.map((v, axis) => v + game.failure.before.displacement[i][axis] * 3),
  );
  return { game, positions };
}

for (const level of ['hyperboloid', 'shell', 'spire', 'whale', 'wing']) {
  test(`${level}: rigid pieces fall, make contact, keep anchors and settle`, () => {
    const { game, positions } = failedGame(level);
    const simulation = new StructureCollapse(game.structure, game.removed, positions, game.result);
    try {
      const initial = simulation.snapshot();
      const initialHeight = simulation.stats.centerOfMass[1];
      const potential = [...simulation.colliders.values()].reduce(
        (sum, entry) => sum + entry.body.mass() * 9.81 * (entry.body.translation().y + 0.28),
        0,
      );
      const lengths = new Map(initial.members.map((m) => [m.id, m.length]));
      let peakEnergy = 0,
        earlyReleases = 0;
      for (let i = 0; i < 720; i++) {
        simulation.step(1 / 60);
        if (i === 14) earlyReleases = simulation.stats.releasedJoints;
        peakEnergy = Math.max(peakEnergy, simulation.stats.kineticEnergy);
        const state = simulation.snapshot();
        for (const member of state.members) {
          assert.ok([...member.position, ...member.quaternion].every(Number.isFinite));
          assert.equal(member.length, lengths.get(member.id));
          assert.ok(Math.abs(Math.hypot(...member.quaternion) - 1) < 1e-5);
          assert.ok(member.position[1] > -0.4, 'no tunneling through the floor');
        }
      }
      assert.ok(peakEnergy < potential * 1.5, 'fall does not create explosive energy');
      const final = simulation.snapshot(),
        stats = simulation.stats;
      assert.ok(stats.releasedJoints > earlyReleases, 'connections fail over time');
      assert.ok(stats.floorContacts > 0, 'real contact with the ground');
      assert.ok(stats.impacts > 0, 'collision events can drive impact sound');
      assert.ok(stats.centerOfMass[1] < initialHeight * 0.55, JSON.stringify(stats));
      assert.ok(stats.kineticEnergy < peakEnergy * 0.025, 'friction dissipates the fall');
      assert.equal(final.members.length, game.structure.members.length - game.removed.size);
      game.structure.nodes.forEach((node, i) => {
        if (node.fixed)
          final.nodes[i].forEach((v, axis) => assert.ok(Math.abs(v - positions[i][axis]) < 1e-6));
      });
      assert.equal(game.status, 'collapsed');
    } finally {
      simulation.dispose();
      simulation.dispose();
    }
    assert.deepEqual(simulation.snapshot().members, []);
  });
}

test('fixed timestep replays the same fall at 30 and 60 fps', () => {
  const { game, positions } = failedGame('spire');
  const run = (fps) => {
    const simulation = new StructureCollapse(game.structure, game.removed, positions, game.result);
    try {
      for (let i = 0; i < 4 * fps; i++) simulation.step(1 / fps);
      return simulation.snapshot().members;
    } finally {
      simulation.dispose();
    }
  };
  const a = run(30),
    b = run(60);
  a.forEach((member, i) =>
    member.position.forEach((v, axis) => assert.ok(Math.abs(v - b[i].position[axis]) < 1e-5)),
  );
});

test('a stalled frame does not cause an unbounded physics catch-up', () => {
  const { game, positions } = failedGame('spire');
  const simulation = new StructureCollapse(game.structure, game.removed, positions, game.result);
  try {
    simulation.step(0.08);
    assert.ok(Math.abs(simulation.time - 4 / 120) < 1e-10);
    for (let i = 0; i < 120; i++) simulation.step(1 / 60);
    assert.ok(simulation.accumulator < 1 / 120, 'normal frames catch up with the bounded backlog');
    assert.ok(simulation.stats.floorContacts > 0, 'the fall continues after the stall');
  } finally {
    simulation.dispose();
  }
});

test('a whale deformed by a delayed failure does not gain explosive energy from its pins', () => {
  const { game, positions } = failedGame('whale');
  assert.equal(game.failure.delayed, true);
  const simulation = new StructureCollapse(game.structure, game.removed, positions, game.result);
  try {
    const potential = [...simulation.colliders.values()].reduce(
      (sum, entry) => sum + entry.body.mass() * 9.81 * (entry.body.translation().y + 0.28),
      0,
    );
    let peakEnergy = 0,
      peakSpeed = 0;
    for (let i = 0; i < 720; i++) {
      simulation.step(1 / 120);
      peakEnergy = Math.max(peakEnergy, simulation.stats.kineticEnergy);
      for (const entry of simulation.colliders.values()) {
        const v = entry.body.linvel();
        peakSpeed = Math.max(peakSpeed, Math.hypot(v.x, v.y, v.z));
      }
      simulation.snapshot();
    }
    assert.ok(peakEnergy < potential * 1.5, `${peakEnergy} kinetic energy / ${potential} initial potential`);
    assert.ok(peakSpeed < 20, `unexpected launch at ${peakSpeed} m/s`);
    assert.ok(simulation.stats.floorContacts > 0);
  } finally {
    simulation.dispose();
  }
});
