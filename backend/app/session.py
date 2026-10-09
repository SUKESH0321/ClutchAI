"""Live race session (adaptive car + shadow baseline car) and the background benchmark runner."""
from __future__ import annotations

import asyncio
import copy
import json
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from . import tracks
from .config import RESULTS_DIR, load_config
from .events import build_schedule, car_variant
from .evaluation import export, run_benchmark
from .physics import weather_label
from .simulation import RaceEngine
from .strategy import AdaptivePolicy, CompetitorPolicy, FixedStintBaseline

SECONDS_PER_LAP = 12.0

# Simulated rival cars (fictional teams). pace = constant lap-time offset in seconds vs. the
# primary car's pace. Strategies are fixed by the rule-based CompetitorPolicy.
PRIMARY = {"id": "ADP", "code": "ADP", "name": "Adaptive Strategy Car", "color": "#FF2D3A", "grid_slot": 5}
RIVALS = [
    {"id": "AXL", "code": "AXL", "name": "Axiom Racing", "color": "#38D9F5", "grid_slot": 1, "pace": -0.45,
     "start": "MEDIUM", "pit_lap": 11, "pit_to": "HARD", "wet": 0.55},
    {"id": "BRV", "code": "BRV", "name": "Bravura GP", "color": "#22D37A", "grid_slot": 2, "pace": -0.25,
     "start": "SOFT", "pit_lap": 8, "pit_to": "HARD", "wet": 0.45},
    {"id": "CRS", "code": "CRS", "name": "Crestline", "color": "#B28CFF", "grid_slot": 3, "pace": -0.10,
     "start": "MEDIUM", "pit_lap": 12, "pit_to": "HARD", "wet": 0.65},
    {"id": "DLT", "code": "DLT", "name": "Deltawing", "color": "#FFB020", "grid_slot": 4, "pace": 0.05,
     "start": "SOFT", "pit_lap": 9, "pit_to": "MEDIUM", "wet": 0.50},
    {"id": "EMB", "code": "EMB", "name": "Ember Motorsport", "color": "#FF7A3D", "grid_slot": 6, "pace": 0.20,
     "start": "MEDIUM", "pit_lap": 10, "pit_to": "HARD", "wet": 0.60},
    {"id": "FRG", "code": "FRG", "name": "Forge Racing", "color": "#E86CFF", "grid_slot": 7, "pace": 0.40,
     "start": "MEDIUM", "pit_lap": 13, "pit_to": "HARD", "wet": 0.70},
    {"id": "GLC", "code": "GLC", "name": "Glacier GP", "color": "#9AD1FF", "grid_slot": 8, "pace": 0.65,
     "start": "SOFT", "pit_lap": 8, "pit_to": "MEDIUM", "wet": 0.55},
]


class SessionError(Exception):
    """Invalid transition / request (maps to HTTP 409)."""


class RaceSession:
    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.sockets: set = set()
        self._task: Optional[asyncio.Task] = None
        self.state = "idle"
        self.speed = 1.0
        self.version = 0
        self.config_name = "demo"
        self._build("demo", None, None)

    # ------------------------------------------------------------ construction
    def _build(self, name: str, seed: Optional[int], total_laps: Optional[int], circuit: Optional[str] = None) -> None:
        cfg = load_config(name, seed=seed, total_laps=total_laps, circuit=circuit)
        sched = build_schedule(cfg)
        self.cfg, self.config_name = cfg, name
        self.policy = AdaptivePolicy(cfg)
        self.engine = RaceEngine(cfg, sched, self.policy)
        self.baseline = RaceEngine(cfg, copy.deepcopy(sched), FixedStintBaseline(cfg))
        self.rivals = []
        for i, r in enumerate(RIVALS, start=1):
            rcfg = cfg.model_copy(update={"start_compound": r["start"]})
            eng = RaceEngine(rcfg, car_variant(sched, cfg, i),
                             CompetitorPolicy(rcfg, r["pit_lap"], r["pit_to"], r["wet"]), pace_offset_s=r["pace"])
            self.rivals.append((r, eng))
        self.state = "idle"
        self._observe("RACE_START")

    def _observe(self, force: Optional[str] = None) -> None:
        self.policy.observe(self.engine.snapshot(), force=force)
        for typ, msg in self.policy.drain_events():
            self.engine.log(typ, msg)

    def _step_sync(self) -> None:
        self.engine.step()
        self.baseline.step()
        for _, eng in self.rivals:
            eng.step()
        if self.engine.finished:
            self.state = "finished"

    def _start_all(self) -> None:
        self.engine.start()
        self.baseline.start()
        for _, eng in self.rivals:
            eng.start()

    # ------------------------------------------------------------ commands
    async def reset(self, name: Optional[str], seed: Optional[int], total_laps: Optional[int], circuit: Optional[str] = None) -> None:
        async with self.lock:
            # a circuit change starts a completely fresh race: new engines, schedule, policy, baseline and rivals
            circuit = circuit or (self.cfg.circuit if getattr(self, "cfg", None) is not None else None)
            await asyncio.to_thread(self._build, name or self.config_name, seed, total_laps, circuit)
            self.version += 1
        await self.broadcast()

    async def start(self) -> None:
        async with self.lock:
            if self.state != "idle":
                raise SessionError(f"cannot start: race is {self.state}")
            self.state = "running"
            self._start_all()
            self._ensure_loop()
            self.version += 1
        await self.broadcast()

    async def pause(self) -> None:
        async with self.lock:
            if self.state != "running":
                raise SessionError(f"cannot pause: race is {self.state}")
            self.state = "paused"
            self.engine.log("PAUSED", "Race paused")
            self.version += 1
        await self.broadcast()

    async def resume(self) -> None:
        async with self.lock:
            if self.state != "paused":
                raise SessionError(f"cannot resume: race is {self.state}")
            self.state = "running"
            self.engine.log("RESUMED", "Race resumed")
            self._ensure_loop()
            self.version += 1
        await self.broadcast()

    async def step(self) -> None:
        async with self.lock:
            if self.state not in ("idle", "paused"):
                raise SessionError(f"cannot step: race is {self.state}")
            if self.state == "idle":
                self._start_all()
            await asyncio.to_thread(self._step_sync)
            if self.state != "finished":
                self.state = "paused"
            self.version += 1
        await self.broadcast()

    async def finish(self) -> None:
        async with self.lock:
            if self.state == "finished":
                raise SessionError("race already finished")
            if self.state == "idle":
                self._start_all()

            def run():
                while not self.engine.finished:
                    self._step_sync()
            await asyncio.to_thread(run)
            self.state = "finished"
            self.version += 1
        await self.broadcast()

    async def set_speed(self, speed: float) -> None:
        async with self.lock:
            self.speed = speed
            self.version += 1
        await self.broadcast()

    async def event(self, ev_type: str, intensity: Optional[float]) -> None:
        async with self.lock:
            if self.state == "finished":
                raise SessionError("race is finished")
            try:
                self.engine.apply_event(ev_type, intensity)
                self.baseline.apply_event(ev_type, intensity)
                for _, eng in self.rivals:
                    eng.apply_event(ev_type, intensity)
            except ValueError as exc:
                raise SessionError(str(exc)) from exc
            await asyncio.to_thread(self._observe)
            self.version += 1
        await self.broadcast()

    async def refresh_recommendation(self) -> None:
        async with self.lock:
            await asyncio.to_thread(self._observe, "MANUAL_REFRESH")
            self.version += 1
        await self.broadcast()

    # ------------------------------------------------------------ loop / sockets
    def _ensure_loop(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def _loop(self) -> None:
        """Step first, then sleep to a fixed cadence (compute time is absorbed, so the 3D clock sees a
        steady stream of laps)."""
        import time
        next_at = time.monotonic()
        while True:
            async with self.lock:
                if self.state != "running":
                    self._task = None
                    return
                await asyncio.to_thread(self._step_sync)
                self.version += 1
                done = self.state == "finished"
                if done:
                    self._task = None
            await self.broadcast()
            if done:
                return
            next_at += SECONDS_PER_LAP / self.speed
            await asyncio.sleep(max(0.0, next_at - time.monotonic()))
            if next_at < time.monotonic() - 1.0:
                next_at = time.monotonic()

    async def broadcast(self) -> None:
        if not self.sockets:
            return
        payload = self.to_state()
        for ws in list(self.sockets):
            try:
                await ws.send_json(payload)
            except Exception:
                self.sockets.discard(ws)

    # ------------------------------------------------------------ serialization
    @staticmethod
    def _car_laps(eng: RaceEngine) -> list:
        out, t = [], 0.0
        for r in eng.laps:
            t += r.lap_time_s
            out.append({"lap": r.lap, "lap_time_s": r.lap_time_s, "elapsed_s": t, "pitted": r.pitted,
                        "pit_loss_s": r.pit_loss_s, "compound": r.compound, "safety_car": r.safety_car})
        return out

    def _cars_state(self) -> list:
        specs = [(PRIMARY, self.engine, True)] + [(r, e, False) for r, e in self.rivals]
        cars = []
        for spec, eng, primary in specs:
            cars.append({
                "id": spec["id"], "code": spec["code"], "name": spec["name"], "color": spec["color"],
                "is_primary": primary, "grid_slot": spec["grid_slot"],
                "pace_offset_s": 0.0 if primary else spec["pace"], "simulated": not primary,
                "laps": self._car_laps(eng), "elapsed_s": eng.elapsed_s, "compound": eng.compound,
                "tyre_wear": eng.wear, "tyre_age": eng.tyre_age, "fuel_kg": eng.fuel_kg,
                "pit_stops": eng.pit_stops,
                "last_lap_s": eng.laps[-1].lap_time_s if eng.laps else None, "position": 0, "gap_to_leader_s": 0.0})
        order = sorted(cars, key=lambda c: (c["elapsed_s"], c["grid_slot"]) if c["laps"] else (0.0, c["grid_slot"]))
        lead = order[0]["elapsed_s"]
        for i, c in enumerate(order, start=1):
            c["position"] = i
            c["gap_to_leader_s"] = c["elapsed_s"] - lead if c["laps"] else 0.0
        return cars

    def to_state(self) -> dict:
        e, cfg = self.engine, self.cfg
        n = cfg.total_laps
        remaining = n - e.lap
        proj_end = e.fuel_kg - cfg.fuel.burn_kg_per_lap * remaining
        if proj_end < cfg.fuel.reserve_kg:
            fstat = "CRITICAL"
        elif proj_end < 2.0 * cfg.fuel.reserve_kg:
            fstat = "LOW"
        else:
            fstat = "OK"
        b = self.baseline
        return {
            "version": self.version, "status": self.state, "config_name": self.config_name,
            "seed": cfg.seed, "lap": e.lap, "total_laps": n, "max_wear": cfg.max_wear, "fuel_reserve_kg": cfg.fuel.reserve_kg, "elapsed_s": e.elapsed_s,
            "speed": self.speed, "replan_count": self.policy.replan_count,
            "circuit_id": cfg.circuit,
            "track": tracks.summary(cfg).model_dump(),
            "pit_service_ratio": cfg.pit.service_s / (cfg.pit.service_s + cfg.pit.transit_s),
            "cars": self._cars_state(),
            "car": {
                "fuel_kg": e.fuel_kg, "fuel_initial_kg": e.fuel_initial_kg, "fuel_status": fstat,
                "fuel_projected_end_kg": proj_end, "compound": e.compound, "tyre_wear": e.wear,
                "tyre_age": e.tyre_age, "last_lap_s": e.laps[-1].lap_time_s if e.laps else None,
                "best_lap_s": e.best_lap_s, "pit_stops": e.pit_stops,
                "compounds_used": list(e.compounds_used), "tyres_available": dict(e.available)},
            "conditions": {
                "track_wetness": e.wetness, "rain_intensity": e.rain_intensity,
                "weather": weather_label(e.wetness), "safety_car": e.sc_active,
                "sc_laps_elapsed": e._sc_run if e.sc_active else 0},
            "laps": [asdict(r) for r in e.laps],
            "stints": [dict(s) for s in e.stints],
            "recommendation": self.policy.recommendation_dict(),
            "events": [dict(x) for x in e.events[-200:]],
            "baseline": {
                "elapsed_s": b.elapsed_s, "compound": b.compound, "tyre_wear": b.wear,
                "pit_stops": b.pit_stops, "gap_s": b.elapsed_s - e.elapsed_s,
                "laps": [{"lap": r.lap, "lap_time_s": r.lap_time_s, "compound": r.compound,
                          "pitted": r.pitted, "pit_loss_s": r.pit_loss_s} for r in b.laps],
                "stints": [dict(s) for s in b.stints]},
        }


class BenchmarkRunner:
    def __init__(self, out_dir: Path | str = RESULTS_DIR) -> None:
        self.out_dir = Path(out_dir)
        self.state, self.completed, self.total, self.error = "idle", 0, 0, None
        self.results: Optional[dict] = None              # most recent run (any circuit)
        self.by_circuit: dict[str, dict] = {}           # latest result per circuit: results are never mixed across circuits
        self._task: Optional[asyncio.Task] = None
        self.load_latest()

    def load_latest(self) -> None:
        p = self.out_dir / "latest.json"
        if p.exists():
            try:
                self.results = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                self.results = None
        for q in sorted(self.out_dir.glob("latest_*.json")):
            try:
                r = json.loads(q.read_text(encoding="utf-8"))
                self.by_circuit[r["summary"].get("circuit_id") or "silverstone"] = r
            except Exception:
                pass
        if self.results is not None:                    # results written before circuits existed were Silverstone runs
            self.by_circuit.setdefault(self.results["summary"].get("circuit_id") or "silverstone", self.results)

    def results_for(self, circuit: str) -> Optional[dict]:
        return self.by_circuit.get(circuit)

    def status(self) -> dict:
        return {"state": self.state, "completed": self.completed, "total": self.total, "error": self.error}

    def start(self, trials: int, seed_start: int, scenarios: Optional[int], circuit: Optional[str] = None) -> None:
        if self.state == "running":
            raise SessionError("a benchmark is already running")
        self.state, self.completed, self.total, self.error = "running", 0, trials, None
        self._task = asyncio.create_task(self._run(trials, seed_start, scenarios, circuit))

    def _progress(self, done: int, total: int) -> None:
        self.completed = done

    async def _run(self, trials: int, seed_start: int, scenarios: Optional[int], circuit: Optional[str] = None) -> None:
        try:
            res = await asyncio.to_thread(run_benchmark, trials, seed_start, scenarios, "default",
                                          circuit, self._progress)
            await asyncio.to_thread(export, res, self.out_dir)
            self.results, self.state = res, "done"
            self.by_circuit[res["summary"].get("circuit_id") or "silverstone"] = res
        except Exception as exc:
            self.state, self.error = "error", f"{type(exc).__name__}: {exc}"
