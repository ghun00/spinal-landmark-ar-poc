import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCameraError } from '../app/camera.js';

const err = (name) => Object.assign(new Error(name), { name });

test('camera errors map to user-facing causes', () => {
  assert.equal(classifyCameraError(err('NotAllowedError'), true), 'denied');
  assert.equal(classifyCameraError(err('SecurityError'), true), 'denied');
  assert.equal(classifyCameraError(err('NotFoundError'), true), 'notfound');
  assert.equal(classifyCameraError(err('OverconstrainedError'), true), 'notfound');
  assert.equal(classifyCameraError(err('NotReadableError'), true), 'busy');
  assert.equal(classifyCameraError(err('AbortError'), true), 'busy');
  assert.equal(classifyCameraError(err('TypeError'), true), 'unknown');
});

test('insecure context wins over any error', () => {
  assert.equal(classifyCameraError(err('NotAllowedError'), false), 'insecure');
  assert.equal(classifyCameraError(undefined, false), 'insecure');
});
