"""Generate synthetic test scenes: skin-tone background + red round stickers.

Run: .venv/bin/python reference/synth.py
Writes reference/fixtures/<name>.png, <name>.rgba.gz (gzipped raw RGBA), expected.json.
"""
import gzip
import json
import math
import zlib
from pathlib import Path

import cv2
import numpy as np

from config import load_detection
from detector import detect
from geometry import classify

FIX = Path(__file__).resolve().parent / "fixtures"
RED = (40, 40, 210)        # BGR
ORANGE = (0, 140, 255)     # BGR, hue ~16 -> outside red ranges
SHIFT = 4                  # sub-pixel drawing precision (1/16 px)

PORTRAIT = {"C7": (362.5, 250.25), "L": (288.75, 905.5), "R": (441.25, 898.0)}


def background(w, h, seed, warm=False):
    rng = np.random.default_rng(seed)
    top, bot = np.array([150, 180, 222.0]), np.array([118, 148, 196.0])
    if warm:
        # Warm-lit skin as measured (photo + S25 camera): H 8-10, S ~105-120,
        # i.e. above the old S>=100 floor that let skin through.
        top, bot = np.array([106, 134, 200.0]), np.array([84, 106, 158.0])
    t = np.linspace(0, 1, h)[:, None, None]
    img = (top * (1 - t) + bot * t) * np.ones((h, w, 3))
    # Tiled 64x64 noise patch: realistic texture, but keeps fixture files small.
    patch = rng.normal(0, 3, (64, 64, 3))
    img += np.tile(patch, (h // 64 + 1, w // 64 + 1, 1))[:h, :w]
    return np.clip(img, 0, 255).astype(np.uint8)


def circle(img, center, r, color):
    f = 1 << SHIFT
    c = (int(round(center[0] * f)), int(round(center[1] * f)))
    cv2.circle(img, c, int(round(r * f)), color, -1, cv2.LINE_AA, SHIFT)


def rotate(pts, angle_deg, cx, cy):
    a = math.radians(angle_deg)
    out = {}
    for k, (x, y) in pts.items():
        dx, dy = x - cx, y - cy
        out[k] = (cx + dx * math.cos(a) - dy * math.sin(a), cy + dx * math.sin(a) + dy * math.cos(a))
    return out


def scale_about(pts, s, cx, cy):
    return {k: (cx + (x - cx) * s, cy + (y - cy) * s) for k, (x, y) in pts.items()}


SCENES = {
    "normal": dict(w=720, h=1280, pts=PORTRAIT, r=18, status="ok"),
    "small_far": dict(w=720, h=1280, pts=scale_about(PORTRAIT, 0.5, 360, 600), r=9, status="ok"),
    "dim": dict(w=720, h=1280, pts=PORTRAIT, r=18, dim=0.6, status="ok"),
    "rotated": dict(w=720, h=1280, pts=rotate(PORTRAIT, 8, 360, 640), r=18, status="ok"),
    "landscape": dict(w=1280, h=720,
                      pts={"C7": (640.5, 120.25), "L": (588.0, 560.75), "R": (693.5, 556.0)},
                      r=16, status="ok"),
    "occluded": dict(w=720, h=1280, pts={k: v for k, v in PORTRAIT.items() if k != "R"},
                     r=18, status="too_few"),
    "extra_red": dict(w=720, h=1280, pts={**PORTRAIT, "X": (150.0, 600.0)}, r=18, status="too_many"),
    "red_rect": dict(w=720, h=1280, pts=PORTRAIT, r=18, rect=((100, 700), (160, 720)), status="ok"),
    "bad_layout": dict(w=720, h=1280, pts={**PORTRAIT, "C7": (362.5, 880.0)}, r=18, status="bad_layout"),
    "orange_tape": dict(w=720, h=1280, pts=PORTRAIT, r=18, orange=(560.0, 600.0), status="ok"),
    # Regression: skin saturation above the old S>=100 threshold made the whole
    # back "red"; stickers are pinkish red (H~177, S~175-185) as in the real photo.
    # A red object cut off by the frame edge (e.g. an ear at the top of the
    # photo) is not a sticker: stickers must be fully in frame.
    "edge_red": dict(w=720, h=1280, pts=PORTRAIT, r=18, edge=(300.0, 4.0), status="ok"),
    "warm_skin": dict(w=720, h=1280, pts=PORTRAIT, r=14, warm=True, color=(84, 69, 215), status="ok"),
    # Far away: ~9 px stickers on warm skin (S25 lost stickers at distance).
    # S25 screenshot: shadowed skin along arm/armpit edges read as H 7-10,
    # S 140-160, V 90-115 (round-ish specks), plus slightly elongated red
    # fragments (circularity 0.71-0.78). Stickers stayed H 176-179, circ >= 0.83.
    "shadow_skin": dict(w=720, h=1280, pts=PORTRAIT, r=12, warm=True, color=(84, 69, 215),
                        shadow_dots=[(120.0, 700.0), (600.0, 720.0), (140.0, 980.0)],
                        red_ellipses=[(560.0, 450.0), (170.0, 470.0)], status="ok"),
    # Markers are discrete points: a round red blob surrounded by red specks
    # (textured shadow edge, same hue as the stickers) is not a marker.
    "cluster": dict(w=720, h=1280, pts=PORTRAIT, r=12, warm=True, color=(84, 69, 215),
                    cluster=(150.0, 640.0), status="ok"),
    "far_warm": dict(w=720, h=1280, pts=scale_about(PORTRAIT, 0.35, 360, 600), r=4.5, warm=True,
                     color=(84, 69, 215), status="ok"),
}


def make_scene(name, spec):
    img = background(spec["w"], spec["h"], seed=zlib.crc32(name.encode()), warm=spec.get("warm", False))
    for p in spec["pts"].values():
        circle(img, p, spec["r"], spec.get("color", RED))
    if "rect" in spec:
        cv2.rectangle(img, spec["rect"][0], spec["rect"][1], RED, -1)
    for p in spec.get("shadow_dots", []):
        circle(img, p, 6, (41, 59, 100))          # H~9, S~150, V~100: shadowed skin
    for (ex, ey) in spec.get("red_ellipses", []):
        f = 1 << SHIFT                             # 8x4 / 10x5 px ellipses: circularity ~0.76
        cv2.ellipse(img, (int(ex * f), int(ey * f)), (8 * f, 4 * f) if ex > 360 else (10 * f, 5 * f), 30, 0, 360,
                    spec.get("color", RED), -1, cv2.LINE_AA, SHIFT)
    if "cluster" in spec:
        cx, cy = spec["cluster"]
        circle(img, (cx, cy), 7, spec.get("color", RED))
        for k in range(14):                        # ring of specks 12-24 px out
            a = k * 2 * math.pi / 14
            d = 12 + 12 * ((k * 7) % 5) / 4
            circle(img, (cx + d * math.cos(a), cy + d * math.sin(a)), 1.6, spec.get("color", RED))
    if "edge" in spec:
        circle(img, spec["edge"], 16, RED)
    if "orange" in spec:
        circle(img, spec["orange"], 18, ORANGE)
    if "dim" in spec:
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[..., 2] *= spec["dim"]
        img = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    expected = {
        "w": spec["w"], "h": spec["h"],
        "centers": [list(p) for p in spec["pts"].values()],
        "status": spec["status"],
    }
    return img, expected


def main():
    FIX.mkdir(exist_ok=True)
    cfg = load_detection()
    out = {}
    for name, spec in SCENES.items():
        img, exp = make_scene(name, spec)
        cv2.imwrite(str(FIX / f"{name}.png"), img)
        (FIX / f"{name}.rgba.gz").write_bytes(
            gzip.compress(cv2.cvtColor(img, cv2.COLOR_BGR2RGBA).tobytes(), mtime=0))
        res = detect(img, cfg)
        exp["py_centers"] = [[c["x"], c["y"]] for c in res["candidates"]]
        _, status = classify([tuple(c) for c in exp["py_centers"]], exp["h"], cfg["minVerticalGapFrac"])
        exp["py_status"] = status
        out[name] = exp
        print(f"{name:12s} expected={exp['status']:10s} detected={len(exp['py_centers'])} status={status}")
    (FIX / "expected.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
