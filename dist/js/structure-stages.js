const TAU = Math.PI * 2;

export const STAGE_ORDER = [
  'tetra',
  'tetra-garden',
  'pyramid',
  'twins',
  'octahedron',
  'gate',
  'cube',
  'bridge',
  'fan',
  'lantern',
  'spire',
  'arcade',
  'whale',
  'helix',
  'shell',
  'hyperboloid',
  'long-bridge',
  'wing',
  'crown',
  'cathedral',
];
export const CHAPTERS = ['入門', '初級', '中級', '上級'];
export const NEW_STAGES = [
  ['tetra', 'はじめの四面体', '足もとの飾りから', 3],
  ['tetra-garden', '四面体の庭', '余分な足と外周', 6],
  ['pyramid', '四角いピラミッド', '四本脚の余裕', 5],
  ['twins', 'ふたつの山', '山のあいだのつなぎ', 7],
  ['octahedron', '八面の結晶', '三角形を残そう', 7],
  ['gate', '小さな門', '重なった斜めの棒', 5],
  ['cube', '箱のなかの箱', '棚と二重の筋交い', 12],
  ['bridge', '小さな橋', '渡れる道を残そう', 8],
  ['fan', 'ひらいた扇', '広がる支えを読む', 10],
  ['lantern', '五角の灯籠', '輪と筋交いの役目', 12],
  ['arcade', '三角のアーチ', '足もとから頂上へ', 12],
  ['helix', 'ねじれの塔', '回りながら支える', 14],
  ['long-bridge', '長い回廊', '遠くへ荷重を渡す', 18],
  ['crown', '環の王冠', '支えが巡る立体の輪', 20],
  ['cathedral', '星の大聖堂', 'たくさんの余白を探す', 24],
].map(([id, name, challenge, target]) => ({ id, name, challenge, target }));

function frame(spec, radius = 0.06) {
  const nodes = [],
    members = [],
    edges = new Set();
  const node = (p, fixed = false, mass = 1, anchor = true) => {
    nodes.push({ p, fixed, mass, anchor });
    return nodes.length - 1;
  };
  const beam = (a, b, family = 'lattice', thickness = radius) => {
    const key = [a, b].sort((x, y) => x - y).join(':');
    if (a === b || edges.has(key)) return;
    edges.add(key);
    members.push({
      id: members.length,
      a,
      b,
      radius: thickness,
      modulus: 6e8,
      strength: 4e6,
      density: 620,
      family,
    });
  };
  const ring = (ids, family = 'hoop') => ids.forEach((a, i) => beam(a, ids[(i + 1) % ids.length], family));
  const link = (a, b) =>
    a.forEach((id, i) => {
      beam(id, b[i], 'ruling-a');
      beam(id, b[(i + 1) % b.length], 'ruling-b');
      beam(id, b[(i + b.length - 1) % b.length], 'brace');
    });
  const apron = (feet, spurs = false) => {
    ring(feet, 'hoop');
    if (spurs)
      for (const foot of feet) {
        const p = nodes[foot].p,
          r = Math.hypot(p[0], p[2]) || 1;
        const tip = node([p[0] * (1 + 0.6 / r), p[1], p[2] * (1 + 0.6 / r)], true, 0, false);
        beam(foot, tip, 'brace', radius * 0.72);
      }
  };
  return {
    node,
    beam,
    ring,
    link,
    apron,
    nodes,
    result: { ...spec, nodes, members, displacementLimit: 0.07 },
  };
}

function polygon(model, count, radius, y, phase = 0, fixed = false) {
  return Array.from({ length: count }, (_, i) =>
    model.node(
      [Math.cos((i * TAU) / count + phase) * radius, y, Math.sin((i * TAU) / count + phase) * radius],
      fixed,
    ),
  );
}

export function makeNewStage(id) {
  const spec = NEW_STAGES.find((item) => item.id === id);
  if (!spec) return null;
  const m = frame(spec, id === 'cathedral' ? 0.065 : id === 'long-bridge' ? 0.07 : 0.06);
  if (id === 'tetra' || id === 'tetra-garden') {
    const side = 3.0,
      feet = polygon(m, 3, side / Math.sqrt(3), 0.12, Math.PI / 6, true);
    const top = m.node([0, 0.12 + side * Math.sqrt(2 / 3), 0], false, 4);
    m.ring(feet);
    feet.forEach((foot) => m.beam(foot, top));
    m.apron(feet, true);
    if (id === 'tetra-garden') {
      const outer = polygon(m, 3, 2.45, 0.12, -Math.PI / 6, true);
      m.ring(outer);
      outer.forEach((foot, i) => {
        m.beam(foot, top, 'brace');
        m.beam(foot, feet[i], 'hoop');
      });
    }
  } else if (id === 'pyramid' || id === 'fan') {
    const feet = polygon(m, 4, 2.1, 0.12, Math.PI / 4, true);
    m.apron(feet, true);
    m.beam(feet[0], feet[2], 'brace');
    m.beam(feet[1], feet[3], 'brace');
    const tops =
      id === 'pyramid'
        ? [m.node([0, 2.9, 0], false, 6)]
        : Array.from({ length: 7 }, (_, i) =>
            m.node(
              [(i - 3) * 0.72, 2.2 + Math.sin((i * Math.PI) / 6) * 1.3, Math.sin((i * Math.PI) / 3) * 0.35],
              false,
              2,
            ),
          );
    tops.forEach((top, i) => {
      feet.forEach((foot) => m.beam(foot, top));
      if (i) m.beam(tops[i - 1], top, 'hoop');
      if (i > 1) m.beam(tops[i - 2], top, 'brace');
    });
  } else if (id === 'twins') {
    const feet = [
      [-2.3, -1],
      [0, -1],
      [2.3, -1],
      [-2.3, 1],
      [0, 1],
      [2.3, 1],
    ].map(([x, z]) => m.node([x, 0.12, z], true));
    const left = m.node([-1.15, 2.7, 0]),
      right = m.node([1.15, 2.7, 0]);
    [0, 1, 3, 4].forEach((i) => m.beam(feet[i], left));
    [1, 2, 4, 5].forEach((i) => m.beam(feet[i], right));
    m.beam(left, right, 'hoop');
    m.beam(feet[0], right, 'brace');
    m.beam(feet[5], left, 'brace');
    m.apron([feet[0], feet[1], feet[2], feet[5], feet[4], feet[3]], true);
  } else if (id === 'octahedron') {
    const feet = polygon(m, 4, 1.65, 0.12, Math.PI / 4, true);
    const waist = polygon(m, 4, 1.65, 1.8, Math.PI / 4);
    const top = m.node([0, 3.5, 0], false, 3),
      bottom = m.node([0, 0.15, 0], true);
    m.ring(waist);
    waist.forEach((v, i) => {
      m.beam(v, top);
      m.beam(v, bottom);
      m.beam(v, feet[i], 'brace');
      m.beam(v, feet[(i + 1) % 4], 'brace');
    });
    m.apron(feet, true);
  } else if (['gate', 'cube', 'lantern', 'helix'].includes(id)) {
    const count = id === 'lantern' ? 5 : 4;
    const layers = id === 'gate' ? 2 : id === 'helix' ? 6 : 3;
    let previous;
    for (let layer = 0; layer < layers; layer++) {
      const y = 0.12 + layer * (id === 'gate' ? 2.5 : 1.0);
      const radius = id === 'helix' ? 1.28 + 0.23 * Math.cos(layer) : id === 'lantern' ? 1.55 : 1.8;
      const current = polygon(
        m,
        count,
        radius,
        y,
        Math.PI / 4 + (id === 'helix' ? (layer * Math.PI) / 6 : 0),
        layer === 0,
      );
      m.ring(current);
      if (previous) {
        m.link(previous, current);
        m.beam(current[0], current[2], 'brace');
      } else m.apron(current, true);
      previous = current;
    }
  } else if (['bridge', 'arcade', 'long-bridge'].includes(id)) {
    const slices = id === 'bridge' ? 3 : id === 'arcade' ? 5 : 8;
    const extent = id === 'bridge' ? 2.4 : 3.4;
    let previous;
    const feet = [];
    for (let i = 0; i < slices; i++) {
      const t = i / (slices - 1),
        x = -extent + t * extent * 2;
      const y = 0.12 + (id === 'arcade' ? 1.4 * Math.sin(t * Math.PI) : 0.25 * Math.sin(t * Math.PI));
      const end = i === 0 || i === slices - 1;
      const current = [m.node([x, y, -0.95], end), m.node([x, y + 1.25, 0]), m.node([x, y, 0.95], end)];
      m.ring(current);
      if (previous) m.link(previous, current);
      if (end) feet.push(current[0], current[2]);
      previous = current;
    }
    m.apron([feet[0], feet[2], feet[3], feet[1]]);
  } else if (id === 'crown') {
    const slices = 10,
      rings = [];
    for (let i = 0; i < slices; i++) {
      const angle = (i * TAU) / slices,
        support = [0, 3, 7].includes(i);
      const at = (radius, height, fixed = false) =>
        m.node([radius * Math.cos(angle), height, radius * Math.sin(angle)], fixed);
      const current = [at(2.2, 0.12, support), at(3.5, 0.12, support), at(2.85, 1.6)];
      m.ring(current);
      rings.push(current);
    }
    rings.forEach((ring, i) => m.link(ring, rings[(i + 1) % slices]));
  } else if (id === 'cathedral') {
    let previous;
    for (let layer = 0; layer < 5; layer++) {
      const latitude = (layer * Math.PI) / 10;
      const current = polygon(
        m,
        12,
        3.7 * Math.cos(latitude),
        0.12 + 4.5 * Math.sin(latitude),
        (-layer * Math.PI) / 12,
        layer === 0,
      );
      m.ring(current);
      if (previous) m.link(previous, current);
      previous = current;
    }
    const crown = m.node([0, 4.62, 0], false, 5);
    previous.forEach((p) => m.beam(p, crown, 'crown'));
  }
  return m.result;
}
