import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markerTag } from '../app/markerTag.js';

const cands = (n) => Array.from({ length: n }, (_, i) => ({ x: i, y: i }));

test('no result yet -> 0/3, idle', () => {
  assert.deepEqual(markerTag(null), { text: '마커 0/3', tone: 'idle' });
});

test('partial detection -> n/3, warn', () => {
  assert.deepEqual(markerTag({ candidates: cands(1), reason: 'too_few' }), { text: '마커 1/3', tone: 'warn' });
  assert.deepEqual(markerTag({ candidates: cands(2), reason: 'too_few' }), { text: '마커 2/3', tone: 'warn' });
});

test('all three classified -> 3/3, ok', () => {
  assert.deepEqual(markerTag({ candidates: cands(3), reason: 'ok', markers: {} }), { text: '마커 3/3', tone: 'ok' });
});

test('three found but bad layout -> 3/3 with hint, warn', () => {
  assert.deepEqual(markerTag({ candidates: cands(3), reason: 'bad_layout' }), { text: '마커 3/3 · 배치 확인', tone: 'warn' });
});

test('too many candidates -> count shown with hint, error', () => {
  assert.deepEqual(markerTag({ candidates: cands(5), reason: 'too_many' }), { text: '마커 5/3 · 후보 과다', tone: 'error' });
});
