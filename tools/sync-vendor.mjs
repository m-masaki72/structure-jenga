// node_modules の three / rapier を dist/vendor へ写す。--check なら差分があるときに失敗するだけ
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const FILES = [
  ['three/build/three.module.js', 'three.module.js'],
  ['three/build/three.core.js', 'three.core.js'],
  ['three/LICENSE', 'THREE-LICENSE.txt'],
  ['three/examples/jsm/controls/OrbitControls.js', 'addons/controls/OrbitControls.js'],
  ['three/examples/jsm/geometries/RoundedBoxGeometry.js', 'addons/geometries/RoundedBoxGeometry.js'],
  ['three/examples/jsm/objects/Sky.js', 'addons/objects/Sky.js'],
  ['@dimforge/rapier3d-compat/dist/rapier.mjs', 'rapier.mjs'],
  ['@dimforge/rapier3d-compat/LICENSE', 'RAPIER-LICENSE.txt'],
];
const check = process.argv.includes('--check');
const stale = [];
for (const [from, to] of FILES) {
  const source = await readFile(join('node_modules', from));
  const target = join('dist/vendor', to);
  const current = await readFile(target).catch(() => null);
  if (current?.equals(source)) continue;
  stale.push(to);
  if (!check) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
  }
}
if (check && stale.length) {
  console.error(`dist/vendor is out of sync with node_modules: ${stale.join(', ')}`);
  console.error('Run `npm run vendor` and commit the result.');
  process.exit(1);
}
console.log(stale.length ? `updated: ${stale.join(', ')}` : 'dist/vendor is in sync');
