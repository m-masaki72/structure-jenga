export const CONDITIONS = {
  calm: { name: '自重', label: '静かな日', loads: [[0, 0]], multiplier: 1 },
  wind: { name: '風', label: '横風のなかで', loads: [[0.48, 0.22]], multiplier: 1.25 },
  quake: {
    name: '揺れ',
    label: '揺れる地面',
    loads: [
      [0.72, 0.32],
      [-0.72, -0.32],
    ],
    multiplier: 1.5,
  },
};

export const length = (a, b) => Math.hypot(...a.map((v, i) => b[i] - v));

function factor(matrix, n) {
  const lower = new Float64Array(n * n);
  const scale = Math.max(...Array.from({ length: n }, (_, i) => matrix[i * n + i]), 1);
  let minimum = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = matrix[i * n + j];
      for (let k = 0; k < j; k++) sum -= lower[i * n + k] * lower[j * n + k];
      if (i === j) {
        if (sum <= scale * 1e-10) {
          const mode = new Float64Array(n);
          mode[i] = 1;
          for (let k = i - 1; k >= 0; k--) {
            let value = 0;
            for (let m = k + 1; m <= i; m++) value += lower[m * n + k] * mode[m];
            mode[k] = -value / lower[k * n + k];
          }
          const max = Math.max(...mode.map(Math.abs), 1e-12);
          return { singular: true, mode: mode.map((v) => v / max) };
        }
        lower[i * n + j] = Math.sqrt(sum);
        minimum = Math.min(minimum, sum / scale);
      } else lower[i * n + j] = sum / lower[j * n + j];
    }
  }
  return { lower, minimum };
}

function solve(lower, rhs) {
  const n = rhs.length;
  const result = new Float64Array(rhs);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) result[i] -= lower[i * n + j] * result[j];
    result[i] /= lower[i * n + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) result[i] -= lower[j * n + i] * result[j];
    result[i] /= lower[i * n + i];
  }
  return result;
}

export function prepareAnalysis(structure, removed = new Set()) {
  const { nodes } = structure;
  const members = structure.members.filter((m) => !removed.has(m.id));
  const dofs = nodes.map(() => [-1, -1, -1]);
  let size = 0;
  nodes.forEach((node, i) => {
    for (let axis = 0; axis < 3; axis++)
      if (!(Array.isArray(node.fixed) ? node.fixed[axis] : node.fixed)) dofs[i][axis] = size++;
  });
  const matrix = new Float64Array(size * size);
  const masses = nodes.map((node) => node.mass ?? 1);
  const data = members.map((member) => {
    const a = nodes[member.a].p,
      b = nodes[member.b].p;
    const span = length(a, b);
    const direction = a.map((v, i) => (b[i] - v) / span);
    const area = member.area ?? Math.PI * member.radius ** 2;
    const inertia = member.inertia ?? (Math.PI * member.radius ** 4) / 4;
    const modulus = member.modulus ?? 2e8;
    const stiffness = (modulus * area) / span;
    const mass = area * span * (member.density ?? 620);
    masses[member.a] += mass / 2;
    masses[member.b] += mass / 2;
    const indices = [...dofs[member.a], ...dofs[member.b]];
    const vector = [...direction.map((v) => -v), ...direction];
    for (let i = 0; i < 6; i++) {
      if (indices[i] < 0) continue;
      for (let j = 0; j < 6; j++) {
        if (indices[j] < 0) continue;
        const transverse = ((12 * modulus * inertia) / span ** 3) * (member.jointFlex ?? 0);
        const sign = (i < 3 ? -1 : 1) * (j < 3 ? -1 : 1);
        matrix[indices[i] * size + indices[j]] +=
          stiffness * vector[i] * vector[j] +
          transverse * sign * ((i % 3 === j % 3 ? 1 : 0) - direction[i % 3] * direction[j % 3]);
      }
    }
    return {
      ...member,
      span,
      direction,
      area,
      stiffness,
      mass,
      tensionCapacity: area * (member.strength ?? 1.6e6),
      compressionCapacity: Math.min(
        area * (member.strength ?? 1.6e6),
        (Math.PI ** 2 * modulus * inertia) / span ** 2,
      ),
    };
  });
  const decomposition = factor(matrix, size);
  const expand = (vector) => dofs.map((axes) => axes.map((index) => (index < 0 ? 0 : vector[index])));
  if (decomposition.singular)
    return () => ({
      stable: false,
      reason: 'mechanism',
      displacement: expand(decomposition.mode),
      members: new Map(),
      margin: 0,
      maxDisplacement: Infinity,
      mass: masses.reduce((a, b) => a + b, 0),
    });
  const evaluate = ([windX = 0, windZ = 0] = []) => {
    const rhs = new Float64Array(size);
    nodes.forEach((node, i) => {
      const gravity = masses[i] * 9.81;
      const force = [gravity * windX, -gravity, gravity * windZ];
      if (node.force) for (let j = 0; j < 3; j++) force[j] += node.force[j];
      for (let j = 0; j < 3; j++) if (dofs[i][j] >= 0) rhs[dofs[i][j]] = force[j];
    });
    const flat = solve(decomposition.lower, rhs);
    const result = measure(expand(flat));
    // 残差は検証用。毎ステップ O(n²) を払わないよう、読まれたときだけ計算する
    Object.defineProperty(result, 'residual', {
      enumerable: true,
      get() {
        let residual = 0;
        for (let i = 0; i < size; i++) {
          let value = -rhs[i];
          for (let j = 0; j < size; j++) value += matrix[i * size + j] * flat[j];
          residual = Math.max(residual, Math.abs(value));
        }
        return residual;
      },
    });
    return result;
  };
  const measure = (displacement) => {
    let maxUtilization = 0,
      energy = 0;
    const forces = new Map(
      data.map((m) => {
        const extension = m.direction.reduce(
          (sum, v, axis) => sum + v * (displacement[m.b][axis] - displacement[m.a][axis]),
          0,
        );
        const force = m.stiffness * extension;
        const utilization = Math.abs(force) / (force >= 0 ? m.tensionCapacity : m.compressionCapacity);
        const strainEnergy = force ** 2 / (2 * m.stiffness);
        maxUtilization = Math.max(maxUtilization, utilization);
        energy += strainEnergy;
        return [m.id, { ...m, force, utilization, energy: strainEnergy }];
      }),
    );
    const maxDisplacement = Math.max(0, ...displacement.map((p) => Math.hypot(...p)));
    const driftRatio = maxDisplacement / (structure.displacementLimit ?? 0.045);
    return {
      stable: maxUtilization < 1 && driftRatio < 1,
      reason: maxUtilization >= 1 ? 'capacity' : driftRatio >= 1 ? 'drift' : null,
      members: forces,
      displacement,
      maxDisplacement,
      maxUtilization,
      energy,
      residual: 0,
      margin: Math.max(0, 1 - Math.max(maxUtilization, driftRatio)),
      mass: masses.reduce((a, b) => a + b, 0),
      stiffness: decomposition.minimum,
    };
  };
  evaluate.measure = measure;
  return evaluate;
}

export function analyze(structure, removed = new Set(), condition = 'calm') {
  const evaluate = prepareAnalysis(structure, removed);
  const cases = (Array.isArray(condition) ? [condition] : CONDITIONS[condition].loads).map(evaluate);
  return cases.reduce((worst, next) =>
    next.margin < worst.margin || (!next.stable && worst.stable) ? next : worst,
  );
}
