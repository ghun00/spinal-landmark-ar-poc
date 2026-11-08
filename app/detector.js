// Red circular sticker detection with OpenCV.js.
// Mirrors reference/detector.py step for step — keep them identical:
// resize (long side -> processLongSide, INTER_AREA) -> HSV -> inRange per
// range, OR -> morph OPEN then CLOSE (ellipse kernel) -> external contours ->
// area / circularity filter -> moment centroid -> scale back to input pixels.

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
    const k = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(cfg.morphKernel, cfg.morphKernel)));
    const anchor = new cv.Point(-1, -1);
    const border = cv.morphologyDefaultBorderValue();
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, k, anchor, 1, cv.BORDER_CONSTANT, border);
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, k, anchor, 1, cv.BORDER_CONSTANT, border);

    const contours = keep(new cv.MatVector());
    const hierarchy = keep(new cv.Mat());
    const work = keep(mask.clone()); // findContours may modify its input in some builds
    cv.findContours(work, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

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
        if (area < amin) rejected.push({ ...item, why: 'small' });
        else if (area > amax) rejected.push({ ...item, why: 'large' });
        else if (circularity < cfg.minCircularity) rejected.push({ ...item, why: 'circularity' });
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

function preview(cv, mask, keep) {
  const s = Math.min(1, PREVIEW_LONG_SIDE / Math.max(mask.cols, mask.rows));
  const small = keep(new cv.Mat());
  cv.resize(mask, small, new cv.Size(Math.max(1, Math.round(mask.cols * s)), Math.max(1, Math.round(mask.rows * s))), 0, 0, cv.INTER_NEAREST);
  const rgba = keep(new cv.Mat());
  cv.cvtColor(small, rgba, cv.COLOR_GRAY2RGBA);
  return { data: new Uint8ClampedArray(rgba.data), width: rgba.cols, height: rgba.rows };
}
