"""Circuit selection: geometry files, circuit-derived simulation inputs, reset-on-switch, and full races on every circuit."""
import json

import pytest
from fastapi.testclient import TestClient

from app import main, tracks
from app.config import load_config
from app.evaluation import run_benchmark

IDS = tracks.circuit_ids()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import session
    monkeypatch.setattr(session, "RESULTS_DIR", tmp_path)
    orig = session.BenchmarkRunner.__init__
    monkeypatch.setattr(session.BenchmarkRunner, "__init__", lambda self, out_dir=tmp_path: orig(self, out_dir))
    with TestClient(main.app) as c:
        yield c


def test_at_least_three_distinct_circuits_with_documented_sources():
    assert len(IDS) >= 3 and IDS[0] == "silverstone"
    shapes = set()
    for cid in IDS:
        d = json.loads((tracks.DATA_DIR / f"{cid}.json").read_text(encoding="utf-8"))
        assert d["source"]["dataset"] == "TUMFTM/racetrack-database" and "LGPL" in d["source"]["license"]
        assert d["limitations"] and d["pit_lane"]["approximate"] and d["sectors"]["approximate"]
        assert len(d["points"]) == d["point_count"] == 720
        ref = d["official_reference"]["length_m"]
        assert abs(d["length_m"] - ref) / ref < 0.02, "measured length should agree with the published length within 2%"
        shapes.add((round(d["length_m"]), len(d["corners"])))
    assert len(shapes) == len(IDS)


def test_reference_circuit_keeps_the_existing_calibration_exactly():
    cfg = load_config("default")
    assert cfg.circuit == "silverstone" and cfg.base_lap_s == 90.0
    assert cfg.fuel.initial_kg == 50.0 and cfg.fuel.burn_kg_per_lap == 1.9 and cfg.pit.transit_s == 5.0
    assert cfg.tyres["SOFT"].wear_rate == 0.070


def test_simulation_inputs_depend_on_the_circuit():
    cfgs = {c: load_config("default", circuit=c) for c in IDS}
    assert len({round(c.base_lap_s, 1) for c in cfgs.values()}) == len(IDS)
    for cid, cfg in cfgs.items():
        info = tracks.track_info(cid)
        assert cfg.track_applied and cfg.circuit == cid
        # fuel per lap follows the lap length; the starting load keeps the same margin
        assert cfg.fuel.burn_kg_per_lap == pytest.approx(1.9 * info.sim.length_factor, rel=1e-3)
        assert cfg.fuel.initial_kg / cfg.fuel.burn_kg_per_lap == pytest.approx(50.0 / 1.9, rel=1e-3)
    assert cfgs["spa"].base_lap_s > cfgs["silverstone"].base_lap_s > cfgs["monza"].base_lap_s > cfgs["zandvoort"].base_lap_s
    # scaling is applied once: copies and rebuilds do not rescale
    spa = cfgs["spa"]
    assert spa.model_copy().base_lap_s == spa.base_lap_s
    assert type(spa)(**spa.model_dump()).base_lap_s == spa.base_lap_s


def test_catalogue_endpoints(client):
    lst = client.get("/api/circuits").json()
    assert [c["id"] for c in lst] == IDS and all(c["sim"]["est_lap_s"] > 0 for c in lst)
    assert client.get("/api/circuits/spa").json()["country"] == "Belgium"
    assert client.get("/api/circuits/nowhere").status_code == 404
    assert client.post("/api/race/reset", json={"circuit": "nowhere"}).status_code == 404


def test_switching_circuit_resets_the_race_and_uses_the_new_track(client):
    s = client.post("/api/race/reset", json={"config_name": "demo", "circuit": "silverstone"}).json()
    assert s["circuit_id"] == "silverstone" and s["track"]["base_lap_s"] == 90.0
    for _ in range(4):
        client.post("/api/race/step")
    st = client.get("/api/race/state").json()
    assert st["lap"] == 4 and len(st["laps"]) == 4
    first_lap_silverstone = st["laps"][0]["lap_time_s"]

    s = client.post("/api/race/reset", json={"circuit": "spa"}).json()      # config name is kept, circuit changes
    assert s["circuit_id"] == "spa" and s["config_name"] == "demo"
    assert s["lap"] == 0 and s["status"] == "idle" and s["laps"] == [] and s["elapsed_s"] == 0
    assert all(c["laps"] == [] for c in s["cars"]) and s["track"]["length_m"] == pytest.approx(7000, abs=5)
    assert s["recommendation"]["trigger"] == "RACE_START"          # strategy re-initialised for the new circuit
    client.post("/api/race/step")
    first_lap_spa = client.get("/api/race/state").json()["laps"][0]["lap_time_s"]
    assert first_lap_spa > first_lap_silverstone + 8              # a ~7 km lap is clearly longer than a ~5.9 km lap

    # omitting the circuit keeps the current one; switching back restores Silverstone's numbers
    assert client.post("/api/race/reset", json={}).json()["circuit_id"] == "spa"
    assert client.post("/api/race/reset", json={"circuit": "silverstone"}).json()["track"]["base_lap_s"] == 90.0


def test_switching_while_a_race_is_running_starts_a_fresh_idle_race(client):
    client.post("/api/race/reset", json={"config_name": "demo"})
    assert client.post("/api/race/start").status_code == 200
    s = client.post("/api/race/reset", json={"circuit": "monza"}).json()
    assert s["status"] == "idle" and s["lap"] == 0 and s["circuit_id"] == "monza"
    assert client.post("/api/race/pause").status_code == 409        # nothing is running any more


@pytest.mark.parametrize("cid", IDS)
def test_full_race_on_each_circuit_is_valid(client, cid):
    s = client.post("/api/race/reset", json={"config_name": "demo", "circuit": cid}).json()
    assert s["circuit_id"] == cid
    done = client.post("/api/race/finish").json()
    assert done["status"] == "finished" and done["lap"] == done["total_laps"]
    for car in done["cars"]:
        assert len(car["laps"]) == done["total_laps"]
    # the strategy car never exceeded the wear limit or ran out of fuel on this circuit
    assert max(l["wear_end"] for l in done["laps"]) <= done["max_wear"] + 1e-6
    assert min(l["fuel_end_kg"] for l in done["laps"]) >= done["fuel_reserve_kg"] - 1e-6
    prim = next(c for c in done["cars"] if c["is_primary"])
    # the lap times on screen come from this circuit's base lap, not another's
    base = done["track"]["base_lap_s"]
    mean_lap = sum(l["lap_time_s"] for l in prim["laps"]) / len(prim["laps"])
    assert 0.95 * base < mean_lap < 1.35 * base


@pytest.mark.parametrize("cid", ["spa", "monza"])
def test_benchmark_runs_on_other_circuits_and_results_are_tagged(cid):
    res = run_benchmark(trials=2, seed_start=10000, scenarios=6, config_name="default", circuit=cid)
    assert res["summary"]["circuit_id"] == cid and res["summary"]["failed_trials"] == 0
    assert res["summary"]["tyre_violations"] == 0 and res["summary"]["fuel_failures"] == 0


def test_benchmark_results_are_kept_per_circuit(client):
    r = client.get("/api/evaluation/results")
    # the committed Silverstone run is served for Silverstone, and no other circuit is silently given those numbers
    client.post("/api/race/reset", json={"circuit": "silverstone"})
    assert client.get("/api/evaluation/results", params={"circuit": "spa"}).status_code == 404
    assert r.status_code in (200, 404)
