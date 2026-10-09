# THE IMPOSSIBLE PIT STOP — BUILD PLAN (for phased Sonnet execution)

> How to use: every Sonnet session gets **Part A (sections 0–6)** plus **one Phase from Part B**.
> Starter prompt for each session:
> "Read PLAN.md sections 0–6 and Phase N. Implement Phase N only. Do not change contracts in section 4/5
> unless the phase says so. Run the phase's Verify commands and fix failures before stopping. Report what you ran and the real output."

---

# PART A — GLOBAL CONTRACT (read every session)

## 0. Environment facts (verified on this machine)

| Tool | Version | Notes |
|---|---|---|
| Python default | 3.14.3 | **Do not use it for the venv.** Some wheels may lag on 3.14. |
| Python 3.12 | via uv (Astral CPython 3.12.13) | Use this. |
| uv | 0.11.6 | Creates the venv and installs packages. |
| Node | 24.14.0 | |
| npm | 11.9.0 | |
| Shell | PowerShell 5.1 + Git Bash | No `&&` in PowerShell 5.1. Use `;` or separate commands. |

Rules that prevent Windows roadblocks:
- Never activate the venv. Always call `backend\.venv\Scripts\python.exe -m ...` directly.
- Run all backend commands **from `backend/`**, so `import app` works.
- Use `pathlib.Path(__file__).resolve()` for every config or results path. Never rely on the current working directory.
- Never use Python `hash()` to derive seeds, because it is randomized per process. Use integer arithmetic.
- JSON must never contain `NaN` or `Infinity`, because browsers' `JSON.parse` rejects them. Convert them to `null` and keep `inf` internal only.
- Convert numpy scalars to `float()` or `int()` before they reach Pydantic models.

## 1. Repository layout (final)

```
impossible-pit-stop/
  README.md
  .gitignore
  PLAN.md
  configs/
    default.json          # random events ON, seed 7
    demo.json             # random events OFF, seed 42 (manual events)
    demo_scripted.json    # predefined hidden schedule: rain lap 8, SC lap 14 (backup demo)
  results/                # benchmark exports (gitignored except .gitkeep)
  backend/
    pyproject.toml        # pytest config: pythonpath=., testpaths=tests
    requirements.txt
    app/
      __init__.py
      config.py           # Pydantic config models + load_config(name)
      physics.py          # ALL formulas (single source of truth)
      events.py           # hidden world schedule, weather dynamics, manual event application
      scenarios.py        # optimizer's sampled futures (prior-based, never reads hidden schedule)
      optimizer.py        # stint tables, candidate enumeration, evaluation, (beam), explanation
      strategy.py         # policies: AdaptivePolicy, FixedStintBaseline
      simulation.py       # RaceEngine (pure, sync, no FastAPI)
      session.py          # RaceSession: adaptive engine + shadow baseline engine, async loop, lock
      evaluation.py       # paired benchmark + CLI (python -m app.evaluation)
      demo.py             # headless demo runner (python -m app.demo)
      schemas.py          # API Pydantic models (mirror section 5)
      main.py             # FastAPI app
    tests/
      test_physics.py  test_simulation.py  test_optimizer.py
      test_evaluation.py  test_api.py
  frontend/
    package.json  vite.config.ts  tailwind.config.js  postcss.config.js  tsconfig.json  index.html
    src/
      main.tsx  App.tsx  index.css
      types/race.ts
      services/api.ts
      hooks/useRaceState.ts  hooks/useBenchmark.ts
      components/
        HeaderBar.tsx  TrackMap.tsx  TelemetryPanel.tsx  TyreGauge.tsx  FuelGauge.tsx
        StrategyPanel.tsx  EventControls.tsx  EventLog.tsx
        charts/WearChart.tsx  charts/LapTimeChart.tsx  charts/StrategyTimeline.tsx
        BenchmarkPanel.tsx  charts/BenchmarkCharts.tsx
        ui/Panel.tsx  ui/Stat.tsx  ui/Button.tsx
      lib/format.ts  lib/compounds.ts  lib/trackPath.ts
```

## 2. Dependencies (exact)

`backend/requirements.txt`:
```
fastapi>=0.115,<1.0
uvicorn[standard]>=0.30
pydantic>=2.8,<3
numpy>=1.26
pytest>=8.0
httpx>=0.27
```

`frontend/package.json` dependencies:
```
react 18.3.1, react-dom 18.3.1, recharts 2.12.7,
@fontsource/barlow-condensed 5.0.x, @fontsource/jetbrains-mono 5.0.x
```
devDependencies:
```
vite 5.4.x, @vitejs/plugin-react 4.3.x, typescript 5.5.x, @types/react 18.3.x, @types/react-dom 18.3.x,
tailwindcss 3.4.x, postcss 8.4.x, autoprefixer 10.4.x
```
- Use **Tailwind v3**, not v4. v4's setup is different and is a common mismatch point.
- Fonts come from `@fontsource`, so the app needs no internet at runtime. Do not use the Google Fonts CDN.
- tsconfig: `strict: true`, `noUnusedLocals: false`, `noUnusedParameters: false`. This keeps unused variables from breaking the build.

## 3. Units and conventions

- Time is in seconds, fuel in kg, wear in [0,1], and wetness in [0,1].
- `lap` in state = **number of completed laps** (0..N). The next lap to run is `k = lap + 1`.
- "Pit on lap L" means the pit loss is added to **lap L's time**, and fresh tyres are used from lap L+1.
  Valid pit laps are `lap+1 ≤ L ≤ N-1`. Pitting on the final lap is never allowed.
- Compounds: `"SOFT" | "MEDIUM" | "HARD" | "WET"`. Dry compounds are SOFT, MEDIUM and HARD.
- Weather label from wetness: `DRY` if w < 0.2, `DAMP` if w < 0.5, `WET` otherwise.

## 4. Physics model (implemented ONLY in `physics.py`)

### 4.1 Default parameters (`configs/default.json` → `RaceConfig`)
```
total_laps 25 | base_lap_s 90.0 | seed 7 | start_compound "MEDIUM"
fuel: initial_kg 50.0, burn_kg_per_lap 1.9, sc_burn_factor 0.5, sensitivity_s_per_kg 0.035, reserve_kg 1.0,
      fuel_save_penalty_s_per_kg 1.5
tyres (pace_offset_s, wear_rate, a, b):
  SOFT   0.0  0.070 2.0 6.0
  MEDIUM 0.6  0.040 1.8 5.0
  HARD   1.1  0.025 1.6 4.5
  WET    0.0  0.030 1.5 4.0   (wet wear multiplier on dry track: 1 + 2.0*(1-w))
max_wear 0.80 | min_stint_laps 2 | max_stops 3
allocation: SOFT 2, MEDIUM 2, HARD 2, WET 3   (the starting set counts as used)
require_two_dry_compounds true   (waived if WET was used at any point)
weather: general_wet_slowdown_s 5.0, slick_wet_penalty_s 12.0, wet_tyre_dry_penalty_s 5.0,
         wetting_rate 0.30/lap, drying_rate 0.08/lap
safety_car: lap_factor 1.40 (SC lap = 126 s), pit_loss_factor 0.45, wear_factor 0.3
pit: service_s 20.0, transit_s 5.0
noise: lap_sigma_s 0.15, traffic_prob 0.12, traffic_min_s 0.2, traffic_max_s 1.0
degradation: race_mult_sigma 0.08 clipped [0.85,1.20], per_lap_sigma 0.03
event_model (prior, shared by world generator and scenario sampler):
  p_rain_start_per_lap 0.03, rain_stop_prob_per_lap 0.12, rain_intensity U(0.3,0.9),
  p_sc_per_lap 0.025, sc_duration_laps U{2..4}
random_events true
optimizer: scenarios_live 16, scenarios_benchmark 10, hysteresis_s 0.3, cvar_lambda 0.0, beam_width 30,
           degradation_replan_threshold 0.08, wetness_replan_threshold 0.15
baseline: pit_laps [12], dry_compounds ["HARD"]   (compound at each stop: WET if track wetness ≥ 0.3 else listed dry compound)
```

### 4.2 Functions (pure and deterministic, with no RNG inside)
```python
def weather_label(w) -> str
def next_wetness(w_prev, rain_intensity, cfg) -> float
    # rain>0: move toward rain_intensity by wetting_rate; else decrease by drying_rate; clamp [0,1]
def wear_increment(compound, wetness, sc_active, mult, cfg) -> float
    # r_c * mult * (WET? (1+2(1-w)) : 1) * (sc? sc.wear_factor : 1)
def next_wear(w, inc) -> min(1.0, w + inc)
def fuel_burn(fuel_kg, laps_remaining_including_this, sc_active, cfg) -> (burn_kg, save_penalty_s)
    # nominal = burn*(sc? 0.5 : 1); if fuel < nominal*laps_remaining → burn = fuel/laps_remaining,
    # penalty = (nominal-burn)*fuel_save_penalty; burn = min(burn, fuel). Fuel never goes negative.
def lap_time(state: LapInputs, cfg) -> LapTimeBreakdown
    # LapInputs: compound, wear_start, fuel_start_kg, wetness, sc_active, traffic_s, noise_s, fuel_save_s
    # T_base = base_lap_s
    # T_fuel = sensitivity * fuel_start_kg            (monotone ↑ in fuel)
    # T_compound = pace_offset_c
    # T_wear = a_c*w + b_c*w^2
    # T_weather = general_wet_slowdown*w + (slick? slick_wet_penalty*w : wet_tyre_dry_penalty*(1-w))
    # T_traffic = traffic_s ; T_noise = noise_s ; T_fuelsave = fuel_save_s
    # racing = sum of the above
    # T_event = max(0, sc_lap - racing) if sc_active else 0, where sc_lap = base*lap_factor
    # total = racing + T_event      (SC holds the car to SC pace; no double counting)
def pit_loss(sc_active, cfg) -> (service+transit) * (sc? pit_loss_factor : 1)
```
`LapTimeBreakdown` is a dataclass with every component plus `total`. The UI shows it.

### 4.3 Hand-checked sanity numbers (use them in tests)
Dry, fresh-tyre stint costs (pace offset + wear only):
- MEDIUM 11 laps ≈ 13.6 s, HARD 14 laps ≈ 21.3 s. Medium-10/11 → Hard is the dry optimum (≈ 35.0 s plus one pit of 25 s).
- The baseline Medium → Hard at lap 12 comes out ≈ 35.25 s. **In a dry race the baseline is within about 0.3 s of the optimum.** This is expected and should be reported honestly.
- Slick/wet crossover: MEDIUM `0.6+12w` = WET `5(1−w)` → w ≈ 0.26.
- A two-stop plan is never better in a dry race, because the pit loss is 25 s.
- No-stop on HARD is faster than any one-stop plan, which is why `require_two_dry_compounds` exists. Keep it ON.
- Pitting under SC saves 25×0.55 = 13.75 s. This is the main reason the adaptive strategy wins.

## 5. Shared data contracts (Pydantic in `schemas.py` ⇄ TS in `types/race.ts`, identical field names)

```ts
type Compound = "SOFT"|"MEDIUM"|"HARD"|"WET";
type RaceStatus = "idle"|"running"|"paused"|"finished";

interface LapRecord { lap:number; lap_time_s:number; compound:Compound; wear_end:number; fuel_end_kg:number;
  wetness:number; safety_car:boolean; pitted:boolean; pit_loss_s:number; new_compound:Compound|null;
  components:{base:number;fuel:number;compound:number;wear:number;weather:number;traffic:number;event:number;noise:number;fuel_save:number} }

interface Stint { compound:Compound; start_lap:number; end_lap:number|null }   // laps inclusive
interface PlanStop { lap:number; compound:Compound }

interface ProjectionPoint { lap:number; lap_time_s:number; wear:number; fuel_kg:number; compound:Compound }

interface CandidateSummary { plan:PlanStop[]; expected_s:number; p10_s:number; p90_s:number }

interface ActionOption { action:"BOX_THIS_LAP"|"STAY_OUT"; best_plan:PlanStop[]|null; projected_finish_s:number|null }

interface Recommendation {
  action:"BOX_THIS_LAP"|"STAY_OUT"; pit_lap:number|null; compound:Compound|null;
  plan:PlanStop[]; projected_finish_s:number;
  current_plan:PlanStop[]|null; current_plan_projected_finish_s:number|null;
  best_alternative:CandidateSummary|null; time_advantage_s:number;   // vs best_alternative
  action_options:ActionOption[]; top_candidates:CandidateSummary[];  // top 5
  candidates_evaluated:number; candidates_feasible:number; scenarios:number;
  scenario_win_share:number;   // fraction of scenarios where the chosen plan ≤ best alternative (defined, computed)
  trigger:string; explanation:string; warnings:string[];
  computed_at_lap:number; decision_ms:number; projection:ProjectionPoint[] }

interface RaceEvent { id:number; lap:number; type:string; message:string; sim_time_s:number }
// types: RACE_STARTED PAUSED RESUMED RAIN_STARTED RAIN_CHANGED RAIN_STOPPED WEATHER_CHANGED SC_DEPLOYED
//        SC_WITHDRAWN STRATEGY_RECALCULATED RECOMMENDATION_CHANGED PIT_STOP FORCED_PIT WARNING RACE_FINISHED

interface CarState { fuel_kg:number; fuel_initial_kg:number; fuel_status:"OK"|"LOW"|"CRITICAL";
  fuel_projected_end_kg:number; compound:Compound; tyre_wear:number; tyre_age:number;
  last_lap_s:number|null; best_lap_s:number|null; pit_stops:number; compounds_used:Compound[];
  tyres_available:Record<Compound,number> }

interface Conditions { track_wetness:number; rain_intensity:number; weather:"DRY"|"DAMP"|"WET";
  safety_car:boolean; sc_laps_elapsed:number }

interface BaselineShadow { elapsed_s:number; compound:Compound; tyre_wear:number; pit_stops:number;
  gap_s:number;   // baseline_elapsed - adaptive_elapsed at same lap (positive = adaptive ahead)
  laps:{lap:number;lap_time_s:number;compound:Compound;pitted:boolean}[]; stints:Stint[] }

interface RaceState { version:number; status:RaceStatus; config_name:string; seed:number;
  lap:number; total_laps:number; elapsed_s:number; speed:number; replan_count:number;
  car:CarState; conditions:Conditions; laps:LapRecord[]; stints:Stint[];
  recommendation:Recommendation|null; events:RaceEvent[]; baseline:BaselineShadow|null }

interface TrialResult { seed:number; baseline_s:number; adaptive_s:number; saved_s:number; winner:"ADAPTIVE"|"BASELINE"|"TIE";
  baseline_stops:number; adaptive_stops:number; baseline_mean_lap_s:number; adaptive_mean_lap_s:number;
  replans:number; mean_decision_ms:number; max_decision_ms:number;
  fuel_failures:number; tyre_violations:number; forced_pits_baseline:number; forced_pits_adaptive:number;
  invalid_plans:number; completed:boolean; category:"DRY"|"SC_ONLY"|"RAIN_ONLY"|"RAIN_AND_SC"; error:string|null }

interface BenchmarkSummary { trials:number; completed:number; seed_start:number; seed_set:"eval"|"dev";
  baseline_mean_s:number; adaptive_mean_s:number; mean_saved_s:number; median_saved_s:number; std_saved_s:number;
  ci95_saved_s:[number,number]; pct_improvement:number; win_rate:number; wins:number; losses:number; ties:number;
  invalid_plans:number; tyre_violations:number; fuel_failures:number; mean_decision_ms:number; p95_decision_ms:number;
  by_category:Record<string,{n:number;mean_saved_s:number;win_rate:number}>;
  runtime_s:number; created_at:string; config_name:string }

interface BenchmarkResults { summary:BenchmarkSummary; trials:TrialResult[] }
interface BenchmarkStatus { state:"idle"|"running"|"done"|"error"; completed:number; total:number; error:string|null }
```

## 6. API (FastAPI, `main.py`)

| Method | Path | Body / query | Result / errors |
|---|---|---|---|
| GET | /api/health | – | `{status:"ok"}` |
| GET | /api/configs | – | `["default","demo","demo_scripted"]` |
| POST | /api/race/reset | `{config_name?, seed?, total_laps? (5..80)}` | RaceState (idle) · 404 unknown config |
| POST | /api/race/start | – | RaceState · 409 if not idle |
| POST | /api/race/pause | – | 409 if not running |
| POST | /api/race/resume | – | 409 if not paused |
| POST | /api/race/step | – | 409 if running/finished; idle→paused after the step |
| POST | /api/race/speed | `{speed: 0.5..16}` | RaceState · 422 out of range |
| POST | /api/race/finish | – | runs remaining laps instantly · 409 if finished |
| POST | /api/race/event | `{type:"RAIN", intensity:0.1..1.0}` / `{type:"CLEAR"}` / `{type:"SC_DEPLOY"}` / `{type:"SC_WITHDRAW"}` | RaceState · 409 if finished, if SC_WITHDRAW without SC, or if SC_DEPLOY while SC is already out |
| GET | /api/race/state | – | RaceState |
| GET | /api/strategy/recommendation | `?refresh=false` | Recommendation · 404 if none |
| POST | /api/evaluation/run | `{trials:1..500=100, seed_start=10000, scenarios?=10}` | 202 BenchmarkStatus · 409 if running |
| GET | /api/evaluation/status | – | BenchmarkStatus |
| GET | /api/evaluation/results | – | BenchmarkResults · 404 if none (on startup, load `results/latest.json` if present) |
| GET | /api/evaluation/results.csv | – | text/csv |
| WS | /ws/race | – | server pushes RaceState JSON after every change; client sends nothing |

CORS allows `http://localhost:5173`. Vite proxies `/api` and `/ws` (with `ws:true`) to `http://127.0.0.1:8000`.

---

# PART B — PHASES (one Sonnet session each, in order)

## Phase 1 — Scaffold + configs (≈ 30 min)
Create the directory layout, `.gitignore` (venv, node_modules, dist, results/* except .gitkeep, __pycache__, .pytest_cache), `requirements.txt`, `pyproject.toml`:
```toml
[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```
Write the 3 config JSON files with the section 4.1 values.
- `demo.json`: seed 42, random_events false.
- `demo_scripted.json`: random_events false plus `"scripted_events":[{"lap":8,"type":"RAIN","intensity":0.8,"duration":7},{"lap":14,"type":"SC","duration":3}]`.

`config.py`: Pydantic v2 models (`RaceConfig` with nested models) and `load_config(name, **overrides)`, which reads `<repo>/configs/{name}.json` via a path resolved from `__file__`. Run `git init` if the folder is not a repo.

Verify (PowerShell, from repo root):
```
uv venv --python 3.12 backend\.venv
uv pip install --python backend\.venv\Scripts\python.exe -r backend\requirements.txt
cd backend; .\.venv\Scripts\python.exe -c "from app.config import load_config; print(load_config('default').total_laps)"
```
Expected output: `25`.

## Phase 2 — Physics + tests (≈ 1 h)
Implement section 4.2 exactly. Then write `tests/test_physics.py`:
- Fuel decreases by burn. Fuel never goes negative, including with a tiny starting fuel. Lap time is monotone non-decreasing in fuel.
- Wear stays within [0,1]. SOFT increment > HARD increment under the same conditions. Worn tyres are slower than fresh ones.
- Wet track: WET beats MEDIUM at w=0.7, and MEDIUM beats WET at w=0.0.
- Under SC the total equals SC pace when racing < SC pace. `pit_loss(sc=True) < pit_loss(False)`.
- Stint-sum sanity: a MEDIUM 11-lap fresh dry stint (pace + wear components only) ≈ 13.6 ± 0.2.

Verify: `.\.venv\Scripts\python.exe -m pytest -q tests/test_physics.py`

## Phase 3 — World/events + RaceEngine (≈ 2 h)
**`events.py` — hidden world**
- `WorldSchedule` is pregenerated **for the entire race at init** from the seed. It holds arrays indexed by lap 1..N: `rain_intensity[k]`, `sc[k]`, `noise[k]`, `traffic[k]`, `wear_noise[k]`, and the scalar `deg_mult`.
- Use `numpy.random.default_rng(seed)` with separate child streams (`np.random.SeedSequence(seed).spawn(5)`) for weather, SC, noise, traffic and wear. This means **RNG consumption never depends on policy decisions**. That is what guarantees that baseline and adaptive see identical conditions.
- If `random_events` is false, rain and SC are all zero/false. Scripted events are written into the arrays.
- `apply_manual_event(schedule, current_lap, event, rng_for_duration)`:
  - RAIN writes intensity into laps `lap+1 … lap+d`, with d drawn from a dedicated stream seeded `seed*1000+lap`, range U{6..12}.
  - CLEAR zeros intensity from lap+1 to the end of the current rain block.
  - SC_DEPLOY sets sc on laps `lap+1 … lap+d`, d ∈ U{2..4}.
  - SC_WITHDRAW clears sc from lap+1 to the end of the current SC block.
  - The function is deterministic, so applying the same event to two copies gives identical results.

**`simulation.py` — `RaceEngine(config, schedule, policy)`**
- Public state lives in a dataclass. The `schedule` attribute is private (`_schedule`).
- `snapshot() -> RaceSnapshot` is the **only thing policies receive**. It contains the current lap, fuel, compound, wear, tyre age, used compounds, availability, pit stops, elapsed time, the revealed conditions for the upcoming lap (`rain_intensity`, `track_wetness`, `sc_active`, `sc_laps_elapsed`), lap history, an observed degradation estimate, and config. It contains **no future arrays**.
- `_reveal_next()` runs at init and after every step. It reads the schedule for lap k=lap+1, computes upcoming wetness via `next_wetness`, and logs RAIN_STARTED/STOPPED/CHANGED, WEATHER_CHANGED and SC_DEPLOYED/WITHDRAWN when values change.
- `step()` order:
  1. `decision = policy.decide(snapshot)`, which returns `pit_this_lap: bool, compound`.
  2. Safety net: if `next_wear(wear, nominal increment for lap k) > max_wear` and the decision isn't a pit, force a pit with the best available compound for the conditions and log FORCED_PIT.
  3. Compute fuel burn and the lap time from the breakdown, using `traffic[k]`, `noise[k]` and the wear increment with `deg_mult*(1+wear_noise[k])`.
  4. If pitting: add `pit_loss(sc)`, swap tyres (wear 0, age 0), decrement allocation, increment stops, append a stint and log PIT_STOP.
  5. Append the LapRecord, update elapsed, set lap+=1, count tyre violations (wear_end > max_wear).
  6. If lap==N, the status becomes finished and RACE_FINISHED is logged. Otherwise call `_reveal_next()`.
- `apply_event(event)` mutates the schedule, re-reveals and logs.
- `degradation_estimate` = Σ observed increments / Σ nominal increments over the current stint's laps, shrunk toward 1 using `(n*obs+3)/(n+3)`.
- Also track the two-compound-rule status, and add a penalty flag if the race ends violating it (counted as an invalid plan).

**`strategy.py` (Phase 3 part)**
- `FixedStintBaseline(pit_laps, dry_compounds)`: pits exactly at the configured laps. The compound is WET if wetness ≥ 0.3, otherwise the listed dry compound. If that compound is unavailable, it uses the first available compound that satisfies the rule.
- It has no other reactions. It does still get the engine's safety net, the same as adaptive.
- Add a temporary `StayOutPolicy` for tests.

`tests/test_simulation.py`:
- A race finishes in N steps.
- The same seed gives identical lap times. A different seed gives different lap times.
- Pit loss is charged exactly once.
- Fresh tyres reset wear and age.
- Manual RAIN changes wetness from the next lap.
- SC_DEPLOY makes the next lap ≥ SC pace.
- Two engines with copied schedules and the same events produce the same conditions per lap, even with different policies.
- `snapshot()` exposes no schedule attributes (assert there are no list/array fields longer than the lap history).

Verify: `pytest -q`

## Phase 4 — Scenario sampler + optimizer (≈ 3 h, the core)
**`scenarios.py` — `sample_scenarios(snapshot, cfg, M, seed) -> list[Scenario]`**
- Each scenario has per-lap arrays for the remaining laps: `rain_intensity`, `wetness` (via `next_wetness`, starting from snapshot wetness), `sc`, `traffic_expected` (= traffic_prob × mean), and the scalar `deg_mult`.
- The seed is `(cfg.seed * 7919 + snapshot.lap * 104729 + snapshot.replan_index) % 2**32`, XOR'd with the constant `0x5EED`. This is a separate stream from the world.
- Stratify:
  - Scenario 0 is "persistence": current rain continues for its sampled expected duration, no new events, deg = estimate.
  - Scenario 1 is "rain soon" only if dry. Scenario 2 is "SC soon".
  - The rest are sampled from the `event_model` prior conditioned on current state. If raining, the remaining duration is geometric with `rain_stop_prob`. If SC is active, the remaining laps are U{1..3} minus elapsed, min 1.
  - `deg_mult = estimate * (1 + N(0,0.05))`.
- No noise term (expected value 0).
- **It must not import or accept `WorldSchedule`.** Enforce this with a test.

**`optimizer.py` — stint-table optimizer (fast, exact for its candidate set)**
Key insight: under a fixed scenario, fuel, wetness and SC per lap don't depend on the plan, because there's no refuelling. So the cost of a fresh stint depends only on (scenario, compound, start, end). Precompute these with the real `physics.lap_time`:
- `fuel[m][k]`: the fuel trajectory per scenario.
- `T[c][s][e][m]`: the cumulative cost of a fresh compound-c stint covering laps s..e. Fill by running forward from s and stop when wear > max_wear (mark the rest `inf` and infeasible). Store it as a numpy array of shape `(4, N+2, N+2, M)` initialised to inf.
- `CUR[e][m]`: continuing the current tyres (current wear and age) from lap+1..e.
- `P[L][m] = pit_loss(sc[L])`.
- Plan cost vector = `CUR[L1] + P[L1] + T[c1][L1+1][L2] + P[L2] + … + T[cn][Ln+1][N]`. The objective is the mean over m. Optional robust cost = `mean + λ·CVaR90` (mean of the worst ceil(0.1M) scenarios).

Candidate enumeration covers 0, 1 and 2 remaining stops, all laps, all compounds:
- Each stint must be ≥ `min_stint_laps`, except the current one.
- A stint that is infeasible in **any** scenario is rejected (robust feasibility). Skip the rest of a loop early when CUR becomes inf.
- Tyre allocation must be respected (count sets per compound).
- The two-dry-compound rule is checked against `compounds_used ∪ plan compounds`, waived if WET is in either.
- Total stops must be ≤ max_stops, and there must be no duplicates.
- Count `candidates_evaluated`, `candidates_feasible` and `invalid` (rejected reasons tallied).
- **Optional:** beam search (width 30) adds 3-stop plans. Score = partial cost + optimistic remaining cost (min over compounds of T to the end). It is deterministic, and the docs must state that it is approximate.

`optimize(snapshot, cfg, M, seed, current_plan=None, trigger) -> Recommendation`:
1. Run the steps above and sort by objective.
2. **Hysteresis:** if `current_plan` is still feasible and `cost(current) − cost(best) < hysteresis_s`, keep the current plan.
3. `action_options`: the best plan whose first stop is lap+1 (BOX_THIS_LAP) versus the best other plan (STAY_OUT).
4. `best_alternative` = the best plan whose immediate action differs from the chosen one. If none exists, use the second best. `time_advantage_s` = alternative − chosen.
5. `scenario_win_share` = mean(cost_chosen[m] ≤ cost_alt[m]).
6. `projection`: re-simulate the chosen plan through scenario 0 (persistence) to get per-lap lap time, wear, fuel and compound.
7. `projected_finish_s = elapsed + expected remaining`.
8. If the feasible set is empty, fall back to the plan with the fewest violations and add a warning. Never crash.
9. Fuel warning if the projected end fuel < reserve.

Write the explanation from template sentences filled with computed numbers only. For example:
"Track wetness 0.62 makes slicks +7.4 s/lap vs WET. Boxing this lap for WET costs 25.0 s but projects 2318.4 s vs 2341.0 s for staying out (−22.6 s), better in 15/16 scenarios."
Mention SC pit discount when SC is active, and wear/limit when that is the driver. Pick the sentence by the largest delta component.

**`strategy.py` — `AdaptivePolicy`**
- Holds `current_plan`, `last_reco`, a `replan_count` counter and `last_plan_state` (wetness, rain, sc, deg estimate, stops, lap).
- **Replan triggers** (string stored in `trigger`):
  - `RACE_START`
  - `WEATHER_CHANGE` (rain on/off/intensity change, or |Δwetness| ≥ 0.15, or the weather label changed)
  - `SC_DEPLOYED` / `SC_WITHDRAWN`
  - `DEGRADATION_DEVIATION` (|Δest| ≥ 0.08)
  - `PIT_COMPLETED`
  - `PLAN_INFEASIBLE` (next stop's compound is unavailable, or wear would exceed the limit before the planned stop)
  - `PIT_WINDOW` (lap+1 == the first planned stop lap, i.e. confirm before boxing)
  - `MANUAL_REFRESH`
- Otherwise reuse the plan. Never optimize when no trigger fired.
- `decide()` returns pit if `plan[0].lap == lap+1`. After a pit, remove that stop from the plan.
- Record `decision_ms` with `time.perf_counter`.

`tests/test_optimizer.py`:
- Valid recommendation at the start. All returned plans are feasible (simulate them and check wear ≤ max).
- Dry start recommends a one-stop MEDIUM→HARD (or SOFT) with a pit lap in 8..14.
- Infeasible plans (SOFT 15-lap stint) are rejected.
- Projected cost includes pit loss (one-stop cost − no-pit cost ≈ 25 s plus the tyre difference).
- Rain at intensity 0.8 with slick tyres leads to BOX_THIS_LAP with WET within 2 laps.
- SC active at lap 9 with no stops made leads to a box this lap (cheaper pit). SC active at lap 23 after a stop does not box.
- **Hidden-info test:** two engines with identical public state but different hidden future schedules produce an identical recommendation.
- Determinism: same input gives the same output.
- Runtime: one optimize call at lap 0 with M=16 takes < 1.0 s (target is about 0.1–0.3 s).

## Phase 5 — Benchmark (≈ 1.5 h)
**`evaluation.py`**
- `run_trial(cfg, seed, M)`:
  1. Build one `WorldSchedule(seed)`.
  2. Run `RaceEngine(cfg, copy.deepcopy(schedule), FixedStintBaseline)` and `RaceEngine(cfg, deepcopy, AdaptivePolicy)` to completion.
  3. Use the same `random_events: true` config (default.json) for both.
  4. Category is decided from the realized schedule (any rain? any SC?).
  5. Wrap everything in try/except. A failed trial gets `completed=false` and `error`, and is excluded from the means but counted.
- `run_benchmark(trials, seed_start, M, progress_cb)` returns `BenchmarkResults` with:
  - mean, median and std of time saved; `ci95 = mean ± 1.96·std/√n`
  - `pct = 100*(meanB−meanA)/meanB`
  - win rate (ties: |Δ| < 1e-6)
  - by_category, and p95 latency
  - Nothing may produce NaN. With n<2, std = 0.0.
- Seed sets: **dev = 1..999 (for tuning)** and **eval = 10000+ (for reported claims)**. Never tune on eval seeds.
- `export(results, dir)` writes `benchmark_<YYYYmmdd_HHMMSS>.json/.csv` plus `latest.json` / `latest.csv`.
- CLI: `python -m app.evaluation --trials 100 --seed-start 10000 --scenarios 10 --out ../results`. It prints the summary table.

Tests:
- 5 trials complete.
- Both policies saw identical per-lap wetness and SC.
- Metrics recomputed by hand from trials match the summary.
- The JSON round-trips through the Pydantic model.
- Running the same seeds twice gives identical results.
- A trial that raises (monkeypatched) is marked invalid, not crashed.

Verify: run the CLI with `--trials 20` and note the runtime. If 100 trials would take more than about 3 minutes, reduce M to 8 and say so in the README.

## Phase 6 — Session + FastAPI (≈ 2 h)
**`session.py` — `RaceSession`**
- Holds the config, the adaptive `RaceEngine`, and a shadow `RaceEngine` running the baseline policy on a **deepcopy of the same schedule**.
  - Every step steps both engines.
  - Every manual event is applied to both.
  - The baseline gap is computed from both.
- `asyncio.Lock` guards all mutations. CPU work runs in `await asyncio.to_thread(...)` while the lock is held.
- Race loop task: `while status=="running": await asyncio.sleep(seconds_per_lap); async with lock: step; broadcast`. Seconds per lap = `3.0/speed`. Keep the task reference. Cancel it on pause, reset and finish (handle CancelledError).
- `to_state()` builds the RaceState with an incrementing `version`.
- Broadcast via a set of WebSockets. Drop failed sockets silently.
- Benchmark runs via `asyncio.to_thread(run_benchmark, …)` in a separate task. It has its own objects and never touches the session. Status and results sit behind a `threading.Lock`, and progress is updated by the callback.

**`main.py`**
- Lifespan creates the session (`demo` config) and loads `results/latest.json` if present.
- Implement the routes from the section 6 table, with HTTPException 409/404/422 and clear `detail` messages.
- WS endpoint: accept, send the current state, then loop `await ws.receive_text()` to detect disconnect.

`tests/test_api.py` (TestClient, httpx):
- health
- reset → step ×3 → state.lap == 3
- start then pause gives status paused
- event RAIN changes conditions and causes a new recommendation trigger WEATHER_CHANGE
- SC_WITHDRAW without SC returns 409
- recommendation endpoint
- evaluation run with trials=3, then poll status until done (timeout 60 s), then results summary.trials == 3
- WS connect receives a state

Verify:
```
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```
Then in another terminal: `curl http://127.0.0.1:8000/api/health`

## Phase 7 — Headless demo + baseline numbers (≈ 45 min)
`app/demo.py` (`python -m app.demo [--config demo_scripted]`):
- Runs the demo sequence without a UI: reset demo, run to lap 8, RAIN 0.8, run to lap 13, SC_DEPLOY, run to the finish.
- Prints per lap: lap, compound, wear, fuel, wetness, SC, lap time, action and trigger. Prints every recommendation change and explanation, then the final adaptive vs shadow-baseline time.

Run it and **check that the story is sensible**:
- The adaptive car boxes for WET around lap 9–10.
- It considers boxing under SC.
- It returns to slicks when the track dries, if there are enough laps left.
- It beats the baseline.

If the behaviour is wrong, fix the model or optimizer here, **using dev seeds**, before the UI phase. Then run the official benchmark (eval seeds, 100 trials) and save the results.

## Phase 8 — Frontend foundation (≈ 2 h)
- Scaffold manually or with `npm create vite@5 frontend -- --template react-ts`, then pin the versions from section 2.
- Tailwind v3 init: `content: ["./index.html","./src/**/*.{ts,tsx}"]`.
- `vite.config.ts` proxy:
  ```ts
  server:{ port:5173, proxy:{ "/api":"http://127.0.0.1:8000", "/ws":{ target:"ws://127.0.0.1:8000", ws:true } } }
  ```
- `types/race.ts` = section 5 verbatim.
- `services/api.ts` has typed fetch wrappers for every endpoint. They throw an `Error` containing the backend `detail`.
- `hooks/useRaceState.ts`:
  - Opens a WS to `${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws/race`.
  - Keeps the state with the highest `version`.
  - If the socket is closed or errors, falls back to polling `/api/race/state` every 1000 ms and retries the WS every 5 s.
  - Exposes `{state, connected, mode:"ws"|"poll"}`.
- `hooks/useBenchmark.ts`: polls status every 1 s while running, then fetches results.
- Build a minimal App that renders raw values plus all control buttons wired up, to prove integration before styling.

Verify: `npm install`, `npm run build` (runs `tsc -b && vite build`), and `npm run dev` with the backend running. Click Start and check that the lap counter advances.

## Phase 9 — Dashboard UI (≈ 5 h, split across 2–3 sessions: 9a layout+track, 9b telemetry+strategy, 9c charts+log+benchmark)

**Design system (`index.css` + tailwind theme)**
- Colours:
  - bg `#07080A`, surface `#0D0F13`, panel `#12151B`, line `#1F242D`, text `#E8EAED`, muted `#8A93A3`
  - accent red `#FF2D3A`, amber `#FFB020`, green `#22D37A`, projected cyan `#38D9F5`
- Compounds: SOFT `#FF3B3B`, MEDIUM `#FFD12E`, HARD `#EDEDED`, WET `#2F8BFF`.
- Fonts: Barlow Condensed 600/700 (italic for big numbers), JetBrains Mono for telemetry digits. Use `font-variant-numeric: tabular-nums`.
- Panels: angular, with `clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px))`, a 1px line border, a thin red top tick, and a label strip ("01 / TELEMETRY").
- Background: a fine 24px grid via `linear-gradient` and a subtle radial vignette.
- Motion: CSS only, 150–300 ms ease-out. Add a pulsing dot for LIVE/SC, a sweep on the progress bar, and a number flash on change (key-based). Wrap all of it in `@media (prefers-reduced-motion: reduce)`.
- No emoji. Icons are inline SVG (tyre ring, droplet, SC flag, fuel can).

**Layout (desktop ≥1280)**, a 12-column asymmetric grid:
- Row 1 is a full-width HeaderBar:
  - Title in condensed italic, plus a status pill.
  - Giant `LAP 09/25`, elapsed time `mm:ss.s`, and the gap vs baseline (green/red).
  - Controls: Start / Pause / Resume / Step / Finish / Reset (with config select), and a speed segmented control 0.5× 1× 2× 4× 8×.
- Row 2:
  - TrackMap spans 8 columns × tall. It is the centrepiece.
  - The right column (4) holds TelemetryPanel, with StrategyPanel below.
- Row 3: WearChart, LapTimeChart and StrategyTimeline (full width), then EventControls and EventLog.
- Row 4: BenchmarkPanel, full width.
- Below 1024 px, stack into one column, keeping the track first.

**TrackMap (SVG, viewBox 0 0 1000 560)**
- Draw a hand-made fictional closed circuit `path` in `lib/trackPath.ts`, plus a pit-lane path parallel to the main straight with entry and exit markers.
- Draw the track as a wide dark stroke plus a thin centre dashed line and red/white kerb dashes on corners. Add start/finish chequer, S1/S2/S3 ticks at 0, 1/3 and 2/3 of the length, and corner numbers.
- Car marker: a glowing red chevron positioned with `path.getPointAtLength`.
  - The progress fraction is animated via `requestAnimationFrame` from `(now − lastLapUpdate)/(3000/speed)`, clamped to 0.98 until the next state arrives, then snapped to the lap boundary.
  - When the last lap record has `pitted`, the car runs along the pit path.
- Ghost marker (hollow white) for the shadow baseline, offset back by `gap_s / last_lap_s` of a lap.
- Overlays:
  - Weather (wetness bar, rain streaks via a CSS animation whose opacity = wetness).
  - When SC is active, an amber "SAFETY CAR" banner, an amber glow on the track and a pulsing SC dot.
- Footnote: "Car position interpolated between simulated lap boundaries."

**TelemetryPanel**: fuel gauge (bar plus projected end fuel and status colour), tyre widget (ring coloured by compound, arc = wear%, age), last lap / best lap, pit stops, available sets per compound, conditions, and the lap-time component breakdown of the last lap as a small stacked bar.

**StrategyPanel**:
- Big action "BOX THIS LAP → WET" (red pulse) or "STAY OUT" (green).
- Pit lap, compound, projected finish, current plan vs optimized plan (stop chips), time advantage, and scenario win share as "15/16 scenarios".
- Candidates evaluated/feasible, trigger chip, decision ms, explanation text, warnings in amber.
- A top-5 candidate table with expected time and a p10–p90 bar.

**Charts (Recharts, custom-styled)**:
- Hide default grid lines except faint horizontal ones. Use mono ticks and a custom dark tooltip.
- WearChart and LapTimeChart: actual = solid line coloured by compound; projected = dashed cyan from `recommendation.projection`. Add a horizontal max-wear reference line (0.8) in red. Show SC laps as amber `ReferenceArea` and wet laps as blue `ReferenceArea`.
- StrategyTimeline: a custom SVG, not Recharts. Lanes are "ADAPTIVE (actual + plan)" and "BASELINE (shadow)". Stints are compound-coloured bars, with planned stints hatched and pit markers as triangles. The current lap is a vertical line.

**EventControls**:
- Buttons: Light rain (0.4), Heavy rain (0.8), Clear, Deploy SC, Withdraw SC, Refresh strategy.
- Disable buttons per state (e.g. Withdraw only while SC is out; everything disabled when finished).
- Show the backend error on 409.

**EventLog**: newest first, mono timestamps (`L09 · 13:42.1`), and a colour bar per type.

**BenchmarkPanel**:
- Controls: trials input (default 100) and a Run button.
- A progress bar driven by the real status.
- Stat tiles: baseline mean, adaptive mean, mean saved, % improvement, win rate, std, 95% CI, trials, invalid plans, p95 decision ms.
- Charts: a histogram of `saved_s` per trial (bins), and a by-category bar chart.
- Footnote: seed set and range, scenario count, created_at.
- Empty state: "No benchmark yet — run one." **Never show placeholder numbers.**

Verify after each sub-session: `npm run build` passes, and run the dev server to view the page. Clicking every button must cause a real state change or a visible error.

## Phase 10 — Integration QA + README (≈ 2 h)
1. `pytest -q`, which should be all green. `npm run build`, which should be clean.
2. Run the backend and frontend, then do the full demo by clicking through it: start, rain at lap 8, SC at around lap 13, finish, benchmark. Confirm in the event log that each event produces STRATEGY_RECALCULATED.
3. Kill the WS (stop then restart the backend) and check that polling takes over.
4. README sections, per the prompt's list:
   - Equations from section 4, the optimizer from Phase 4 (including the stint-table insight, open-loop feedback, robust feasibility, hysteresis, beam = approximate), the baseline definition and fairness argument, benchmark methodology (paired, matched schedules, dev/eval seed split, CI).
   - Exact commands from section 11, the API table, demo script (section 12), known limitations (section 13), and team roles (section 14).
   - Paste **the actual benchmark summary from `results/latest.json`**, labeled with its seed range and date.

---

# PART C — REFERENCE

## 11. Commands (Windows PowerShell)
```
# backend (from repo root)
uv venv --python 3.12 backend\.venv
uv pip install --python backend\.venv\Scripts\python.exe -r backend\requirements.txt
cd backend
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
.\.venv\Scripts\python.exe -m app.evaluation --trials 100 --seed-start 10000 --out ..\results
.\.venv\Scripts\python.exe -m app.demo --config demo

# frontend (second terminal)
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build
```

## 12. Demo script (5 min)
1. Reset the race on **demo**, then Start at 2×. Point out the optimizer's first plan (Medium → Hard around lap 10–11), candidates evaluated, and the projected finish.
2. On lap 8, trigger **Heavy rain**. Show the WEATHER_CHANGE trigger and how "Box this lap" and "Stay out" now compare. The car boxes for WET, while the ghost baseline stays on slicks until its fixed lap 12.
3. Around lap 13, **Deploy SC**. Show the SC pit discount in the explanation and the new recommendation. The optimizer either boxes or explains why not.
4. Finish the race. Show the strategy timeline (adaptive vs baseline) and the final gap.
5. Show the benchmark: load the saved eval-seed results (or run 100 trials live with the progress bar). Present the overall result **and** the by-category numbers, including that dry races are close to a tie.

Backup: if anything misbehaves, reset with **demo_scripted** and just press Start, because the events are pre-scheduled.

## 13. Known limitations (state them honestly)
- Single car with no opponents. Track position and undercut aren't modelled; traffic is random noise.
- Synthetic parameters, not calibrated to real data.
- Discrete laps, so car motion between laps is interpolated visually.
- The optimizer optimizes open-loop plans under sampled futures and re-plans (open-loop feedback). It isn't a closed-form optimal stochastic policy.
- Scenario priors match the world generator (well-specified model). Results under a misspecified prior aren't measured unless you add that.
- The SC pit discount is a multiplicative simplification.
- Beam search, if added, is approximate.

## 14. Team split (4 people) — all integrate via section 5 contracts
- **M1 Strategy/optimization:** scenarios.py, optimizer.py, AdaptivePolicy, optimizer tests (Phase 4).
- **M2 Physics/simulation/events:** config, physics, events, simulation, their tests (Phases 1–3).
- **M3 Frontend:** Phases 8–9. Start on day 1 against a mocked RaceState JSON that matches section 5.
- **M4 Integration/eval/QA/demo:** baseline, evaluation, session, API, demo script, README (Phases 5–7, 10).

Order of dependency: P1→P2→P3→(P4 ∥ P8 with mocks)→P5→P6→P7→P9→P10.

## 15. Pre-flight double-check list (roadblocks already considered)
- [x] Python 3.14 wheel risk is avoided by using a 3.12 venv through uv.
- [x] PowerShell 5.1 has no `&&`, and venv activation isn't needed.
- [x] `pythonpath=["."]` in pyproject, so tests import `app`.
- [x] Seeds use no `hash()`. Child RNG streams are pregenerated, so paired trials stay matched regardless of decisions.
- [x] The optimizer can't see hidden schedules: scenarios.py never imports events.WorldSchedule, and a test enforces this.
- [x] No NaN/inf in JSON, and numpy scalars are cast.
- [x] A CPU-heavy benchmark runs in a thread, so the event loop stays free. The step function runs via `to_thread` under an asyncio lock.
- [x] WS with polling fallback, and Vite proxy `ws:true`.
- [x] Tailwind v3 pinned. Fonts are bundled locally. TS unused-var checks are off to avoid build breaks.
- [x] The no-stop exploit is closed by the two-compound rule. The final-lap pit is disallowed.
- [x] Dry-race baseline ≈ optimal (expected). The adaptive gains come from SC and rain, and that is reported by category.
- [x] Optimizer cost: tables take about 15k `lap_time` calls plus about 3k numpy-vector candidates, giving an estimated 0.05–0.3 s per replan. This is an estimate to verify in Phase 4/5, not a measured figure.
- [x] Fuel can't go negative: fuel-save mode is in the physics.
- [x] A forced-pit safety net applies equally to both policies.
