# Circuit data

`raw/Silverstone.csv` is a copy of `tracks/Silverstone.csv` from the **TUMFTM/racetrack-database**
(https://github.com/TUMFTM/racetrack-database), fetched from `raw.githubusercontent.com` on 2026-10-09.

* Contents: 1,178 centerline points (`x_m, y_m`) with right and left half-widths (`w_tr_right_m, w_tr_left_m`)
  in local metres.
* License: the database is distributed under **LGPL-3.0** (`raw/LICENSE_TUM`). The underlying geometry is
  derived by the database authors from OpenStreetMap data, (c) OpenStreetMap contributors, **ODbL**.
* Citation: Technical University of Munich, Institute of Automotive Technology, racetrack-database.

`scripts/build_circuit.py` validates the CSV (numeric, finite, closes within 5 m), resamples it to 720 evenly
spaced points, and writes `frontend/src/data/circuits/silverstone.json`. Computed length is 5,887 m (official
lap length about 5,891 m) and the travel direction is clockwise, as at the real circuit.

## What is NOT in the source data (and is therefore approximate)

| Item | How it is produced |
|---|---|
| Start/finish line | First point of the dataset (about 115 m after the final corner, about 400 m before Abbey). Not surveyed. |
| Pit lane | Synthesised: a lane 22 m to the infield side of the start straight, 100 m before and 270 m after the line. Not surveyed. |
| Sector boundaries | Equal thirds of the lap, not the official timing loops. |
| Corner numbers | Detected from curvature (19 found). They are not the official turn numbers. |
| Landmark names | Hangar Straight, Wellington Straight, Abbey, Stowe, Club are inferred from the corner and straight sequence. |
| Elevation | Not available, so the circuit is rendered flat. |
| Scenery | Trees, grandstands, barriers and kerbs are procedural decoration, not mapped features. |

## Circuits in this repo
`raw/Silverstone.csv, Spa.csv, Monza.csv, Zandvoort.csv` are copies of `tracks/<name>.csv` from the same database (same license). `scripts/circuits_catalog.json` holds the
display facts (published length and turn count, description, landmark names inferred from corner order); `scripts/build_circuit.py --all` writes `data/circuits/<id>.json`, which is the single
source of truth for the backend (`backend/app/tracks.py`), the web app and (copied) the Godot client. Measured vs published length: Silverstone 5,887/5,891 m, Spa 7,000/7,004 m, Monza 5,790/5,793 m, Zandvoort 4,316/4,259 m.

## Adding another circuit

1. Put another `Name.csv` from the same database (same columns) in `data/raw/`.
2. `backend/.venv/Scripts/python.exe -I scripts/build_circuit.py data/raw/Spa.csv spa "Circuit de Spa-Francorchamps" "Belgium"`
3. Add it to `scripts/circuits_catalog.json`, run `scripts/build_circuit.py <id>`, and copy the JSON to `godot/data/`. It appears in the track selector automatically.
