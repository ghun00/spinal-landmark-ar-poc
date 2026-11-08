import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMarkers, levelPoint, containTransform, toScreen, toSource } from '../app/geometry.js';

const C = { x: 100, y: 100 }, L = { x: 60, y: 500 }, R = { x: 140, y: 500 };
const M = { c7: C, lpsis: L, rpsis: R };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('spec example: T7 -> (100, 256.16)', () => {
  const p = levelPoint(M, 39.04);
  near(p.x, 100); near(p.y, 256.16);
});

test('endpoints: 0% = C7, 100% = PSIS midpoint', () => {
  assert.deepEqual(levelPoint(M, 0), C);
  const p = levelPoint(M, 100);
  near(p.x, 100); near(p.y, 500);
});

test('classify order', () => {
  assert.deepEqual(classifyMarkers([R, C, L], 1000, 0.1), { ok: true, markers: { c7: C, lpsis: L, rpsis: R } });
});

test('classify too_few / too_many / bad_layout', () => {
  assert.deepEqual(classifyMarkers([C, L], 1000, 0.1), { ok: false, reason: 'too_few' });
  assert.deepEqual(classifyMarkers([C, L, R, { x: 300, y: 300 }], 1000, 0.1), { ok: false, reason: 'too_many' });
  assert.deepEqual(classifyMarkers([{ x: 100, y: 480 }, L, R], 1000, 0.1), { ok: false, reason: 'bad_layout' });
});

test('containTransform portrait source letterboxed and round-trips', () => {
  const t = containTransform(720, 1280, 390, 600);
  const s = Math.min(390 / 720, 600 / 1280);
  near(t.scale, s);
  near(t.ox, (390 - 720 * s) / 2); near(t.oy, (600 - 1280 * s) / 2);
  const p = { x: 123.4, y: 987.6 };
  const q = toSource(t, toScreen(t, p));
  near(q.x, p.x, 1e-9); near(q.y, p.y, 1e-9);
});

test('containTransform landscape source round-trips', () => {
  const t = containTransform(1280, 720, 390, 600);
  near(t.scale, 390 / 1280);
  near(t.ox, 0);
  const p = { x: 640, y: 360 };
  const q = toScreen(t, p);
  near(q.x, 195); near(q.y, 300);
  const back = toSource(t, q);
  near(back.x, 640, 1e-9); near(back.y, 360, 1e-9);
});
