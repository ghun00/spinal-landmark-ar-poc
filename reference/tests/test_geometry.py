import pytest

from config import load_ratios
from geometry import classify, level_point

C, L, R = (100.0, 100.0), (60.0, 500.0), (140.0, 500.0)
MARKERS = {"C7": C, "L": L, "R": R}


def test_spec_example():
    x, y = level_point(MARKERS, 39.04)
    assert x == pytest.approx(100.0, abs=1e-6)
    assert y == pytest.approx(256.16, abs=1e-6)


def test_endpoints():
    assert level_point(MARKERS, 0) == pytest.approx(C)
    assert level_point(MARKERS, 100) == pytest.approx((100.0, 500.0))


def test_classify_order():
    markers, reason = classify([R, C, L], 1000, 0.10)
    assert reason == "ok"
    assert markers == {"C7": C, "L": L, "R": R}


def test_too_few():
    assert classify([C, L], 1000, 0.10) == (None, "too_few")


def test_too_many():
    assert classify([C, L, R, (300.0, 300.0)], 1000, 0.10) == (None, "too_many")


def test_bad_layout():
    assert classify([(100.0, 480.0), L, R], 1000, 0.10) == (None, "bad_layout")


def test_ratios_config():
    ratios = load_ratios()
    assert [n for n, _ in ratios] == [
        "T1", "T2", "T3", "T4", "T5", "T6", "T7", "L1", "L2", "L3", "L4", "L5", "S1"
    ]
    d = dict(ratios)
    assert d["T7"] == 39.04
    assert d["S1"] == 95.87
