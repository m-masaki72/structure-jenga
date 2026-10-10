import { GEOMETRY_CATALOG, makeGeometricStructure } from './structure-geometry.js';
import { NEW_STAGES, STAGE_ORDER, CHAPTERS, makeNewStage } from './structure-stages.js';

const originals = [
  ...GEOMETRY_CATALOG,
  {
    id: 'spire',
    name: '三点の塔',
    english: 'THE QUIET SPIRE',
    caption: '三つの足で、空へ。',
    challenge: 'はじめの構造',
    target: 6,
    number: '03',
  },
  {
    id: 'whale',
    name: '鯨の骨',
    english: 'BONES OF A WHALE',
    caption: '骨のあいだに、余白を。',
    challenge: '荷重の回り道',
    target: 8,
    number: '04',
  },
  {
    id: 'wing',
    name: '片持ちの翼',
    english: 'A WING IN STILL AIR',
    caption: '支えのない先端へ。',
    challenge: '左右の非対称',
    target: 7,
    number: '05',
  },
];
export const CATALOG = STAGE_ORDER.map((id, i) => ({
  ...[...NEW_STAGES, ...originals].find((spec) => spec.id === id),
  number: String(i + 1).padStart(2, '0'),
  chapter: CHAPTERS[Math.floor(i / 5)],
}));

function withFootrails(structure) {
  const feet = structure.nodes
    .map((node, i) => ({ ...node, i }))
    .filter((node) => node.fixed && node.p[1] < 0.2)
    .sort((a, b) => Math.atan2(a.p[2], a.p[0]) - Math.atan2(b.p[2], b.p[0]));
  if (feet.length < 3) return structure;
  for (let i = 0; i < feet.length; i++) {
    const a = feet[i].i,
      b = feet[(i + 1) % feet.length].i;
    if (structure.members.some((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a))) continue;
    structure.members.push({ id: structure.members.length, a, b, radius: 0.041, family: 'hoop' });
  }
  return structure;
}

// 両端が地面に固定された部材は荷重を負担しないので、入門の章以外では抜けない基礎として扱う

const anchored = (node) => (Array.isArray(node.fixed) ? node.fixed.every(Boolean) : node.fixed === true);

export function makeStructure(id = 'spire') {
  const structure = buildStructure(id);
  if (structure.chapter !== CHAPTERS[0])
    for (const member of structure.members)
      if (anchored(structure.nodes[member.a]) && anchored(structure.nodes[member.b]))
        member.foundation = true;
  return structure;
}

function buildStructure(id) {
  const spec = CATALOG.find((level) => level.id === id) ?? CATALOG[0];
  const stage = makeNewStage(spec.id);
  if (stage) return { ...stage, ...spec };
  if (GEOMETRY_CATALOG.some((item) => item.id === spec.id))
    return withFootrails({ ...makeGeometricStructure(spec.id), ...spec });
  const nodes = [],
    members = [],
    edges = new Set();
  const node = (p, fixed = false, mass = 1) => {
    nodes.push({ p, fixed, mass });
    return nodes.length - 1;
  };
  const beam = (a, b, radius = 0.043) => {
    const key = [Math.min(a, b), Math.max(a, b)].join(':');
    if (edges.has(key)) return;
    edges.add(key);
    members.push({ id: members.length, a, b, radius });
  };
  const ring = (indices) => indices.forEach((a, i) => beam(a, indices[(i + 1) % indices.length]));
  const link = (a, b, radius = 0.043) => {
    for (let j = 0; j < a.length; j++) {
      beam(a[j], b[j], radius);
      beam(a[j], b[(j + 1) % b.length], radius);
      beam(a[j], b[(j + b.length - 1) % b.length], radius);
    }
  };
  if (spec.id === 'spire') {
    let previous;
    for (let layer = 0; layer < 5; layer++) {
      const radius = [1.7, 1.48, 1.12, 0.74, 0.37][layer];
      const current = Array.from({ length: 3 }, (_, i) => {
        const angle = (i * Math.PI * 2) / 3 + Math.PI / 6 + layer * 0.065;
        return node(
          [Math.cos(angle) * radius, 0.1 + layer * 1.26, Math.sin(angle) * radius],
          layer === 0,
          layer === 4 ? 18 : 2,
        );
      });
      if (layer > 0) {
        ring(current);
        link(previous, current);
      }
      previous = current;
    }
  } else if (spec.id === 'whale') {
    let previous;
    for (let slice = 0; slice < 6; slice++) {
      const x = -3.7 + slice * 1.48;
      const width = [0.7, 1.2, 1.4, 1.28, 0.85, 0.35][slice];
      const top = [2.05, 3.02, 3.52, 3.32, 2.48, 1.65][slice];
      const bottom = [0.12, 0.8, 1.03, 0.85, 0.5, 0.12][slice];
      const current = [
        node([x, bottom, -width], slice === 0 || slice === 5),
        node([x, top, 0], false, 9),
        node([x, bottom, width], slice === 0 || slice === 5),
      ];
      ring(current);
      if (previous) link(previous, current, 0.052);
      previous = current;
    }
  } else {
    let previous;
    for (let slice = 0; slice < 5; slice++) {
      const x = -2.5 + slice * 1.3;
      const width = 1.25 - slice * 0.19;
      const y = 1.4 + slice * 0.25;
      const current = [
        node([x, y, -width], slice === 0),
        node([x, y + 1.2 - slice * 0.15, 0], slice === 0, 5),
        node([x, y, width], slice === 0),
      ];
      if (slice > 0) {
        ring(current);
        link(previous, current, 0.055);
      }
      previous = current;
    }
  }
  for (const member of members) member.radius *= spec.id === 'wing' ? 1.08 : spec.id === 'whale' ? 1.42 : 1.3;
  return withFootrails({ ...spec, nodes, members, displacementLimit: spec.id === 'wing' ? 0.075 : 0.045 });
}
