import { SAVE_KEY } from './storage-keys.js';
import { prepareAnalysis } from './structure-solver.js';
import { makeStructure } from './structure-levels.js';
import { assembleRound, swayAt } from './structure-motion.js';

export const STEP = 1 / 30;
// 限界モード：持ち時間のあいだに揺れが強まっていく。崩れたら合計を割り引いて終了
export const LIMIT_RULES = {
  secondsPerTarget: 6,
  swayGrowth: 0.6,
  emptyPoints: 20,
  edgeMultiplier: 1.2,
  collapseKeep: 0.7,
  finishBonusRate: 0.5,
};

export class StructureGame {
  constructor(level = 'spire', options = {}) {
    this.reset(level, options);
  }
  reset(level = this.structure.id, { seed = Math.floor(Math.random() * 4294967296), mode = 'classic' } = {}) {
    this.seed = seed >>> 0;
    this.mode = mode === 'limit' ? 'limit' : 'classic';
    this.structure = makeStructure(level);
    this.timeLimit = this.mode === 'limit' ? this.structure.target * LIMIT_RULES.secondsPerTarget : Infinity;
    this.environment = assembleRound(this.structure, this.seed);
    this.removed = new Set();
    this.history = [];
    // ランキング送信時にサーバーで再現するための操作列（何ステップ目に何をしたか）
    this.actions = [];
    this.steps = 0;
    this.probes = 0;
    this.status = 'playing';
    this.endReason = null;
    this.time = this.accumulator = this.overload = 0;
    this.strainPeak = 0;
    this.pending = this.failure = null;
    this.finishing = false;
    this.finishRemaining = 0;
    this.lastRemoval = -Infinity;
    this.sway = this.swayAt(0);
    this.evaluate = prepareAnalysis(this.structure, this.removed);
    this.result = this.evaluate(this.sway);
    this.initial = this.result;
    this.lastSafe = this.result;
    this.displacement = this.result.displacement.map((p) => [...p]);
    this.velocity = this.structure.nodes.map(() => [0, 0, 0]);
    if (!this.result.stable) throw new Error(`Initial structure is unstable: ${level}/${this.seed}`);
  }
  swayAt(time) {
    const sway = swayAt(this.environment, time);
    if (this.mode !== 'limit') return sway;
    const growth = 1 + LIMIT_RULES.swayGrowth * Math.min(1, time / this.timeLimit);
    return sway.map((value) => value * growth);
  }
  get timeLeft() {
    return Math.max(0, this.timeLimit - this.time);
  }
  reward(share, meaningful) {
    if (this.mode !== 'limit') return meaningful ? Math.round(100 + Math.min(150, share * 1000)) : 50;
    // 上限を設けず、細くなった構造の重い一本ほど差がつくようにする（share 15% で通常と同じ 250）
    return meaningful ? Math.round(100 + 150 * Math.log2(1 + (share * 1000) / 150)) : LIMIT_RULES.emptyPoints;
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
      this.result.members.get(id).foundation ||
      this.time >= this.timeLimit
    )
      return null;
    const before = this.result;
    const member = before.members.get(id);
    this.actions.push({ step: this.steps, id });
    this.removed.add(id);
    this.lastRemoval = this.time;
    this.strainPeak = 0;
    this.evaluate = prepareAnalysis(this.structure, this.removed);
    const after = this.evaluate(this.sway);
    const share = member.energy / Math.max(this.initial.energy, 1e-10);
    const meaningful = share >= 0.003;
    const reward = this.reward(share, meaningful);
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
    } else if (last && this.mode !== 'limit') {
      // 限界モードは崩壊を合計の割引で罰するので、確定済みの一本は取り消さない
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
      this.steps++;
      this.sway = this.swayAt(this.time);
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
        const heldOn = this.strainPeak > 0.95;
        entry.pending = false;
        entry.stable = true;
        entry.edge = this.mode === 'limit' && heldOn && entry.meaningful;
        entry.points = entry.edge ? Math.round(reward * LIMIT_RULES.edgeMultiplier) : reward;
        this.pending = null;
        events.push({ type: 'settled', entry, heldOn });
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
        this.endReason = 'finish';
        this.finishing = false;
        events.push({ type: 'finished' });
      } else if (
        this.time >= this.timeLimit &&
        !this.finishing &&
        !this.pending &&
        current.stable &&
        this.overload === 0
      ) {
        // 時間切れ。判定中の一本があれば、その結果が出てから締める
        this.status = 'finished';
        this.endReason = 'timeout';
        events.push({ type: 'finished', timeout: true });
      }
    }
    return events;
  }
  finish() {
    if (this.status !== 'playing' || this.pending || this.finishing || !this.stats.count) return false;
    if (this.time >= this.timeLimit) return false;
    this.actions.push({ step: this.steps, finish: true });
    this.finishing = true;
    this.finishAt = this.time + this.environment.period;
    this.finishRemaining = this.timeLeft;
    return true;
  }
  get stats() {
    const safe = this.history.filter((entry) => entry.stable);
    const useful = safe.filter((entry) => entry.meaningful).length;
    const base = safe.reduce((sum, entry) => sum + entry.points, 0);
    const reduction = Math.max(0, 1 - (safe.at(-1)?.mass ?? this.initial.mass) / this.initial.mass);
    let finishBonus = 0,
      score;
    if (this.mode === 'limit') {
      if (this.status === 'finished' && this.endReason === 'finish')
        finishBonus = Math.round(
          ((base * this.finishRemaining) / this.timeLimit) * LIMIT_RULES.finishBonusRate,
        );
      score = this.status === 'collapsed' ? Math.round(base * LIMIT_RULES.collapseKeep) : base + finishBonus;
    } else {
      if (this.status === 'finished') finishBonus = Math.round(base * (0.15 + Math.min(0.4, reduction)));
      score = base + finishBonus;
    }
    return {
      count: safe.length,
      useful,
      empty: safe.length - useful,
      edge: safe.filter((entry) => entry.edge).length,
      reduction,
      score,
      timeLeft: this.timeLeft,
      margin: this.result.margin,
      remaining: this.structure.members.length - this.removed.size,
      cleared: safe.length >= this.structure.target,
      finishBonus,
    };
  }
}

export { SAVE_KEY };
export const recordKey = (level, mode = 'classic') => (mode === 'limit' ? `limit:${level}` : level);

// 操作列からラウンドを再現する（ランキングのサーバー側検証用）。不正な操作があれば null
export function replayRound(level, seed, mode, actions, { maxSteps = 60 * 60 * 30 } = {}) {
  const game = new StructureGame(level, { seed, mode });
  let previous = -1;
  for (const action of actions) {
    if (!Number.isInteger(action.step) || action.step < previous || action.step > maxSteps) return null;
    previous = action.step;
    while (game.steps < action.step && game.status === 'playing') game.advance(STEP);
    if (game.steps !== action.step) return null;
    const ok = action.finish ? game.finish() : game.remove(action.id);
    if (!ok) return null;
  }
  while (game.status === 'playing' && game.steps < maxSteps) game.advance(STEP);
  return game.status === 'playing' ? null : game;
}
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
// 目標を達成して完成させたことがあるか。cleared を持たない古い記録は本数から推定する
export const recordCleared = (record, target) =>
  Boolean(record) && (record.cleared ?? record.count >= target);
export function saveRecord(storage, game) {
  if (game.status === 'playing') return { saved: false, best: false };
  try {
    const records = readRecords(storage),
      key = recordKey(game.structure.id, game.mode);
    const stats = game.stats,
      previous = records[key];
    const best = !previous || previous.score < stats.score;
    const cleared =
      recordCleared(previous, game.structure.target) || (game.status === 'finished' && stats.cleared);
    if (best || cleared !== previous.cleared) {
      records[key] = {
        ...(best
          ? {
              score: stats.score,
              count: stats.count,
              useful: stats.useful,
              seed: game.seed,
              date: new Date().toISOString(),
            }
          : previous),
        cleared,
      };
      storage.setItem(SAVE_KEY, JSON.stringify(records));
    }
    return { saved: true, best, record: records[key] };
  } catch {
    return { saved: false, best: false };
  }
}
