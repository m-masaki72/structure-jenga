export const FOUNDATION = { halfSize: 4.5, halfHeight: 0.135, centerY: -0.145 };

export function memberProfile(member, nodes) {
  const a = nodes[member.a].p,
    b = nodes[member.b].p;
  const length = Math.hypot(...a.map((value, i) => b[i] - value));
  const column = Math.abs(b[1] - a[1]) / length > 0.8;
  return { column, radius: member.radius * (column ? 2.3 : 1.9) };
}
