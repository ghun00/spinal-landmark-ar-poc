import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutLabels } from '../app/labels.js';

const RATIOS = { L1: 73.13, L2: 78.21, L3: 83.90, L4: 87.69, L5: 92.82, S1: 95.87 };
const box = { w: 390, h: 640 };
const opts = { lineH: 18, gap: 10, labelW: 34 };

test('clustered lumbar labels never overlap, stay in box, dots unchanged', () => {
  const items = Object.entries(RATIOS).map(([name, r]) => ({ name, x: 200, y: 20 + 300 * r / 100 }));
  const out = layoutLabels(items, box, opts);
  assert.equal(out.length, items.length);
  for (const it of items) {
    const o = out.find((q) => q.name === it.name);
    assert.equal(o.x, it.x); assert.equal(o.y, it.y);
    assert.ok(o.ly - opts.lineH / 2 >= 0 && o.ly + opts.lineH / 2 <= box.h, `${o.name} out of box`);
  }
  const ys = out.map((o) => o.ly).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= opts.lineH - 1e-9, 'labels overlap');
  assert.ok(out.some((o) => o.displaced));
});

test('point near right edge puts label on the left', () => {
  const [o] = layoutLabels([{ name: 'T1', x: box.w - 5, y: 100 }], box, opts);
  assert.equal(o.side, 'left');
  assert.ok(o.lx + opts.labelW <= box.w);
  assert.equal(o.displaced, false);
});

test('labels pushed past bottom are stacked upward inside the box', () => {
  const items = ['A', 'B', 'C'].map((name) => ({ name, x: 100, y: box.h - 2 }));
  const out = layoutLabels(items, box, opts);
  for (const o of out) assert.ok(o.ly + opts.lineH / 2 <= box.h + 1e-9);
});
