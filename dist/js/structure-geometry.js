const TAU = Math.PI * 2;

export const GEOMETRY_CATALOG = [
  {
    id: 'hyperboloid',
    name: '双曲の塔',
    english: 'HYPERBOLOID',
    caption: '直線が、曲面をつくる。',
    challenge: '二つの直線族',
    target: 8,
    number: '01',
    formula: 'x² + z² = r²(1 + t²)',
  },
  {
    id: 'shell',
    name: '星の球殻',
    english: 'CELESTIAL SHELL',
    caption: '空を包む、三角形。',
    challenge: '曲率に荷重を逃がす',
    target: 5,
    number: '02',
    formula: '(x² + z²)/r² + t² = 1',
  },
];

function framework(spec, radius) {
  const nodes = [],
    members = [],
    edges = new Set();
  const node = (p, fixed = false, mass = 1) => {
    nodes.push({ p, fixed, mass });
    return nodes.length - 1;
  };
  const beam = (a, b, family = 'lattice') => {
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (a === b || edges.has(key) || (nodes[a].fixed && nodes[b].fixed)) return;
    edges.add(key);
    members.push({ id: members.length, a, b, radius, modulus: 4e8, strength: 3.2e6, density: 620, family });
  };
  const ring = (indices) => indices.forEach((a, i) => beam(a, indices[(i + 1) % indices.length], 'hoop'));
  return { node, beam, ring, result: { ...spec, nodes, members, displacementLimit: 0.055 } };
}

export function makeHyperboloid() {
  const model = framework(GEOMETRY_CATALOG[0], 0.049);
  const count = 8,
    layers = 5,
    waist = 1.22,
    height = 5.35;
  const rings = [];
  for (let layer = 0; layer < layers; layer++) {
    const alpha = ((layer - (layers - 1) / 2) * Math.PI) / count;
    const radius = waist / Math.cos(alpha);
    const y = 0.12 + (height / 2) * (Math.tan(alpha) + 1);
    const current = Array.from({ length: count }, (_, i) => {
      const angle = (i * TAU) / count + alpha;
      return model.node(
        [radius * Math.cos(angle), y, radius * Math.sin(angle)],
        layer === 0,
        layer === layers - 1 ? 3 : 1,
      );
    });
    model.ring(current);
    if (layer > 0) {
      const previous = rings[layer - 1];
      for (let i = 0; i < count; i++) {
        model.beam(previous[i], current[i], 'ruling-a');
        model.beam(previous[i], current[(i + count - 1) % count], 'ruling-b');
        if ((i + layer) % 2 === 0) model.beam(previous[i], current[(i + 1) % count], 'brace');
      }
    }
    rings.push(current);
  }
  model.result.geometry = { type: 'hyperboloid', waist, height, count, layers };
  return model.result;
}

export function makeSphericalShell() {
  const model = framework(GEOMETRY_CATALOG[1], 0.053);
  const count = 8,
    layers = 5,
    radius = 3.15,
    height = 3.5;
  const rings = [];
  for (let layer = 0; layer < layers; layer++) {
    const latitude = (layer * Math.PI) / 9;
    const current = Array.from({ length: count }, (_, i) => {
      const angle = (i * TAU) / count - (layer * Math.PI) / count;
      return model.node(
        [
          radius * Math.cos(latitude) * Math.cos(angle),
          0.12 + height * Math.sin(latitude),
          radius * Math.cos(latitude) * Math.sin(angle),
        ],
        layer === 0,
        1.2,
      );
    });
    model.ring(current);
    if (layer > 0) {
      const previous = rings[layer - 1];
      for (let i = 0; i < count; i++) {
        model.beam(previous[i], current[i], 'meridian-a');
        model.beam(previous[i], current[(i + 1) % count], 'meridian-b');
        if (layer <= 3 && i % 2 === 0) model.beam(previous[i], current[(i + count - 1) % count], 'brace');
      }
    }
    rings.push(current);
  }
  const crown = model.node([0, 0.12 + height, 0], false, 3);
  rings.at(-1).forEach((index) => model.beam(index, crown, 'crown'));
  model.result.geometry = { type: 'spherical-shell', radius, height, count, layers };
  return model.result;
}

export function makeGeometricStructure(id = 'hyperboloid') {
  return id === 'shell' ? makeSphericalShell() : makeHyperboloid();
}
