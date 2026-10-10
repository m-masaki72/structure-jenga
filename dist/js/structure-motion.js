export function randomSequence(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// 限界モードは日本時間の日付ごとに、全員が同じ組み付けと揺れで競う
export const jstDay = (time = Date.now()) => new Date(time + 9 * 3600e3).toISOString().slice(0, 10);
export function dailySeed(day, level) {
  let hash = 0x811c9dc5;
  for (const char of `${day}:${level}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  return hash >>> 0;
}

export function assembleRound(structure, seed) {
  const random = randomSequence(seed);
  const environment = {
    period: 5.2 + random() * 1.6,
    phase: random() * Math.PI * 2,
    crossPhase: random() * Math.PI * 2,
    strength: 0.032 + random() * 0.014,
    direction: random() * Math.PI * 2,
  };
  for (const node of structure.nodes) {
    node.p = node.p.map((value, axis) => {
      const fixed = Array.isArray(node.fixed) ? node.fixed[axis] : node.fixed;
      return value + (fixed ? 0 : (random() - 0.5) * 0.016);
    });
    node.mass = (node.mass ?? 1) * (0.94 + random() * 0.12);
  }
  for (const member of structure.members) member.jointFlex = 0.075 * (0.75 + random() * 0.5);
  return environment;
}

export function swayAt(environment, time) {
  const angle = (time * Math.PI * 2) / environment.period;
  const envelope = 0.74 + 0.26 * Math.sin(angle * 0.37 + environment.crossPhase);
  const along =
    environment.strength *
    envelope *
    (Math.sin(angle + environment.phase) + 0.18 * Math.sin(angle * 2.17 + environment.crossPhase));
  const across = environment.strength * 0.38 * Math.sin(angle * 0.83 + environment.crossPhase);
  const c = Math.cos(environment.direction),
    s = Math.sin(environment.direction);
  return [along * c - across * s, along * s + across * c];
}
