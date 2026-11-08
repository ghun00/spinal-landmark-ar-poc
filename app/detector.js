// Red circular sticker detection with OpenCV.js.
// Mirrors reference/detector.py step for step — keep them identical:
// resize (long side -> processLongSide, INTER_AREA) -> HSV -> inRange per
// range, OR -> morph OPEN then CLOSE (ellipse kernel) -> external contours ->
// edge / area / circularity / clutter filter -> moment centroid -> scale back to input pixels.
// Clutter: markers are discrete points. Red spots = connected components of
// the pre-morphology mask; a candidate with more than maxNeighbors spot
// centroids within max(clutterRadius*r, r+clutterRadiusMinPx) (excluding its
// own radius r = sqrt(area/pi)) is rejected as clutter.

const PREVIEW_LONG_SIDE = 160;

/**
 * @param {object} cv initialized OpenCV.js module
 * @param {{data:Uint8ClampedArray,width:number,height:number}} image RGBA
 * @param {object} cfg config/detection.json
 * @param {{debug?:boolean}} [opts]
 * @returns {{candidates:{x,y,area,circularity}[], rejected:{x,y,area,circularity,why}[], maskPreview?:{data,width,height}}}
 */
export function detectCandidates(cv, image, cfg, opts = {}) {
  const w = image.width, h = image.height;
  const m = Math.max(w, h);
  const s = m <= cfg.processLongSide ? 1 : cfg.processLongSide / m;
  const pw = s === 1 ? w : Math.floor(w * s + 0.5);
  const ph = s === 1 ? h : Math.floor(h * s + 0.5);
  const sx = pw / w, sy = ph / h;

  const mats = [];
  const keep = (x) => (mats.push(x), x);
  try {
    const rgba = keep(new cv.Mat(h, w, cv.CV_8UC4));
    rgba.data.set(image.data);
    let small = rgba;
    if (s !== 1) {
      small = keep(new cv.Mat());
      cv.resize(rgba, small, new cv.Size(pw, ph), 0, 0, cv.INTER_AREA);
    }
    const rgb = keep(new cv.Mat());
    cv.cvtColor(small, rgb, cv.COLOR_RGBA2RGB);
    const hsv = keep(new cv.Mat());
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);

    const mask = keep(cv.Mat.zeros(ph, pw, cv.CV_8UC1));
    const part = keep(new cv.Mat());
    for (const [lo, hi] of cfg.hsvRanges) {
      const lower = keep(new cv.Mat(ph, pw, cv.CV_8UC3, new cv.Scalar(lo[0], lo[1], lo[2], 0)));
      const upper = keep(new cv.Mat(ph, pw, cv.CV_8UC3, new cv.Scalar(hi[0], hi[1], hi[2], 0)));
      cv.inRange(hsv, lower, upper, part);
      cv.bitwise_or(mask, part, mask);
    }
    // Red spots before cleanup (tiny specks count) for the clutter check.
    const ccLabels = keep(new cv.Mat()), ccStats = keep(new cv.Mat()), ccCents = keep(new cv.Mat());
    const nSpots = cv.connectedComponentsWithStats(mask, ccLabels, ccStats, ccCents, 8, cv.CV_32S);
    const spots = ccCents.data64F; // [x0, y0, x1, y1, ...]; index 0 is background

    const k = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(cfg.morphKernel, cfg.morphKernel)));
    const anchor = new cv.Point(-1, -1);
    const border = cv.morphologyDefaultBorderValue();
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, k, anchor, 1, cv.BORDER_CONSTANT, border);
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, k, anchor, 1, cv.BORDER_CONSTANT, border);

    const contours = keep(new cv.MatVector());
    const hierarchy = keep(new cv.Mat());
    const work = keep(mask.clone()); // findContours may modify its input in some builds
    cv.findContours(work, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    // Debug only: per-contour fill mask for mean-HSV readout (threshold tuning).
    const fill = opts.debug ? keep(cv.Mat.zeros(ph, pw, cv.CV_8UC1)) : null;

    const frameArea = pw * ph;
    const amin = cfg.minAreaFrac * frameArea, amax = cfg.maxAreaFrac * frameArea;
    const candidates = [], rejected = [];
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      try {
        const area = cv.contourArea(c);
        const per = cv.arcLength(c, true);
        const circularity = per > 0 ? (4 * Math.PI * area) / (per * per) : 0;
        const mo = cv.moments(c);
        const x = (mo.m00 > 0 ? mo.m10 / mo.m00 : c.data32S[0]) / sx;
        const y = (mo.m00 > 0 ? mo.m01 / mo.m00 : c.data32S[1]) / sy;
        const item = { x, y, area, circularity };
        const box = cv.boundingRect(c);
        if (fill) item.hsv = meanHsv(cv, hsv, fill, contours, i, box);
        if (box.x <= 0 || box.y <= 0 || box.x + box.width >= pw || box.y + box.height >= ph) {
          // Cut off by the frame edge: not a fully visible sticker.
          rejected.push({ ...item, why: 'edge' });
        } else if (area < amin) rejected.push({ ...item, why: 'small' });
        else if (area > amax) rejected.push({ ...item, why: 'large' });
        else if (circularity < cfg.minCircularity) rejected.push({ ...item, why: 'circularity' });
        else if (neighbors(spots, nSpots, x * sx, y * sy, area, cfg) > cfg.maxNeighbors) rejected.push({ ...item, why: 'clutter' });
        else candidates.push(item);
      } finally {
        c.delete();
      }
    }
    candidates.sort((a, b) => a.y - b.y);

    const result = { candidates, rejected };
    if (opts.debug) result.maskPreview = preview(cv, mask, keep);
    return result;
  } finally {
    for (const x of mats) x.delete();
  }
}

/** Count other red spots near (cx, cy) in processed pixels. */
function neighbors(spots, nSpots, cx, cy, area, cfg) {
  const r = Math.sqrt(area / Math.PI);
  const reach = Math.max(cfg.clutterRadius * r, r + cfg.clutterRadiusMinPx);
  let n = 0;
  for (let i = 1; i < nSpots; i++) {
    const d = Math.hypot(spots[2 * i] - cx, spots[2 * i + 1] - cy);
    if (d > r && d <= reach) n++;
  }
  return n;
}

/**
 * Mean [H, S, V] of the pixels inside contour i (debug readout). Hue is
 * averaged after shifting by 90 so reds near 0 and 180 do not cancel out.
 */
function meanHsv(cv, hsv, fill, contours, i, r) {
  cv.drawContours(fill, contours, i, new cv.Scalar(255), -1);
  const W = hsv.cols, hd = hsv.data, md = fill.data;
  let n = 0, hs = 0, ss = 0, vs = 0;
  for (let y = r.y; y < r.y + r.height; y++) {
    for (let x = r.x; x < r.x + r.width; x++) {
      const k = y * W + x;
      if (!md[k]) continue;
      md[k] = 0; // leave the fill mask clean for the next contour
      hs += (hd[k * 3] + 90) % 180; ss += hd[k * 3 + 1]; vs += hd[k * 3 + 2]; n++;
    }
  }
  if (!n) return [0, 0, 0];
  return [Math.round(((hs / n) + 90) % 180), Math.round(ss / n), Math.round(vs / n)];
}

function preview(cv, mask, keep) {
  const s = Math.min(1, PREVIEW_LONG_SIDE / Math.max(mask.cols, mask.rows));
  const small = keep(new cv.Mat());
  cv.resize(mask, small, new cv.Size(Math.max(1, Math.round(mask.cols * s)), Math.max(1, Math.round(mask.rows * s))), 0, 0, cv.INTER_NEAREST);
  const rgba = keep(new cv.Mat());
  cv.cvtColor(small, rgba, cv.COLOR_GRAY2RGBA);
  return { data: new Uint8ClampedArray(rgba.data), width: rgba.cols, height: rgba.rows };
}
