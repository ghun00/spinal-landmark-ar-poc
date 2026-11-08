// Marker lock: once the three markers have been recognized stably for a few
// consecutive frames, keep those positions until the user asks to re-analyze.
// (User decision 2026-11-08: phone is mounted and the subject stands still,
// so a held result is preferred over live flicker.)

const KEYS = ['c7', 'lpsis', 'rpsis'];

/**
 * @param {{stableFrames?:number, maxJitterFrac?:number}} [opts]
 *   stableFrames: consecutive valid frames required before locking.
 *   maxJitterFrac: max per-marker movement between those frames, as a
 *   fraction of frame height; a bigger jump restarts the count.
 */
export function createMarkerLock({ stableFrames = 5, maxJitterFrac = 0.01 } = {}) {
  let window = []; // markers of consecutive stable ok frames
  let locked = null;

  const snapshot = () => {
    if (locked) return { state: 'locked', markers: locked, progress: 1 };
    if (!window.length) return { state: 'searching', markers: null, progress: 0 };
    return { state: 'stabilizing', markers: window[window.length - 1], progress: window.length / stableFrames };
  };

  return {
    /** Feed one analysis result ({reason, markers}); returns the lock state. */
    update(result, frameH) {
      if (locked) return snapshot();
      if (!result || result.reason !== 'ok' || !result.markers) {
        window = [];
        return snapshot();
      }
      const prev = window[window.length - 1];
      const tol = maxJitterFrac * frameH;
      if (prev && KEYS.some((k) => Math.hypot(result.markers[k].x - prev[k].x, result.markers[k].y - prev[k].y) > tol)) {
        window = [];
      }
      window.push(result.markers);
      if (window.length >= stableFrames) {
        locked = Object.fromEntries(KEYS.map((k) => [k, {
          x: window.reduce((a, m) => a + m[k].x, 0) / window.length,
          y: window.reduce((a, m) => a + m[k].y, 0) / window.length,
        }]));
        window = [];
      }
      return snapshot();
    },
    reset() { window = []; locked = null; },
    state: snapshot,
  };
}
