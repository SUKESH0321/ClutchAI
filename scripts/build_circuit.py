"""Build a frontend circuit file from a TUM FTM racetrack-database CSV.

Usage (from repo root):
    backend/.venv/Scripts/python.exe -I scripts/build_circuit.py --all           # every circuit in scripts/circuits_catalog.json
    backend/.venv/Scripts/python.exe -I scripts/build_circuit.py spa             # one circuit

Input columns: x_m, y_m, w_tr_right_m, w_tr_left_m (centerline + half-widths, local metres).
Output: data/circuits/<id>.json (resampled to equal arc-length spacing). That directory is the single source of truth:
the backend reads it for simulation parameters, the web app imports it for rendering and previews, the Godot client has a copy.

Everything not present in the source (start/finish location, pit lane, sectors, corner numbers) is
derived here and flagged as approximate in the output metadata.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np

N = 720  # resampled points


def load(csv_path: Path) -> np.ndarray:
    rows = []
    for line in csv_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(",")
        if len(parts) != 4:
            raise ValueError(f"bad row: {line!r}")
        rows.append([float(p) for p in parts])  # raises on non-numeric input
    arr = np.array(rows)
    if not np.isfinite(arr).all():
        raise ValueError("non-finite values in source")
    return arr


def resample_closed(pts: np.ndarray, n: int) -> tuple[np.ndarray, float]:
    closed = np.vstack([pts, pts[:1]])
    seg = np.hypot(*np.diff(closed[:, :2], axis=0).T)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    total = float(cum[-1])
    s = np.linspace(0.0, total, n, endpoint=False)
    out = np.column_stack([np.interp(s, cum, closed[:, k]) for k in range(closed.shape[1])])
    return out, total


def smooth_closed(a: np.ndarray, k: int) -> np.ndarray:
    ker = np.ones(2 * k + 1) / (2 * k + 1)
    ext = np.concatenate([a[-k:], a, a[:k]])
    return np.convolve(ext, ker, mode="valid")


def smoothstep(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


CATALOG = Path(__file__).with_name("circuits_catalog.json")
OUT_DIR = Path("data/circuits")


def build(cid: str, meta: dict) -> None:
    csv_path = Path("data/raw") / meta["csv"]
    name, place = meta["name"], f'{meta["location"]}, {meta["country"]}'
    raw = load(csv_path)
    gap = float(np.hypot(*(raw[0, :2] - raw[-1, :2])))
    pts, length = resample_closed(raw, N)
    step = length / N

    # signed area: >0 counter-clockwise (y up), <0 clockwise
    x, y = pts[:, 0], pts[:, 1]
    area = 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))
    clockwise = area < 0

    # centre on the origin; scene uses (x, z=-y) so that y-up maths coordinates are not mirrored
    cx, cy = float(x.mean()), float(y.mean())
    x, y = x - cx, y - cy

    # tangent / curvature from a lightly smoothed copy
    xs, ys = smooth_closed(x, 2), smooth_closed(y, 2)
    dx, dy = np.gradient(xs, step), np.gradient(ys, step)
    ddx, ddy = np.gradient(dx, step), np.gradient(dy, step)
    kappa = (dx * ddy - dy * ddx) / np.power(dx * dx + dy * dy, 1.5)
    kabs = smooth_closed(np.abs(kappa), 3)

    # corner detection: local maxima of |curvature| over threshold, min separation
    thr, sep = 1 / 260.0, int(110 / step)
    cand = [i for i in range(N) if kabs[i] >= thr and kabs[i] == max(kabs[(i + j) % N] for j in range(-sep // 2, sep // 2 + 1))]
    cand.sort()
    corners = []
    for k, i in enumerate(cand):
        a = i
        while kabs[(a - 1) % N] > thr * 0.45 and (i - a) % N < 40:
            a = (a - 1) % N
        b = i
        while kabs[(b + 1) % N] > thr * 0.45 and (b - i) % N < 40:
            b = (b + 1) % N
        corners.append({"n": k + 1, "index": int(i), "start_index": int(a), "end_index": int(b),
                        "fraction": float(i / N), "radius_m": float(1 / kabs[i]),
                        "turn": "left" if kappa[i] > 0 else "right"})

    # start/finish = first source point (index 0). Check it lies on a straight: report local curvature.
    s0_straight = float(np.max(kabs[[(j % N) for j in range(-int(150 / step), int(150 / step))]]))

    # pit lane: parallel lane on the infield side, offset ramps in/out, box at the start line
    d_in, d_out, off_max, ramp_in, ramp_out = 100.0, 270.0, 22.0, 35.0, 60.0
    nin, nout = int(d_in / step), int(d_out / step)
    d_in, d_out = nin * step, nout * step     # actual lane extent: whole samples, so the lane ends sit exactly on the centreline
    idx = np.arange(-nin, nout + 1)
    s_rel = idx * step
    off = off_max * smoothstep((s_rel + d_in) / ramp_in) * smoothstep((d_out - s_rel) / ramp_out)
    tx, ty = dx / np.hypot(dx, dy), dy / np.hypot(dx, dy)
    # right-hand normal of travel direction (x, y) -> (ty, -tx)
    rn = np.column_stack([ty, -tx])
    sign = 1.0  # source is in driving direction; infield is on the right when clockwise
    pit = []
    for i, o in zip(idx, off):
        j = int(i) % N
        pit.append([float(x[j] + sign * rn[j, 0] * o), float(y[j] + sign * rn[j, 1] * o)])

    # landmark labels derived from the corner / straight sequence (see limitations)
    gaps = []
    for a, b in zip(corners, corners[1:] + corners[:1]):
        gaps.append(((b["index"] - a["index"]) % N, a, b))
    gaps.sort(key=lambda g: -g[0])
    landmarks = []
    by_n = {c["n"]: c for c in corners}
    for spec in meta.get("landmarks", []):          # circuits other than Silverstone: explicit, documented specs
        if "corner" in spec and spec["corner"] in by_n:
            landmarks.append({"name": spec["name"], "index": by_n[spec["corner"]]["index"], "kind": "corner"})
        elif "straight" in spec:
            a, b = (by_n.get(k) for k in spec["straight"])
            if a and b:
                ln = (b["index"] - a["index"]) % N
                landmarks.append({"name": spec["name"], "index": int((a["index"] + ln // 2) % N), "kind": "straight", "length_m": round(ln * step)})
    if meta.get("landmarks"):
        landmarks.append({"name": "Start / Finish straight", "index": 0, "kind": "straight"})
    if cid == "silverstone":
        for k, nm in zip((0, 1), ("Hangar Straight", "Wellington Straight")):
            ln, a, b = gaps[k]
            landmarks.append({"name": nm, "index": int((a["index"] + ln // 2) % N), "kind": "straight",
                              "length_m": round(ln * step)})
        first = min(corners, key=lambda c: c["index"])
        landmarks.append({"name": "Abbey", "index": first["index"], "kind": "corner"})
        landmarks.append({"name": "Club", "index": corners[-1]["index"], "kind": "corner"})
        _, a, b = gaps[0]
        landmarks.append({"name": "Stowe", "index": b["index"], "kind": "corner"})
        landmarks.append({"name": "Start / Finish straight", "index": 0, "kind": "straight"})

    out = {
        "id": cid, "name": name, "location": place, "country": meta["country"], "description": meta["description"],
        "length_m": round(length, 1), "point_count": N, "spacing_m": round(step, 3),
        "clockwise": bool(clockwise),
        "points": [[round(float(a), 2), round(float(b), 2)] for a, b in zip(x, y)],
        "half_width_right_m": [round(float(v), 2) for v in smooth_closed(pts[:, 2], 2)],
        "half_width_left_m": [round(float(v), 2) for v in smooth_closed(pts[:, 3], 2)],
        "start_index": 0,
        "sectors": {"fractions": [0.0, 1 / 3, 2 / 3], "approximate": True},
        "corners": corners,
        "landmarks": landmarks,
        "pit_lane": {
            "points": [[round(a, 2), round(b, 2)] for a, b in pit],
            "entry_index_offset": -nin, "exit_index_offset": nout, "box_index_offset": 0,
            "entry_distance_m": round(d_in, 3), "exit_distance_m": round(d_out, 3), "offset_m": off_max, "approximate": True,
            "length_m": round(d_in + d_out, 1),
        },
        # publicly published figures, shown for reference only: the simulation uses the measured geometry above
        "official_reference": {"length_m": meta["official_length_m"], "turns": meta["official_turns"],
                               "note": "Published circuit facts, not derived from the dataset."},
        "source": {
            "dataset": "TUMFTM/racetrack-database",
            "url": "https://github.com/TUMFTM/racetrack-database",
            "file": f"tracks/{csv_path.name}",
            "license": "LGPL-3.0 (dataset); underlying map data (c) OpenStreetMap contributors, ODbL",
            "citation": "Technical University of Munich, Institute of Automotive Technology, racetrack-database",
        },
        "limitations": [
            "Centerline and track widths come from the dataset; elevation is not available so the circuit is rendered and simulated flat.",
            "Start/finish line is taken as the first point of the dataset and is approximate.",
            "Pit lane is synthesised as a lane parallel to the start/finish straight (same construction at every circuit); it is not surveyed.",
            "Sector boundaries are equal thirds of the lap, not the official timing loops.",
            f"Corner numbers are detected from curvature ({len(corners)} found; official turn count is {meta['official_turns']}) and are not official turn numbers. "
            "Landmark names are inferred from the order of detected corners and straights.",
        ],
    }
    dest = OUT_DIR / f"{cid}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"{cid}: source points {len(raw)}, closure gap {gap:.1f} m, length {length:.0f} m (official {meta['official_length_m']}), "
          f"{'clockwise' if clockwise else 'counter-clockwise'}, corners detected {len(corners)} (official {meta['official_turns']}), "
          f"max curvature within 150 m of start {s0_straight:.5f} (1/m), wrote {dest} ({dest.stat().st_size // 1024} KB)")


def main() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    ids = list(catalog) if "--all" in sys.argv or len(sys.argv) < 2 else sys.argv[1:]
    for cid in ids:
        build(cid, catalog[cid])


if __name__ == "__main__":
    main()
