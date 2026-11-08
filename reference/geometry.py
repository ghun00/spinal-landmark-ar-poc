"""Marker classification and ratio interpolation (spec §5, §6)."""


def classify(centers, frame_h, min_gap_frac):
    """Return ({"C7","L","R"} -> (x, y), "ok") or (None, reason).

    Exactly three candidates are required. The top one is C7 and must sit at
    least min_gap_frac * frame_h above both PSIS; of the lower two, the one on
    screen-left is the subject's left PSIS (non-mirrored rear view).
    """
    if len(centers) < 3:
        return None, "too_few"
    if len(centers) > 3:
        return None, "too_many"
    c7, a, b = sorted(centers, key=lambda p: p[1])
    if min(a[1], b[1]) - c7[1] < min_gap_frac * frame_h:
        return None, "bad_layout"
    left, right = sorted((a, b), key=lambda p: p[0])
    return {"C7": c7, "L": left, "R": right}, "ok"


def level_point(markers, ratio_percent):
    """P = C + r (M - C), M = (L + R) / 2, r = ratio / 100."""
    cx, cy = markers["C7"]
    mx = (markers["L"][0] + markers["R"][0]) / 2
    my = (markers["L"][1] + markers["R"][1]) / 2
    r = ratio_percent / 100.0
    return cx + r * (mx - cx), cy + r * (my - cy)
