// Marker classification, ratio interpolation and the single image->screen
// transform shared by the video frame and the overlay (spec §5, §6).

/**
 * @param {{x:number,y:number}[]} centers candidate centers (source pixels)
 * @param {number} frameH source frame height
 * @param {number} minGapFrac C7 must be this fraction of frameH above both PSIS
 * @returns {{ok:true, markers:{c7,lpsis,rpsis}} | {ok:false, reason:'too_few'|'too_many'|'bad_layout'}}
 */
export function classifyMarkers(centers, frameH, minGapFrac) {
  if (centers.length < 3) return { ok: false, reason: 'too_few' };
  if (centers.length > 3) return { ok: false, reason: 'too_many' };
  const [c7, a, b] = [...centers].sort((p, q) => p.y - q.y);
  if (Math.min(a.y, b.y) - c7.y < minGapFrac * frameH) return { ok: false, reason: 'bad_layout' };
  // Non-mirrored rear view: screen-left PSIS is the subject's left PSIS.
  const [lpsis, rpsis] = a.x <= b.x ? [a, b] : [b, a];
  return { ok: true, markers: { c7, lpsis, rpsis } };
}

/** P = C + r (M - C), M = (L + R) / 2, r = ratio / 100. */
export function levelPoint(markers, ratioPercent) {
  const { c7, lpsis, rpsis } = markers;
  const mx = (lpsis.x + rpsis.x) / 2;
  const my = (lpsis.y + rpsis.y) / 2;
  const r = ratioPercent / 100;
  return { x: c7.x + r * (mx - c7.x), y: c7.y + r * (my - c7.y) };
}

/** Fit the whole source frame inside dst (letterbox), centered. */
export function containTransform(srcW, srcH, dstW, dstH) {
  const scale = Math.min(dstW / srcW, dstH / srcH);
  return { scale, ox: (dstW - srcW * scale) / 2, oy: (dstH - srcH * scale) / 2 };
}

export const toScreen = (t, p) => ({ x: t.ox + p.x * t.scale, y: t.oy + p.y * t.scale });
export const toSource = (t, p) => ({ x: (p.x - t.ox) / t.scale, y: (p.y - t.oy) / t.scale });
