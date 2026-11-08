// Load the pinned browser build of OpenCV.js in Node for parity tests.
// package.json sets "type":"module", so the UMD file is evaluated through a
// CommonJS-style wrapper (sloppy mode) instead of require().
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const CV_URL = new URL('../../vendor/opencv-4.13.0.js', import.meta.url);

let cached;
export function loadCv() {
  cached ??= (async () => {
    const src = readFileSync(CV_URL, 'utf8');
    const module = { exports: {} };
    const file = fileURLToPath(CV_URL);
    const fn = vm.runInThisContext(`(function (module, exports, require, __dirname, __filename) {\n${src}\n})`, { filename: file });
    fn(module, module.exports, createRequire(file), dirname(file), file);
    let cv = module.exports;
    if (cv && typeof cv.then === 'function') {
      // The Emscripten Module is a thenable resolving to itself; drop `then`
      // once it fires so awaiting the result does not loop forever.
      cv = await new Promise((resolve) => cv.then((m) => { delete m.then; resolve(m); }));
    } else if (!cv.Mat) {
      await new Promise((resolve) => { cv.onRuntimeInitialized = resolve; });
    }
    return cv;
  })();
  return cached;
}
