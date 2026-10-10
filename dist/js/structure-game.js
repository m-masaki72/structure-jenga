import { SAVE_KEY } from './storage-keys.js';
import { prepareAnalysis } from './structure-solver.js';
import { makeStructure } from './structure-levels.js';
import { assembleRound, swayAt } from './structure-motion.js';

const STEP = 1 / 30;

export class StructureGame {
  constructor(level = 'spire', options = {}) {
    this.reset(level, options);
  }
  reset(level = this.structure.id, { seed = Math.floor(Math.random() * 4294967296) } = {}) {
    this.seed = seed >>> 0;
    this.structure = makeStructure(level);
    this.environment = assembleRound(this.structure, this.seed);
    this.removed = new Set();
    this.history = [];
    this.probes = 0;
    this.status = 'playing';
    this.time = this.accumulator = this.overload = 0;
    this.strainPeak = 0;
    this.pending = this.failure = null;
    this.finishing = false;
    this.lastRemoval = -Infinity;
    this.sway = swayAt(this.environment, 0);
    this.evaluate = prepareAnalysis(this.structure, this.removed);
    this.result = this.evaluate(this.sway);
    this.initial = this.result;
    this.lastSafe = this.result;
    this.displacement = this.result.displacement.map((p) => [...p]);
    this.velocity = this.structure.nodes.map(() => [0, 0, 0]);
    if (!this.result.stable) throw new Error(`Initial structure is unstable: ${level}/${this.seed}`);
  }
  probe(id) {
    const member = this.result.members.get(id);
    if (!member || this.status !== 'playing') return null;
    this.probes++;
    return member;
  }
  remove(id) {
    if (
      this.status !== 'playing' ||
      this.pending ||
      this.finishing ||
      !this.result.members.has(id) ||
      this.result.members.get(id).foundation
    )
      return null;
    const before = this.result;
    const member = before.members.get(id);
    this.removed.add(id);
    this.lastRemoval = this.time;
    this.strainPeak = 0;
    this.evaluate = prepareAnalysis(this.structure, this.removed);
    const after = this.evaluate(this.sway);
    const share = member.energy / Math.max(this.initial.energy, 1e-10);
    const meaningful = share >= 0.003;
    const reward = meaningful ? Math.round(100 + Math.min(150, share * 1000)) : 50;
    const entry = { id, meaningful, points: 0, stable: false, pending: true, mass: after.mass };
    this.history.push(entry);
    this.pending = { entry, reward, before, until: this.time + 3.2 };
    if (after.reason === 'mechanism') this.fail(after);
    else this.result = this.evaluate.measure(this.displacement.map((p) => [...p]));
    return { before, after: this.result, member, points: reward, meaningful };
  }
  fail(after) {
    const pending = this.pending;
    const last = this.history.at(-1);
    if (pending) {
      pending.entry.pending = false;
      pending.entry.stable = false;
      pending.entry.points = 0;
    } else if (last) {
      last.stable = false;
      last.points = 0;
    }
    this.failure = { id: last?.id, before: this.result, after, delayed: this.time - this.lastRemoval > 0.5 };
    this.result = after;
    this.pending = null;
    this.finishing = false;
    this.status = 'collapsed';
  }
  advance(seconds) {
    const events = [];
    if (this.status !== 'playing') return events;
    this.accumulator += Math.max(0, seconds);
    while (this.accumulator + 1e-10 >= STEP && this.status === 'playing') {
      this.accumulator -= STEP;
      this.time += STEP;
      this.sway = swayAt(this.environment, this.time);
      const target = this.evaluate(this.sway);
      if (target.reason === 'mechanism') {
        this.fail(target);
        events.push({ type: 'collapsed' });
        break;
      }
      const previousDemand = Math.max(
        this.result.maxUtilization,
        this.result.maxDisplacement / (this.structure.displacementLimit ?? 0.045),
      );
      const damping = 3.2 + 3.8 * Math.min(1, previousDemand) ** 3;
      this.displacement.forEach((p, i) =>
        p.forEach((value, axis) => {
          const acceleration = (target.displacement[i][axis] - value) * 18 - this.velocity[i][axis] * damping;
          this.velocity[i][axis] += acceleration * STEP;
          p[axis] += this.velocity[i][axis] * STEP;
        }),
      );
      const current = this.evaluate.measure(this.displacement.map((p) => [...p]));
      const demand = Math.max(
        current.maxUtilization,
        current.maxDisplacement / (this.structure.displacementLimit ?? 0.045),
      );
      this.overload =
        demand > 1
          ? this.overload + STEP * Math.min(2, Math.max(0.18, demand - 0.92))
          : Math.max(0, this.overload - STEP * 0.8);
      this.strainPeak = Math.max(this.strainPeak, demand);
      if (this.overload >= 0.95 || demand >= 3) {
        this.fail(current);
        events.push({ type: 'collapsed' });
        break;
      }
      this.result = current;
      if (current.stable) this.lastSafe = current;
      if (this.pending && this.time >= this.pending.until && current.stable && this.overload === 0) {
        const { entry, reward } = this.pending;
        entry.pending = false;
        entry.stable = true;
        entry.points = reward;
        this.pending = null;
        events.push({ type: 'settled', entry, heldOn: this.strainPeak > 0.95 });
        this.strainPeak = 0;
      } else if (!this.pending && this.strainPeak > 1 && demand < 0.8 && this.overload === 0) {
        events.push({ type: 'recovered' });
        this.strainPeak = 0;
      }
      if (
        this.finishing &&
        !this.pending &&
        current.stable &&
        this.overload === 0 &&
        this.time >= this.finishAt
      ) {
        this.status = 'finished';
        this.finishing = false;
        events.push({ type: 'finished' });
      }
    }
    return events;
  }
  finish() {
    if (this.status !== 'playing' || this.pending || this.finishing || !this.stats.count) return false;
    this.finishing = true;
    this.finishAt = this.time + this.environment.period;
    return true;
  }
  get stats() {
    const safe = this.history.filter((entry) => entry.stable);
    const useful = safe.filter((entry) => entry.meaningful).length;
    const base = safe.reduce((sum, entry) => sum + entry.points, 0);
    const reduction = Math.max(0, 1 - (safe.at(-1)?.mass ?? this.initial.mass) / this.initial.mass);
    const finishBonus = this.status === 'finished' ? Math.round(base * (0.15 + Math.min(0.4, reduction))) : 0;
    return {
      count: safe.length,
      useful,
      empty: safe.length - useful,
      reduction,
      score: base + finishBonus,
      margin: this.result.margin,
      remaining: this.structure.members.length - this.removed.size,
      cleared: safe.length >= this.structure.target,
      finishBonus,
    };
  }
}

export { SAVE_KEY };
export function readRecords(storage) {
  try {
    const records = JSON.parse(storage.getItem(SAVE_KEY) ?? '{}');
    if (!records || typeof records !== 'object' || Array.isArray(records)) return {};
    return Object.fromEntries(
      Object.entries(records).filter(
        ([, record]) =>
          record &&
          Number.isFinite(record.score) &&
          record.score >= 0 &&
          Number.isInteger(record.count) &&
          record.count >= 0,
      ),
    );
  } catch {
    return {};
  }
}
export function saveRecord(storage, game) {
  if (game.status === 'playing') return { saved: false, best: false };
  try {
    const records = readRecords(storage),
      key = game.structure.id;
    const stats = game.stats;
    const best = !records[key] || records[key].score < stats.score;
    if (best) {
      records[key] = {
        score: stats.score,
        count: stats.count,
        useful: stats.useful,
        seed: game.seed,
        date: new Date().toISOString(),
      };
      storage.setItem(SAVE_KEY, JSON.stringify(records));
    }
    return { saved: true, best, record: records[key] };
  } catch {
    return { saved: false, best: false };
  }
}
