# The Impossible Pit Stop: Race Strategist

A deterministic endurance-race simulator with a **rolling-horizon pit-strategy optimizer**, a fixed-stint
baseline, a paired benchmark, and a live **interactive 3D Silverstone** with eight cars.
Everything runs locally: no paid services, API keys, or cloud models.

> The race model is synthetic and illustrative. Its parameters are not calibrated to real motorsport data, and
> the rival cars are simulated AI, not real drivers or real data.

## What it does

* Lap-by-lap physics: fuel burn and fuel-mass lap-time effect, tyre wear (Soft / Medium / Hard / Wet), weather
  (rain, wetness dynamics), safety car (slow pace, cheaper pit stop), traffic and degradation noise, pit-stop cost.
* **Adaptive optimizer**: samples possible futures (rain, safety car, degradation) from a prior and enumerates
  every feasible 0/1/2-stop plan, then replans when conditions materially change.
* **Fixed-stint baseline** following the same physics and rules, compared on matched seeds.
* **Live 3D race** (Three.js / React Three Fiber) on the real Silverstone layout with a start/finish gantry,
  kerbs, pit lane, sector markers, grandstands, barriers, rain and a safety car.
* Race controls: start, pause, resume, step lap, finish, reset, speed (0.5x to 16x), inject rain, clear rain,
  deploy or withdraw the safety car, force a strategy refresh.
* Telemetry, strategy panel with an explanation, charts (actual vs projected), strategy timeline, event log, and
  a benchmark panel that runs real paired trials.

## Architecture

```
backend/app
  config.py       race configuration (Pydantic) + configs/*.json loader
  physics.py      ALL formulas (single source of truth; used by the engine AND the optimizer)
  events.py       hidden world: weather / safety car / noise generated up front from the seed; manual events
  simulation.py   RaceEngine: pure lap-by-lap engine; policies only see a public RaceSnapshot
  scenarios.py    optimizer's sampled futures (never imports the hidden schedule; a test enforces it)
  optimizer.py    stint-cost tables + exhaustive plan enumeration + explanation + projection
  strategy.py     AdaptivePolicy (optimizer), FixedStintBaseline, CompetitorPolicy (rule-based rivals)
  session.py      live session: strategy car + shadow baseline + 7 rivals, WebSocket broadcast, benchmark runner
  evaluation.py   paired benchmark + CLI + JSON/CSV export
  main.py         FastAPI (REST + /ws/race)
frontend/src
  lib/circuit.ts      circuit geometry + helpers (pointAt, pitAt, distanceToTrack)
  lib/raceClock.ts    authoritative lap timing -> position on track (pure, unit-tested)
  components/scene/   3D scene (track geometry, environment, cars, camera rig, rain)
  components/RaceView.tsx  3D view + HUD (timing tower, selected-car card, pit window, lap strip)
scripts/build_circuit.py   dataset CSV -> circuit JSON
data/                      raw circuit CSV + license + provenance notes
```

Separation of concerns: **physics** (physics.py) and the **authoritative simulation** (simulation.py) never depend on
rendering. The browser only turns recorded lap times into positions.

### How the 3D race stays faithful to the simulation

* The backend steps one lap for every car, then pushes one state (REST/WebSocket). Each car carries its full lap
  history with cumulative `elapsed_s`.
* The frontend `RaceClock` eases a visual race time toward the moment the leader has completed the newest lap, so
  rendering is smooth but never runs ahead of known data and never alters reported lap times.
* A car's position at time t is a pure function of its lap times: lap k covers the circuit in exactly its simulated
  `lap_time_s`, so safety-car laps visibly run slower, and gaps and order come from the same numbers shown in telemetry.
* **Pit stops**: on a lap with `pitted=true` the car runs the main track to the pit entry, drives the pit lane to its
  box, stands still for the service share of the simulated pit loss (service / (service + transit)), and the lap ends
  at the line; the next lap leaves via the pit exit and merges to the track. The pit loss is added to that lap's
  time once, by the engine.
* A recommendation is a **proposal** (red pulsing pit lane, "P?" in the lap strip). It becomes an executed stop only
  when the simulation actually boxes the car (green pit lane, "P" in the lap strip).

### Rival cars (simulated, not real data)

Seven rivals are full `RaceEngine` instances with the same physics and the same hidden weather and safety-car
schedule as the strategy car, but their own noise, a deterministic pace offset (-0.45 s to +0.65 s per lap), a
different starting compound and a simple rule-based policy (one scheduled stop; they switch to wets at their own
wetness threshold, pit under a safety car if a stop is near, and return to slicks when the track dries). They are
**not** optimizer-controlled. **Traffic interaction is not modelled**: rivals do not slow the strategy car (the
existing random traffic penalty remains), so there is no overtaking or blocking physics.

## Physics (all in `backend/app/physics.py`)

```
T_lap = T_base + T_fuel + T_compound + T_wear + T_weather + T_traffic + T_noise + T_fuelsave + T_driver + T_event
T_fuel     = 0.035 s/kg * fuel_at_start_of_lap
T_wear     = a_c*w + b_c*w^2                       w = wear at the start of the lap, in [0,1]
w_next     = min(1, w + r_c * degradation * conditions)     r: Soft 0.07, Medium 0.04, Hard 0.025 per lap
T_weather  = 5*wet + (12*wet on slicks | 5*(1-wet) on Wet tyres)
T_event    = max(0, 1.4*T_base - racing_time) under a safety car (no double counting)
pit loss   = (20 s service + 5 s transit) * (0.45 under a safety car)
```
Fuel never goes negative (a fuel-save mode with a pace penalty kicks in if the tank cannot cover the race).
A tyre set is kept within `max_wear = 0.8`; the engine adds an equal wear-limit safety net for every policy.
A two-different-dry-compounds rule is enforced (waived once Wet tyres are used).

## Optimizer

Because there is no in-race refuelling, per-lap fuel, wetness and safety-car state depend only on the sampled
scenario, not on the plan. So the cost of a fresh stint (compound, first lap, last lap) is a function of the
scenario alone. The optimizer precomputes those stint costs with `physics.lap_time` (the same function the engine
uses), then prices each candidate plan by summing table entries plus `pit_loss` on the stop lap in each scenario.

* Candidates: all feasible plans with 0, 1 or 2 further stops (every lap and compound), respecting tyre
  availability, minimum stint length, the two-compound rule and the wear limit.
* **Not searched**: plans with 3+ stops (documented limitation; beam search was not implemented).
* Feasibility: a stint that exceeds the wear limit in more than 10% of sampled futures is rejected; in the remaining
  futures an assumed unplanned-stop cost is charged. Plans with unavailable compounds, too-short stints, a broken
  two-compound rule or negative fuel are never generated. Measured result: 0 tyre-limit violations and 0 invalid
  plans for the adaptive car over the 100 held-out races.
* Objective: expected remaining time over M sampled futures (16 live, 10 in the benchmark). An optional CVaR
  term exists (`cvar_lambda`, default 0, not used for the reported results).
* Rolling horizon: replans only on triggers (race start, rain/wetness change, safety-car start/end, degradation
  deviation, pit completed, plan infeasible, pit window). A hysteresis (0.3 s) keeps the current plan unless clearly beaten.
* Information barrier: policies receive a `RaceSnapshot` only; scenarios are built from the public state and the
  configured event prior. `scenarios.py` does not import the hidden schedule, and a test runs the optimizer on two
  worlds that differ only in their hidden future and asserts identical output.
* Output: action, pit lap, compound, plan, projected finish, current-plan finish, best alternative, time advantage,
  action options, top candidates (with p10/p90 across futures), counts, trigger, explanation, warnings.
  `scenario_win_share` is the fraction of sampled futures in which the chosen plan is at least as good as the best alternative.

## Baseline and benchmark methodology

The baseline pits on a fixed lap (default lap 12, scaled with race length), to Hard tyres, or to Wet tyres if the track is wet
at that moment; it never reacts otherwise. Same physics, rules and safety net as the adaptive policy.

Each trial builds one hidden world from its seed and runs both policies on **identical copies**. Seeds 1-999 were used
for development and tuning; **seeds 10000+ are the held-out evaluation set** used for reported numbers.

Held-out result (100 paired trials, seeds 10000-10099, 10 futures per decision, `results/latest.json` and `.csv`):

| Metric | Value |
|---|---|
| Baseline mean race time | 2433.11 s |
| Adaptive mean race time | 2425.69 s |
| Mean time saved | **7.43 s** (median 0.32 s, std 18.98 s, 95% CI 3.71 to 11.15 s) |
| Improvement | 0.305% |
| Win / loss / tie | 59 / 31 / 10 (win rate 59.0%) |
| Invalid plans (adaptive / baseline) | 0 / 0 |
| Tyre-limit violations (adaptive / baseline) | 0 / 1 |
| Decision time | mean 39 ms, p95 63 ms |

| Race type | n | Mean saved | Win rate | Loss rate |
|---|---|---|---|---|
| Dry | 22 | -0.21 s | 45% | 36% |
| Safety car only | 21 | +2.63 s | 48% | 33% |
| Rain only | 31 | +11.92 s | 65% | 32% |
| Rain and safety car | 26 | +12.41 s | 73% | 23% |

Honest reading: the gains come from rain and safety-car races. In dry races the baseline is near-optimal and the
adaptive strategy is statistically tied (slightly behind on average). The adaptive strategy also loses about a
third of races, mostly to bad luck (for example a safety car arriving just after it already pitted). The model prior
used by the sampler matches the generator of the simulated worlds, so results under a mismatched prior are not measured.
Re-run them with the commands below.

## Install and run (Windows PowerShell; needs Python 3.12 via uv, and Node 18+)

```powershell
uv venv --python 3.12 backend\.venv
uv pip install --python backend\.venv\Scripts\python.exe -r backend\requirements.txt
cd frontend
npm install
```

Backend (terminal 1, from `backend/`):

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

Frontend (terminal 2, from `frontend/`):

```powershell
npm run dev
```
Open http://localhost:5173. Add `?quality=low` to the URL on weak GPUs (disables shadows, lower resolution). The
resolution also adapts automatically when the frame rate drops.

Tests and checks:

```powershell
cd backend;  .\.venv\Scripts\python.exe -m pytest -q          # 43 tests
cd frontend; npm test                                          # 7 tests (circuit + car placement)
cd frontend; npm run build                                     # type-check + production build
cd backend;  .\.venv\Scripts\python.exe -m app.evaluation --trials 100 --seed-start 10000 --out ..\results
cd backend;  .\.venv\Scripts\python.exe -m app.demo            # headless demo sequence
```

## Demo script

1. Reset on `demo` (seed 42, no random events). Start at 2x. Note the optimizer's first plan (Medium to Hard around lap 11).
2. At lap 8 open the race console (wheel button), go to **Events & controls** and press **Heavy rain**. Watch the WEATHER_CHANGE replan, the red "Proposed stop: WET" pit lane, and the car boxing.
   The baseline ghost car (white outline) stays on slicks until its fixed stop.
3. Around lap 13 press **Deploy safety car** (same tab). The field slows to safety-car pace, and the pit cost shown in the explanation drops.
4. Finish the race (or press **Finish**); compare the strategy timeline of the adaptive car and the baseline.
5. Run the benchmark panel (100 trials takes about 25 s) or load the saved results.
Backup: reset on `demo_scripted` (rain at lap 8 and a safety car at lap 14 are pre-scheduled) and just press Start.

## Interface layout

A deep maroon-red racing identity. The 3D circuit fills the whole window under a compact single-row race header
(status, lap, elapsed time, gap to the fixed-stint baseline, start / pause / resume / step / finish / reset, speed).
Everything else lives in a floating **race console** that rises from the bottom when you click the **racing-wheel
button** (bottom centre; click again, press the X, or press Esc to close). The console is closed by default, never
resizes the 3D canvas (the view just slides up while it is open), and has five tabs:

| Tab | Contents |
|---|---|
| Telemetry | tyres (compound, wear, age, sets left), fuel with reserve marker, last/best lap, track and rain, safety-car and race status lights, last-lap time breakdown |
| Strategy engine | BOX THIS LAP / PIT LAP n / STAY OUT, projected and current-plan finish, best alternative, advantage, plans and futures counted, latency, trigger, explanation, warnings, top candidates (flashes when the recommendation changes) |
| Timeline | adaptive vs baseline stints; completed, planned and next-recommended stops are drawn differently |
| Analytics | wear and lap-time charts (solid = measured, dashed = projected) and the paired benchmark panel |
| Events & controls | race controls, config selector, speed buttons, rain / safety-car injection, live event log |

Arrow keys move between tabs. The wheel button shows a pulsing BOX badge while the optimizer wants a stop and the console is closed.

## Camera controls

3D view (orbit, pan, zoom), Top-down (pan and zoom), Follow car (chase camera on the selected car), Reset camera.
Click a car or a row in the timing tower to select it and inspect its telemetry.

## API

`GET /api/health` · `GET /api/configs` · `POST /api/race/{reset,start,pause,resume,step,finish,speed,event}` ·
`GET /api/race/state` · `GET /api/strategy/recommendation?refresh=` · `POST /api/evaluation/run` ·
`GET /api/evaluation/{status,results,results.csv}` · `WS /ws/race`. The REST polling fallback activates automatically
if the WebSocket drops.

## Known limitations and unverified items

* Circuit data: centerline and widths are real (TUM FTM database, OpenStreetMap-derived), but the start/finish
  position, pit lane, sector splits and corner numbering are approximations (see `data/README.md`). No elevation.
* Rival cars are rule-based AI with no on-track interaction (no overtaking or blocking physics).
* The optimizer searches at most two further stops; the safety-car pit discount is a multiplicative simplification.
* The 3D scene uses enlarged cars and procedural scenery. **Frame rate was not measured**: the preview browser used for
  development throttles animation when its pane is hidden, so only functional behaviour was verified there.
  Tested on one Intel UHD integrated GPU in that preview only; not tested on other browsers or touch devices.
* Parameters are synthetic. Benchmarks assume the sampler prior matches the world generator.
* Beam search and the full risk-aware objective were not implemented (CVaR is available but unused).

## Team split

Strategy and optimization: `scenarios.py`, `optimizer.py`, `AdaptivePolicy`. Physics, simulation and events: `config.py`,
`physics.py`, `events.py`, `simulation.py`. 3D dashboard: `frontend/src`. Integration, benchmark, tests, demo: `session.py`,
`main.py`, `evaluation.py`, `tests/`. They integrate through the shared contracts in `backend/app/schemas.py` and
`frontend/src/types/race.ts`.
