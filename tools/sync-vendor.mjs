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
  ['@dimforge/rapier3d-compat/LICENSE', 'RAPIER-LICENSE.txt'],
];

// rapier の compat 版は WASM を base64 で JS に埋め込んでいる。別ファイルの .wasm に分けると
// 転送が小さくなり、4MB の文字列の解析と復号も要らず、ストリーミングでコンパイルできる。
// init(source) に WASM のバイト列を渡せば（Node のテストなど）それを使う
const RAPIER_INIT =
  /function (\w+)\(\)\{return (\w+)\(this,void 0,void 0,\(function\*\(\)\{yield (\w+)\(\{module_or_path:\w+\.toByteArray\("([A-Za-z0-9+/=]+)"\)\.buffer\}\)\}\)\)\}/;
async function rapierFiles() {
  const source = await readFile('node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs', 'utf8');
  const match = source.match(RAPIER_INIT);
  if (!match)
    throw new Error(
      'rapier.mjs の初期化関数が想定と違います。tools/sync-vendor.mjs の変換を見直してください',
    );
  const [whole, name, wrap, load, base64] = match;
  const init = `function ${name}(A){return ${wrap}(this,void 0,void 0,(function*(){yield ${load}({module_or_path:A??new URL("./rapier.wasm",import.meta.url)})}))}`;
  return [
    ['rapier.mjs', Buffer.from(source.replace(whole, init))],
    ['rapier.wasm', Buffer.from(base64, 'base64')],
  ];
}

const outputs = [
  ...(await Promise.all(FILES.map(async ([from, to]) => [to, await readFile(join('node_modules', from))]))),
  ...(await rapierFiles()),
];
const check = process.argv.includes('--check');
const stale = [];
for (const [to, source] of outputs) {
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
