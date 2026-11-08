"""Red circular sticker detection — the reference the OpenCV.js port mirrors.

Pipeline (keep identical to app/detector.js):
resize (long side -> processLongSide, INTER_AREA) -> HSV -> inRange per range,
OR -> morph OPEN then CLOSE (ellipse kernel) -> external contours ->
area / circularity filter -> moment centroid -> scale back to input pixels.
"""
import math

import cv2
import numpy as np


def _scale_for(w, h, long_side):
    m = max(w, h)
    return 1.0 if m <= long_side else long_side / m


def detect(bgr, cfg):
    h, w = bgr.shape[:2]
    s = _scale_for(w, h, cfg["processLongSide"])
    img = bgr
    if s != 1.0:
        img = cv2.resize(bgr, (int(w * s + 0.5), int(h * s + 0.5)), interpolation=cv2.INTER_AREA)
    ph, pw = img.shape[:2]
    # Use the exact per-axis ratios of the rounded size (same as app/detector.js).
    sx, sy = pw / w, ph / h

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    mask = None
    for lo, hi in cfg["hsvRanges"]:
        m = cv2.inRange(hsv, np.array(lo, np.uint8), np.array(hi, np.uint8))
        mask = m if mask is None else cv2.bitwise_or(mask, m)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (cfg["morphKernel"], cfg["morphKernel"]))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    frame_area = pw * ph
    amin, amax = cfg["minAreaFrac"] * frame_area, cfg["maxAreaFrac"] * frame_area
    candidates, rejected = [], []
    for c in contours:
        area = cv2.contourArea(c)
        per = cv2.arcLength(c, True)
        circ = 4 * math.pi * area / (per * per) if per > 0 else 0.0
        mo = cv2.moments(c)
        if mo["m00"] > 0:
            x, y = mo["m10"] / mo["m00"] / sx, mo["m01"] / mo["m00"] / sy
        else:
            x, y = c[0][0][0] / sx, c[0][0][1] / sy
        item = {"x": float(x), "y": float(y), "area": float(area), "circularity": float(circ)}
        if area < amin:
            rejected.append({**item, "why": "small"})
        elif area > amax:
            rejected.append({**item, "why": "large"})
        elif circ < cfg["minCircularity"]:
            rejected.append({**item, "why": "circularity"})
        else:
            candidates.append(item)
    candidates.sort(key=lambda d: d["y"])
    return {"candidates": candidates, "rejected": rejected, "mask": mask}
