"""Single source of truth for all race physics. Pure functions, no RNG, no I/O.

Units: seconds, kilograms, laps, normalized wear [0,1], normalized wetness [0,1].
Used by the live engine AND the optimizer so formulas are never duplicated.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

from .config import RaceConfig


@dataclass
class LapInputs:
    compound: str
    wear_start: float
    fuel_start_kg: float
    wetness: float
    sc_active: bool
    traffic_s: float = 0.0
    noise_s: float = 0.0
    fuel_save_s: float = 0.0
    driver_s: float = 0.0       # constant per-car pace offset (rival cars only)


@dataclass
class LapTimeBreakdown:
    base: float
    fuel: float
    compound: float
    wear: float
    weather: float
    traffic: float
    event: float
    noise: float
    fuel_save: float
    total: float
    driver: float = 0.0

    def components(self) -> dict[str, float]:
        d = asdict(self)
        d.pop("total")
        return d


def weather_label(wetness: float) -> str:
    if wetness < 0.2:
        return "DRY"
    if wetness < 0.5:
        return "DAMP"
    return "WET"


def next_wetness(w_prev: float, rain_intensity: float, cfg: RaceConfig) -> float:
    """Track wetness moves toward the rain intensity while raining, dries slowly otherwise."""
    if rain_intensity > 0:
        if w_prev < rain_intensity:
            w = min(rain_intensity, w_prev + cfg.weather.wetting_rate)
        else:
            w = max(rain_intensity, w_prev - cfg.weather.drying_rate)
    else:
        w = w_prev - cfg.weather.drying_rate
    return min(1.0, max(0.0, w))


def wear_increment(compound: str, wetness: float, sc_active: bool, mult: float, cfg: RaceConfig) -> float:
    """Wear added over one lap: r_c * degradation multiplier * conditions."""
    inc = cfg.tyres[compound].wear_rate * mult
    if compound == "WET":
        inc *= 1.0 + cfg.weather.wet_tyre_wear_dry_mult * (1.0 - wetness)
    if sc_active:
        inc *= cfg.safety_car.wear_factor
    return inc


def next_wear(w: float, inc: float) -> float:
    return min(1.0, w + inc)


def fuel_burn(fuel_kg: float, laps_remaining: int, sc_active: bool, cfg: RaceConfig) -> tuple[float, float]:
    """Return (burn_kg, fuel_save_penalty_s). Fuel can never go negative.

    If the tank cannot cover the remaining laps at nominal burn, the car fuel-saves:
    burn is reduced to what is available and a pace penalty is charged.
    """
    nominal = cfg.fuel.burn_kg_per_lap * (cfg.fuel.sc_burn_factor if sc_active else 1.0)
    laps_remaining = max(1, laps_remaining)
    burn, penalty = nominal, 0.0
    if fuel_kg < nominal * laps_remaining:
        burn = fuel_kg / laps_remaining
        penalty = (nominal - burn) * cfg.fuel.fuel_save_penalty_s_per_kg
    burn = max(0.0, min(burn, fuel_kg))
    return burn, penalty


def lap_time(inp: LapInputs, cfg: RaceConfig) -> LapTimeBreakdown:
    """T_lap = T_base + T_fuel + T_compound + T_wear + T_weather + T_traffic + T_noise + T_fuelsave + T_event.

    T_event is the extra time needed to bring a lap up to safety-car pace; it is the shortfall,
    so nothing is double counted (an SC lap equals base*lap_factor unless racing pace is slower).
    """
    ty = cfg.tyres[inp.compound]
    w = inp.wear_start
    t_base = cfg.base_lap_s
    t_fuel = cfg.fuel.sensitivity_s_per_kg * inp.fuel_start_kg
    t_comp = ty.pace_offset_s
    t_wear = ty.a * w + ty.b * w * w
    wet = inp.wetness
    t_weather = cfg.weather.general_wet_slowdown_s * wet
    if inp.compound == "WET":
        t_weather += cfg.weather.wet_tyre_dry_penalty_s * (1.0 - wet)
    else:
        t_weather += cfg.weather.slick_wet_penalty_s * wet
    racing = (t_base + t_fuel + t_comp + t_wear + t_weather
              + inp.traffic_s + inp.noise_s + inp.fuel_save_s + inp.driver_s)
    t_event = 0.0
    if inp.sc_active:
        t_event = max(0.0, cfg.base_lap_s * cfg.safety_car.lap_factor - racing)
    return LapTimeBreakdown(
        base=t_base, fuel=t_fuel, compound=t_comp, wear=t_wear, weather=t_weather,
        traffic=inp.traffic_s, event=t_event, noise=inp.noise_s, fuel_save=inp.fuel_save_s,
        total=racing + t_event, driver=inp.driver_s,
    )


def pit_loss(sc_active: bool, cfg: RaceConfig) -> float:
    base = cfg.pit.service_s + cfg.pit.transit_s
    return base * (cfg.safety_car.pit_loss_factor if sc_active else 1.0)
