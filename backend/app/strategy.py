"""Decision policies. FixedStintBaseline lives here; AdaptivePolicy is added with the optimizer."""
from __future__ import annotations

from .simulation import Decision, RaceSnapshot, pick_compound


class StayOutPolicy:
    def decide(self, snap: RaceSnapshot) -> Decision:
        return Decision()


class FixedStintBaseline:
    """Pits on predefined laps; tyre choice is the listed dry compound, or WET if the track is wet
    at the moment of the stop. No other reaction to events (the engine's wear-limit safety net
    applies equally to every policy)."""

    def __init__(self, cfg):
        # pit laps are defined for a 25-lap race and scaled proportionally for other lengths
        n = cfg.total_laps
        self.pit_laps = [max(2, min(n - 2, round(l * n / 25))) for l in cfg.baseline.pit_laps]
        self.dry = list(cfg.baseline.dry_compounds)
        self.wet_threshold = cfg.baseline.wet_threshold

    def decide(self, snap: RaceSnapshot) -> Decision:
        k = snap.lap + 1
        if k not in self.pit_laps or k >= snap.total_laps:
            return Decision()
        idx = self.pit_laps.index(k)
        avail = snap.available
        if snap.track_wetness >= self.wet_threshold and avail.get("WET", 0) > 0:
            c = "WET"
        else:
            c = self.dry[min(idx, len(self.dry) - 1)]
            if avail.get(c, 0) <= 0:
                c = pick_compound(snap.cfg, snap.track_wetness, snap.total_laps - k, avail,
                                  set(snap.compounds_used), snap.sc_active)
        return Decision(pit=c is not None, compound=c)


from dataclasses import asdict as _asdict

from .optimizer import optimize, Recommendation
from .physics import wear_increment, weather_label


class AdaptivePolicy:
    """Rolling-horizon replanning policy. Re-optimizes only when a trigger fires; executes only
    the immediate action of the current plan."""

    def __init__(self, cfg, M: int | None = None, seed: int | None = None):
        self.cfg = cfg
        self.M = M or cfg.optimizer.scenarios_live
        self.seed = cfg.seed if seed is None else seed
        self.plan: list | None = None
        self.reco: Recommendation | None = None
        self.last: dict | None = None
        self.replan_count = 0
        self.last_trigger: str | None = None
        self.decision_ms: list[float] = []
        self._pending: list = []

    # -- trigger detection -------------------------------------------------
    def _plan_infeasible(self, snap: RaceSnapshot) -> bool:
        cfg, n, k0 = self.cfg, snap.total_laps, snap.lap + 1
        if self.plan is None:
            return False
        self.plan = [s for s in self.plan if s["lap"] >= k0]
        end = self.plan[0]["lap"] if self.plan else n
        if self.plan and snap.available.get(self.plan[0]["compound"], 0) <= 0:
            return True
        w = snap.wear
        for _ in range(k0, end + 1):
            w += wear_increment(snap.compound, snap.track_wetness, False, snap.deg_estimate, cfg)
        return w > cfg.max_wear + 1e-9

    def _detect(self, snap: RaceSnapshot) -> str | None:
        L, cfg = self.last, self.cfg
        if L is None:
            return "RACE_START"
        if snap.sc_active != L["sc"]:
            return "SC_DEPLOYED" if snap.sc_active else "SC_WITHDRAWN"
        rain_changed = ((snap.rain_intensity > 0) != (L["rain"] > 0)
                        or abs(snap.rain_intensity - L["rain"]) > 1e-9)
        if (rain_changed or abs(snap.track_wetness - L["wet"]) >= cfg.optimizer.wetness_replan_threshold
                or weather_label(snap.track_wetness) != weather_label(L["wet"])):
            return "WEATHER_CHANGE"
        if abs(snap.deg_estimate - L["deg"]) >= cfg.optimizer.degradation_replan_threshold:
            return "DEGRADATION_DEVIATION"
        if snap.pit_stops != L["stops"]:
            return "PIT_COMPLETED"
        if self._plan_infeasible(snap):
            return "PLAN_INFEASIBLE"
        if self.plan and self.plan[0]["lap"] == snap.lap + 1 and L["lap"] < snap.lap:
            return "PIT_WINDOW"
        return None

    # -- public API --------------------------------------------------------
    def observe(self, snap: RaceSnapshot, force: str | None = None) -> Recommendation | None:
        trig = force or self._detect(snap)
        if trig is None:
            return None
        seed = ((self.seed * 7919 + snap.lap * 104729 + self.replan_count) % (2 ** 32)) ^ 0x5EED
        prev = self.reco
        reco = optimize(snap, self.M, seed, current_plan=self.plan, trigger=trig)
        self.reco, self.plan = reco, reco.plan
        self.replan_count += 1
        self.last_trigger = trig
        self.decision_ms.append(reco.decision_ms)
        self.last = {"lap": snap.lap, "sc": snap.sc_active, "rain": snap.rain_intensity,
                     "wet": snap.track_wetness, "deg": snap.deg_estimate, "stops": snap.pit_stops}
        desc = (f"{reco.action.replace('_', ' ').lower()}" +
                (f" -> {reco.compound}" if reco.action == "BOX_THIS_LAP" else "") +
                f", plan {[(s['lap'], s['compound']) for s in reco.plan]}")
        self._pending.append(("STRATEGY_RECALCULATED",
                              f"Replanned ({trig}): {desc}; finish {reco.projected_finish_s:.1f}s "
                              f"[{reco.candidates_feasible} plans, {reco.scenarios} futures, {reco.decision_ms:.0f} ms]"))
        if prev is not None and (prev.action, prev.plan) != (reco.action, reco.plan):
            self._pending.append(("RECOMMENDATION_CHANGED", reco.explanation))
        return reco

    def drain_events(self) -> list:
        ev, self._pending = self._pending, []
        return ev

    def decide(self, snap: RaceSnapshot) -> Decision:
        self.observe(snap)
        events = self.drain_events()
        k = snap.lap + 1
        if self.plan and self.plan[0]["lap"] == k:
            return Decision(pit=True, compound=self.plan[0]["compound"], events=events)
        return Decision(events=events)

    def recommendation_dict(self) -> dict | None:
        return _asdict(self.reco) if self.reco else None


class CompetitorPolicy:
    """Simple rule-based AI driver for the simulated rival cars (NOT the optimizer).

    One scheduled stop, plus reactions: switches to WET above its own wetness threshold, back to
    slicks when the track has dried, and brings a planned stop forward under a safety car."""

    def __init__(self, cfg, pit_lap: int, compound: str, wet_threshold: float):
        n = cfg.total_laps
        self.pit_lap = max(2, min(n - 2, round(pit_lap * n / 25)))
        self.compound = compound
        self.wet_threshold = wet_threshold
        self.done = False

    def decide(self, snap: RaceSnapshot) -> Decision:
        k, n, w = snap.lap + 1, snap.total_laps, snap.track_wetness
        if k >= n:
            return Decision()
        av = snap.available
        if snap.compound != "WET" and w >= self.wet_threshold and av.get("WET", 0) > 0:
            self.done = True
            return Decision(pit=True, compound="WET")
        if snap.compound == "WET" and w < 0.12 and n - k >= 5:
            c = pick_compound(snap.cfg, w, n - k, av, set(snap.compounds_used), snap.sc_active)
            if c and c != "WET":
                return Decision(pit=True, compound=c)
        if not self.done:
            due = k == self.pit_lap or (snap.sc_active and 0 < self.pit_lap - k <= 5)
            if due:
                c = "WET" if w >= self.wet_threshold else self.compound
                if av.get(c, 0) <= 0:
                    c = pick_compound(snap.cfg, w, n - k, av, set(snap.compounds_used), snap.sc_active)
                self.done = True
                return Decision(pit=c is not None, compound=c)
        return Decision()
