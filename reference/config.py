"""Load the shared config files (same JSON the web app reads)."""
import json
from pathlib import Path

CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"


def load_ratios():
    data = json.loads((CONFIG_DIR / "ratios.json").read_text(encoding="utf-8"))
    return [(lv["name"], float(lv["ratio"])) for lv in data["levels"]]


def load_detection():
    return json.loads((CONFIG_DIR / "detection.json").read_text(encoding="utf-8"))
