import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMarkerLock } from '../app/lock.js';

const H = 1280;
const ok = (dx = 0) => ({ reason: 'ok', markers: { c7: { x: 360 + dx, y: 250 }, lpsis: { x: 290 + dx, y: 900 }, rpsis: { x: 440 + dx, y: 900 } } });
const miss = { reason: 'too_few', markers: null };

test('locks after N consecutive stable ok frames, with averaged markers', () => {
  const lock = createMarkerLock({ stableFrames: 3, maxJitterFrac: 0.01 });
  assert.equal(lock.update(ok(0), H).state, 'stabilizing');
  assert.equal(lock.update(ok(2), H).state, 'stabilizing');
  const s = lock.update(ok(4), H);
  assert.equal(s.state, 'locked');
  assert.equal(s.markers.c7.x, 362); // mean of 360, 362, 364
});

test('a missed frame restarts stabilization', () => {
  const lock = createMarkerLock({ stableFrames: 3 });
  lock.update(ok(), H); lock.update(ok(), H);
  assert.deepEqual(lock.update(miss, H), { state: 'searching', markers: null, progress: 0 });
  assert.equal(lock.update(ok(), H).state, 'stabilizing');
});

test('large jump between ok frames restarts stabilization', () => {
  const lock = createMarkerLock({ stableFrames: 3, maxJitterFrac: 0.01 }); // 12.8px at H=1280
  lock.update(ok(0), H); lock.update(ok(0), H);
  const s = lock.update(ok(40), H);
  assert.equal(s.state, 'stabilizing');
  assert.equal(s.progress, 1 / 3);
});

test('once locked, later frames (even misses) do not change the markers', () => {
  const lock = createMarkerLock({ stableFrames: 1 });
  const locked = lock.update(ok(0), H);
  assert.equal(locked.state, 'locked');
  assert.deepEqual(lock.update(miss, H), locked);
  assert.deepEqual(lock.update(ok(100), H), locked);
});

test('reset returns to searching and re-analyzes', () => {
  const lock = createMarkerLock({ stableFrames: 1 });
  lock.update(ok(0), H);
  lock.reset();
  assert.equal(lock.state().state, 'searching');
  assert.equal(lock.update(ok(50), H).markers.c7.x, 410);
});
