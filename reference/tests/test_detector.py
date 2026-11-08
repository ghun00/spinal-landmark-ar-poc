import gzip
import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from config import load_detection
from detector import detect
from geometry import classify

FIX = Path(__file__).resolve().parents[1] / "fixtures"
EXPECTED = json.loads((FIX / "expected.json").read_text())
CFG = load_detection()


def load_fixture(name):
    """Fixtures are committed as gzipped raw RGBA; PNGs are regenerated locally."""
    exp = EXPECTED[name]
    raw = gzip.decompress((FIX / f"{name}.rgba.gz").read_bytes())
    rgba = np.frombuffer(raw, np.uint8).reshape(exp["h"], exp["w"], 4)
    return cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGR)


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_fixture(name):
    exp = EXPECTED[name]
    img = load_fixture(name)
    res = detect(img, CFG)
    got = [(c["x"], c["y"]) for c in res["candidates"]]
    assert len(got) == len(exp["centers"])
    for ex, ey in exp["centers"]:
        d = min(((gx - ex) ** 2 + (gy - ey) ** 2) ** 0.5 for gx, gy in got)
        assert d <= 1.5, f"{name}: center ({ex},{ey}) off by {d:.2f}px"
    _, status = classify(got, exp["h"], CFG["minVerticalGapFrac"])
    assert status == exp["status"]


def test_red_rect_rejected_by_circularity():
    img = load_fixture("red_rect")
    res = detect(img, CFG)
    assert any(r["why"] == "circularity" for r in res["rejected"])


def test_synth_is_reproducible():
    from synth import SCENES, make_scene
    img, _ = make_scene("normal", SCENES["normal"])
    assert np.array_equal(img, load_fixture("normal"))
