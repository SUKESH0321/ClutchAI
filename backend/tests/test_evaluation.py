import json
import math

import pytest

from app import evaluation
from app.config import load_config


def test_trial_completes_and_matched_conditions():
    cfg = load_config("default")
    t = evaluation.run_trial(cfg, 10001, 6)
    assert t.completed and t.error is None
    assert t.baseline_s > 0 and t.adaptive_s > 0
    assert t.saved_s == pytest.approx(t.baseline_s - t.adaptive_s)


def test_benchmark_metrics_match_hand_computation_and_reproducible():
    r1 = evaluation.run_benchmark(trials=5, seed_start=10000, scenarios=6)
    r2 = evaluation.run_benchmark(trials=5, seed_start=10000, scenarios=6)
    strip = lambda r: [{k: v for k, v in t.items() if "decision_ms" not in k} for t in r["trials"]]
    assert strip(r1) == strip(r2)
    s, ts = r1["summary"], r1["trials"]
    assert s["trials"] == 5 and s["completed"] == 5
    saved = [t["baseline_s"] - t["adaptive_s"] for t in ts]
    assert s["mean_saved_s"] == pytest.approx(sum(saved) / 5)
    mb = sum(t["baseline_s"] for t in ts) / 5
    ma = sum(t["adaptive_s"] for t in ts) / 5
    assert s["pct_improvement"] == pytest.approx(100 * (mb - ma) / mb)
    assert s["win_rate"] == pytest.approx(sum(x > 1e-6 for x in saved) / 5)
    assert s["wins"] + s["losses"] + s["ties"] == 5
    json.dumps(r1, allow_nan=False)          # serializes with no NaN/Infinity


def test_failed_trial_is_recorded_not_raised(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("boom")
    monkeypatch.setattr(evaluation, "build_schedule", boom)
    t = evaluation.run_trial(load_config("default"), 1, 4)
    assert not t.completed and "boom" in t.error
    s = evaluation.summarize([t], 1, "default", 0.0)
    assert s["failed_trials"] == 1 and s["completed"] == 0
    assert all(math.isfinite(v) for v in (s["mean_saved_s"], s["win_rate"], s["pct_improvement"]))


def test_export_roundtrip(tmp_path):
    r = evaluation.run_benchmark(trials=2, seed_start=1, scenarios=4)
    jp, cp = evaluation.export(r, tmp_path)
    assert json.loads(jp.read_text())["summary"]["trials"] == 2
    assert (tmp_path / "latest.json").exists() and cp.read_text().startswith("seed,")
