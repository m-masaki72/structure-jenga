import RAPIER from '../vendor/rapier.mjs';
import { FOUNDATION, memberProfile } from './structure-profile.js';

const STEP = 1 / 120;
const vec = (p) => (Array.isArray(p) ? [...p] : [p.x, p.y, p.z]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

function orientation(direction) {
  const length = Math.hypot(...direction);
  const [x, y, z] = direction.map((v) => v / length);
  if (y < -0.999999) return { x: 1, y: 0, z: 0, w: 0 };
  const norm = Math.hypot(z, -x, 1 + y);
  return { x: z / norm, y: 0, z: -x / norm, w: (1 + y) / norm };
}

function inverseRotate(v, q) {
  const u = [-q.x, -q.y, -q.z];
  const t = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]].map(
    (x) => x * 2,
  );
  return v.map((x, i) => x + q.w * t[i] + u[(i + 1) % 3] * t[(i + 2) % 3] - u[(i + 2) % 3] * t[(i + 1) % 3]);
}

function endpoints(beam) {
  if (beam.type === 'node') {
    const p = vec(beam.body.translation());
    return [p, p];
  }
  const p = beam.body.translation(),
    q = beam.body.rotation(),
    half = beam.length / 2;
  const axis = [2 * (q.x * q.y - q.w * q.z), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z + q.w * q.x)];
  const center = [p.x, p.y, p.z];
  return [center.map((v, i) => v - axis[i] * half), center.map((v, i) => v + axis[i] * half)];
}

function segmentDistance(a, b, c, d) {
  const u = sub(b, a),
    v = sub(d, c),
    w = sub(a, c);
  const aa = dot(u, u),
    bb = dot(u, v),
    cc = dot(v, v),
    dd = dot(u, w),
    ee = dot(v, w);
  const denominator = aa * cc - bb * bb;
  if (aa < 1e-12) {
    const t = cc > 1e-12 ? clamp(ee / cc, 0, 1) : 0;
    return Math.hypot(...w.map((value, i) => value - t * v[i]));
  }
  if (cc < 1e-12) {
    const s = clamp(-dd / aa, 0, 1);
    return Math.hypot(...w.map((value, i) => value + s * u[i]));
  }
  let s = denominator > 1e-12 ? clamp((bb * ee - cc * dd) / denominator, 0, 1) : 0;
  let t = (bb * s + ee) / cc;
  if (t < 0) {
    t = 0;
    s = clamp(-dd / aa, 0, 1);
  } else if (t > 1) {
    t = 1;
    s = clamp((bb - dd) / aa, 0, 1);
  }
  return Math.hypot(...w.map((value, i) => value + s * u[i] - t * v[i]));
}

let initialization;

export class StructureCollapse {
  static async init() {
    initialization ??= RAPIER.init();
    await initialization;
  }

  constructor(structure, removedSet, startPositions, analysis, rotations = new Map()) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    this.world.numSolverIterations = 8;
    this.events = new RAPIER.EventQueue(true);
    this.time = 0;
    this.accumulator = 0;
    this.impacts = [];
    this.contactCount = 0;
    this.floorContacts = 0;
    this.impactCount = 0;
    this.cooldowns = new Map();
    this.colliders = new Map();
    this.members = new Map();
    this.connections = [];
    this.overlaps = new Map();
    this.blockedPairs = new Map();
    this.motions = new Map();
    this.floor = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(100, 0.15, 100)
        .setTranslation(0, -0.43, 0)
        .setFriction(0.78)
        .setRestitution(0.025),
    );
    this.plinth = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(FOUNDATION.halfSize, FOUNDATION.halfHeight, FOUNDATION.halfSize)
        .setTranslation(0, FOUNDATION.centerY, 0)
        .setFriction(0.78)
        .setRestitution(0.025),
    );
    const positions = structure.nodes.map((node, i) => vec(startPositions?.[i] ?? node.p));
    const nodeMasses = structure.nodes.map((node) => Math.max(0.25, node.mass ?? 1));
    const memberMasses = new Map();
    // Lump 20% of each bar's mass at each pin to avoid unstable heavy-bar / light-pin constraints.
    for (const member of structure.members) {
      if (removedSet.has(member.id)) continue;
      const mass = Math.max(
        0.2,
        (member.area ?? Math.PI * member.radius ** 2) *
          Math.hypot(...sub(positions[member.a], positions[member.b])) *
          (member.density ?? 620),
      );
      memberMasses.set(member.id, mass * 0.6);
      nodeMasses[member.a] += mass * 0.2;
      nodeMasses[member.b] += mass * 0.2;
    }
    this.nodes = structure.nodes.map((node, index) => {
      const fixed = Array.isArray(node.fixed) ? node.fixed.every(Boolean) : !!node.fixed;
      const descriptor = fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
      const body = this.world.createRigidBody(
        descriptor
          .setTranslation(...positions[index])
          .setLinearDamping(0.16)
          .setAngularDamping(0.35)
          .setCcdEnabled(true),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.ball(0.065)
          .setMass(nodeMasses[index])
          .setFriction(0.7)
          .setRestitution(0.025)
          .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS),
        body,
      );
      const entry = {
        index,
        fixed,
        body,
        collider,
        radius: 0.065,
        attachments: [],
        type: 'node',
      };
      this.colliders.set(collider.handle, entry);
      return entry;
    });
    for (const member of structure.members) {
      if (removedSet.has(member.id)) continue;
      const a = positions[member.a],
        b = positions[member.b];
      const length = Math.hypot(...sub(b, a));
      const profile = memberProfile(member, structure.nodes);
      const radius = profile.radius;
      const center = a.map((v, i) => (v + b[i]) / 2);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(...center)
          .setRotation(rotations.get(member.id) ?? orientation(sub(b, a)))
          .setLinearDamping(0.16)
          .setAngularDamping(0.32)
          .setCcdEnabled(true),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.capsule(Math.max(0.001, length / 2 - radius), radius)
          .setMass(memberMasses.get(member.id))
          .setFriction(0.72)
          .setRestitution(0.025)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(1)
          .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS),
        body,
      );
      const entry = {
        ...member,
        length,
        body,
        collider,
        attachments: [],
        type: 'member',
        surface: profile.column ? 'stone' : 'wood',
        collisionRadius: profile.radius,
      };
      this.members.set(member.id, entry);
      this.colliders.set(collider.handle, entry);
      for (const [index, sign] of [
        [member.a, -1],
        [member.b, 1],
      ]) {
        const node = this.nodes[index];
        const joint = this.world.createImpulseJoint(
          RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: (sign * length) / 2, z: 0 }),
          node.body,
          body,
          true,
        );
        joint.setContactsEnabled(false);
        const attachment = {
          node,
          member: entry,
          joint,
          releaseAt: Infinity,
          releasedAt: Infinity,
        };
        node.attachments.push(attachment);
        entry.attachments.push(attachment);
        this.connections.push(attachment);
      }
    }
    this.scheduleFailure(structure, removedSet, analysis);
    // Shared pins and crossing bars must separate before contacts can act without adding artificial energy.
    const members = [...this.colliders.values()];
    const ends = members.map(endpoints);
    for (let i = 0; i < members.length; i++)
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i],
          b = members[j];
        if (segmentDistance(...ends[i], ...ends[j]) < a.radius + b.radius + 0.006) {
          this.overlaps.set(pairKey(a.collider.handle, b.collider.handle), [a, b]);
          const lo = Math.min(a.collider.handle, b.collider.handle);
          const hi = Math.max(a.collider.handle, b.collider.handle);
          if (!this.blockedPairs.has(lo)) this.blockedPairs.set(lo, new Set());
          this.blockedPairs.get(lo).add(hi);
        }
      }
    for (const [handle] of this.colliders)
      this.motions.set(handle, {
        position: [0, 0, 0],
        velocity: [0, 0, 0],
        angular: [0, 0, 0],
        speedBound: 0,
      });
    this.hooks = {
      filterContactPair: (first, second) => {
        if (this.blockedPairs.get(Math.min(first, second))?.has(Math.max(first, second))) return null;
        return RAPIER.SolverFlags.COMPUTE_IMPULSE;
      },
      filterIntersectionPair: () => true,
    };
  }

  scheduleFailure(structure, removedSet, analysis) {
    const removed = [...removedSet];
    const last = structure.members.find((member) => member.id === removed.at(-1));
    const weakest = [...(analysis?.members?.values() ?? [])].sort((a, b) => b.utilization - a.utilization)[0];
    const seed = weakest && analysis?.reason === 'capacity' ? weakest : last;
    const distances = this.nodes.map(() => Infinity),
      queue = [];
    for (const index of seed ? [seed.a, seed.b] : [0]) {
      distances[index] = 0;
      queue.push(index);
    }
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      for (const { member } of this.nodes[index].attachments) {
        const other = member.a === index ? member.b : member.a;
        if (distances[other] > distances[index] + 1) {
          distances[other] = distances[index] + 1;
          queue.push(other);
        }
      }
    }
    const amplitudes = this.nodes.map((_, i) => Math.hypot(...(analysis?.displacement?.[i] ?? [0, 0, 0])));
    const maximum = Math.max(...amplitudes, 1e-8);
    for (const node of this.nodes) {
      if (node.fixed) continue;
      const stress = (attachment) => analysis?.members?.get(attachment.member.id)?.utilization ?? 0;
      const sorted = [...node.attachments].sort((a, b) => stress(b) - stress(a) || a.member.id - b.member.id);
      const keep = node.index % 4 === 0 ? 3 : 2;
      const delay =
        0.12 + Math.min(6, distances[node.index]) * 0.22 + (1 - amplitudes[node.index] / maximum) * 0.2;
      for (let i = 0; i < sorted.length - keep; i++) sorted[i].releaseAt = delay + i * 0.17;
      if (sorted.length && distances[node.index] === 0)
        sorted[0].releaseAt = Math.min(sorted[0].releaseAt, 0.12);
    }
  }

  step(delta) {
    if (!this.world || !Number.isFinite(delta) || delta <= 0) return;
    this.accumulator = Math.min(0.08, this.accumulator + delta);
    let steps = 0;
    while (this.accumulator >= STEP && steps < 4) {
      steps++;
      this.time += STEP;
      for (const attachment of this.connections)
        if (attachment.joint && this.time >= attachment.releaseAt) {
          this.world.removeImpulseJoint(attachment.joint, true);
          attachment.joint = null;
          attachment.releasedAt = this.time;
        }
      const endCache = new Map();
      const ends = (entry) => {
        if (!endCache.has(entry)) endCache.set(entry, endpoints(entry));
        return endCache.get(entry);
      };
      for (const [key, [a, b]] of this.overlaps)
        if (segmentDistance(...ends(a), ...ends(b)) > (a.radius + b.radius) * 1.15 + 0.01) {
          this.overlaps.delete(key);
          this.blockedPairs
            .get(Math.min(a.collider.handle, b.collider.handle))
            ?.delete(Math.max(a.collider.handle, b.collider.handle));
        }
      const motions = this.motions;
      for (const [handle, entry] of this.colliders) {
        if (entry.fixed) continue;
        const motion = motions.get(handle);
        const position = entry.body.translation(),
          velocity = entry.body.linvel(),
          angular = entry.body.angvel();
        motion.position[0] = position.x;
        motion.position[1] = position.y;
        motion.position[2] = position.z;
        motion.velocity[0] = velocity.x;
        motion.velocity[1] = velocity.y;
        motion.velocity[2] = velocity.z;
        motion.angular[0] = angular.x;
        motion.angular[1] = angular.y;
        motion.angular[2] = angular.z;
        motion.speedBound =
          Math.hypot(velocity.x, velocity.y, velocity.z) +
          Math.hypot(angular.x, angular.y, angular.z) *
            ((entry.length ?? 0) / 2 + (entry.collisionRadius ?? entry.radius));
      }
      this.world.step(this.events, this.hooks);
      this.events.drainContactForceEvents((event) => {
        const first = event.collider1(),
          second = event.collider2();
        this.contactCount++;
        const floor = [first, second].some(
          (handle) => handle === this.floor.handle || handle === this.plinth.handle,
        );
        if (floor) this.floorContacts++;
        const a = this.colliders.get(first),
          b = this.colliders.get(second);
        const beam = a?.type === 'member' ? a : b?.type === 'member' ? b : null;
        if (!beam || this.time < 0.2) return;
        if ((motions.get(first)?.speedBound ?? 0) + (motions.get(second)?.speedBound ?? 0) < 0.6) return;
        const mass = (beam.collisionMass ??= beam.body.mass());
        const lo = Math.min(first, second),
          hi = Math.max(first, second);
        if (
          this.time - (this.cooldowns.get(lo)?.get(hi) ?? -1) < 0.2 ||
          event.totalForceMagnitude() * STEP < mass * 0.09
        )
          return;
        let point = vec(beam.body.translation());
        this.world.contactPair(this.world.getCollider(first), this.world.getCollider(second), (manifold) => {
          if (manifold.numSolverContacts()) point = vec(manifold.solverContactPoint(0));
        });
        const velocityAt = (handle) => {
          const motion = motions.get(handle);
          if (!motion) return [0, 0, 0];
          const r = sub(point, motion.position),
            w = motion.angular;
          return motion.velocity.map(
            (v, i) => v + w[(i + 1) % 3] * r[(i + 2) % 3] - w[(i + 2) % 3] * r[(i + 1) % 3],
          );
        };
        const speed = Math.abs(
          dot(sub(velocityAt(first), velocityAt(second)), vec(event.maxForceDirection())),
        );
        if (speed < 0.6) return;
        if (!this.cooldowns.has(lo)) this.cooldowns.set(lo, new Map());
        this.cooldowns.get(lo).set(hi, this.time);
        this.impactCount++;
        this.impacts.push({
          speed,
          mass,
          point,
          floor,
          member: beam.id,
          material: beam.surface,
        });
      });
      this.accumulator -= STEP;
    }
    // 低フレームレートで溜まった分は持ち越さず、次のフレームで早送りにならないようにする
    if (steps === 4) this.accumulator = Math.min(this.accumulator, STEP);
  }

  snapshot() {
    if (!this.world) return { members: [], nodes: [], impacts: [] };
    const impacts = this.impacts
      .splice(0)
      .sort((a, b) => b.mass * b.speed ** 2 - a.mass * a.speed ** 2)
      .slice(0, 8);
    return {
      members: [...this.members.values()].map((member) => {
        const q = member.body.rotation();
        return {
          id: member.id,
          position: vec(member.body.translation()),
          quaternion: [q.x, q.y, q.z, q.w],
          length: member.length,
        };
      }),
      nodes: this.nodes.map((node) => vec(node.body.translation())),
      impacts,
    };
  }

  get stats() {
    let activeBodies = 0,
      kineticEnergy = 0,
      mass = 0;
    const centerOfMass = [0, 0, 0];
    if (this.world)
      for (const entry of this.colliders.values()) {
        if (entry.fixed) continue;
        const body = entry.body,
          m = body.mass(),
          p = vec(body.translation()),
          v = vec(body.linvel());
        const w = inverseRotate(
          inverseRotate(vec(body.angvel()), body.rotation()),
          body.principalInertiaLocalFrame(),
        );
        const inertia = vec(body.principalInertia());
        if (!body.isSleeping()) activeBodies++;
        mass += m;
        for (let i = 0; i < 3; i++) centerOfMass[i] += p[i] * m;
        kineticEnergy +=
          0.5 * m * dot(v, v) + 0.5 * inertia.reduce((sum, value, i) => sum + value * w[i] ** 2, 0);
      }
    return {
      elapsed: this.time,
      activeBodies,
      contacts: this.contactCount,
      floorContacts: this.floorContacts,
      impacts: this.impactCount,
      kineticEnergy,
      centerOfMass: centerOfMass.map((v) => v / Math.max(mass, 1e-8)),
      releasedJoints: this.connections.filter((joint) => !joint.joint).length,
      retainedJoints: this.connections.filter((joint) => joint.joint).length,
      initialOverlaps: this.overlaps.size,
    };
  }

  dispose() {
    if (!this.world) return;
    this.events.free();
    this.world.free();
    this.world = null;
    this.members.clear();
    this.colliders.clear();
    this.connections.length = 0;
    this.overlaps.clear();
    this.blockedPairs.clear();
    this.motions.clear();
    this.cooldowns.clear();
    this.impacts.length = 0;
  }
}
