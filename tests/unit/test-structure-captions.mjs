import test from 'node:test';
import assert from 'node:assert/strict';
import { StructureCaptions, LOCAL_IMPRESSIONS, impressionBand } from '../../dist/js/structure-captions.js';

test('48 built-in captions follow audible resistance bands', () => {
  assert.equal(new Set(Object.values(LOCAL_IMPRESSIONS).flat()).size, 48);
  assert.deepEqual(
    [0, 0.18, 0.19, 0.4, 0.41, 0.72, 0.73, 1].map((grip) => impressionBand({ grip })),
    ['loose', 'loose', 'light', 'light', 'firm', 'firm', 'tight', 'tight'],
  );
});

test('each band uses all twelve captions before repeating without consecutive duplicates', () => {
  const captions = new StructureCaptions({ random: () => 0.3 });
  for (const grip of [0, 0.3, 0.6, 0.9]) {
    const results = Array.from({ length: 36 }, () => captions.describe({ grip }));
    for (let offset = 0; offset < 36; offset += 12)
      assert.equal(new Set(results.slice(offset, offset + 12).map(({ text }) => text)).size, 12);
    assert.ok(
      results.every(({ text, source }, index) => source === 'local' && text !== results[index - 1]?.text),
    );
  }
});

test('cancel invalidates pending audio operations', () => {
  const captions = new StructureCaptions();
  const before = captions.sequence;
  captions.cancel();
  assert.equal(captions.sequence, before + 1);
});
