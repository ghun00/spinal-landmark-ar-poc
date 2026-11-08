import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { loadCv } from './helpers/loadcv.js';
import { detectCandidates } from '../app/detector.js';
import { classifyMarkers } from '../app/geometry.js';

const FIX = new URL('../reference/fixtures/', import.meta.url);
const EXPECTED = JSON.parse(readFileSync(new URL('expected.json', FIX), 'utf8'));
const CFG = JSON.parse(readFileSync(new URL('../config/detection.json', import.meta.url), 'utf8'));

function fixture(name) {
  const { w, h } = EXPECTED[name];
  const data = new Uint8ClampedArray(gunzipSync(readFileSync(new URL(`${name}.rgba.gz`, FIX))));
  return { data, width: w, height: h };
}

const cv = await loadCv();

for (const name of Object.keys(EXPECTED).sort()) {
  test(`parity with Python: ${name}`, () => {
    const exp = EXPECTED[name];
    const { candidates } = detectCandidates(cv, fixture(name), CFG);
    assert.equal(candidates.length, exp.py_centers.length);
    for (const [px, py] of exp.py_centers) {
      const d = Math.min(...candidates.map((c) => Math.hypot(c.x - px, c.y - py)));
      assert.ok(d <= 1.0, `${name}: JS center off Python (${px},${py}) by ${d.toFixed(3)}px`);
    }
    const res = classifyMarkers(candidates, exp.h, CFG.minVerticalGapFrac);
    assert.equal(res.ok ? 'ok' : res.reason, exp.status);
  });
}

test('red rectangle rejected for circularity', () => {
  const { rejected } = detectCandidates(cv, fixture('red_rect'), CFG);
  assert.ok(rejected.some((r) => r.why === 'circularity'));
});

test('debug mask preview is returned when requested', () => {
  const { maskPreview } = detectCandidates(cv, fixture('normal'), CFG, { debug: true });
  assert.ok(maskPreview.width > 0 && maskPreview.data.length === maskPreview.width * maskPreview.height * 4);
});

test('no Mat leak over 300 runs', () => {
  const img = fixture('normal');
  for (let i = 0; i < 20; i++) detectCandidates(cv, img, CFG, { debug: true });
  const before = cv.HEAP8.length;
  for (let i = 0; i < 300; i++) detectCandidates(cv, img, CFG, { debug: true });
  assert.equal(cv.HEAP8.length, before);
});
