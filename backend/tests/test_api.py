import time

import pytest
from fastapi.testclient import TestClient

from app import main


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import session
    monkeypatch.setattr(session, "RESULTS_DIR", tmp_path)
    orig = session.BenchmarkRunner.__init__
    monkeypatch.setattr(session.BenchmarkRunner, "__init__",
                        lambda self, out_dir=tmp_path: orig(self, out_dir))
    with TestClient(main.app) as c:
        yield c


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert "demo" in client.get("/api/configs").json()


def test_reset_step_state_and_initial_recommendation(client):
    s = client.post("/api/race/reset", json={"config_name": "demo"}).json()
    assert s["status"] == "idle" and s["lap"] == 0 and s["recommendation"]["trigger"] == "RACE_START"
    for _ in range(3):
        r = client.post("/api/race/step")
        assert r.status_code == 200
    st = client.get("/api/race/state").json()
    assert st["lap"] == 3 and len(st["laps"]) == 3 and st["status"] == "paused"
    assert st["baseline"]["gap_s"] == pytest.approx(st["baseline"]["elapsed_s"] - st["elapsed_s"])
    assert client.get("/api/strategy/recommendation").status_code == 200


def test_start_pause_resume_and_invalid_transitions(client):
    client.post("/api/race/reset", json={"config_name": "demo"})
    assert client.post("/api/race/pause").status_code == 409
    assert client.post("/api/race/start").status_code == 200
    assert client.post("/api/race/start").status_code == 409
    assert client.post("/api/race/speed", json={"speed": 16}).json()["speed"] == 16
    assert client.post("/api/race/speed", json={"speed": 99}).status_code == 422
    assert client.post("/api/race/pause").json()["status"] == "paused"
    assert client.post("/api/race/resume").json()["status"] == "running"
    client.post("/api/race/pause")
    assert client.post("/api/race/reset", json={"config_name": "nope"}).status_code == 404


def test_events_change_race_and_trigger_replan(client):
    client.post("/api/race/reset", json={"config_name": "demo"})
    for _ in range(4):
        client.post("/api/race/step")
    before = client.get("/api/race/state").json()["replan_count"]
    s = client.post("/api/race/event", json={"type": "RAIN", "intensity": 0.8}).json()
    assert s["conditions"]["rain_intensity"] == pytest.approx(0.8)
    assert s["replan_count"] == before + 1
    assert s["recommendation"]["trigger"] == "WEATHER_CHANGE"
    assert client.post("/api/race/event", json={"type": "SC_WITHDRAW"}).status_code == 409
    s = client.post("/api/race/event", json={"type": "SC_DEPLOY"}).json()
    assert s["conditions"]["safety_car"] and s["recommendation"]["trigger"] == "SC_DEPLOYED"
    types = [e["type"] for e in s["events"]]
    assert "STRATEGY_RECALCULATED" in types and "SC_DEPLOYED" in types
    assert client.post("/api/race/event", json={"type": "SC_DEPLOY"}).status_code == 409


def test_finish_and_event_after_finish(client):
    client.post("/api/race/reset", json={"config_name": "demo"})
    s = client.post("/api/race/finish").json()
    assert s["status"] == "finished" and s["lap"] == 25 and len(s["laps"]) == 25
    assert client.post("/api/race/event", json={"type": "RAIN"}).status_code == 409
    assert client.post("/api/race/finish").status_code == 409
    assert s["baseline"]["laps"] and s["events"][-1]["type"] == "RACE_FINISHED"


def test_benchmark_endpoint_real_results(client):
    assert client.get("/api/evaluation/results").status_code == 404
    r = client.post("/api/evaluation/run", json={"trials": 3, "seed_start": 10000, "scenarios": 4})
    assert r.status_code == 202
    t0 = time.time()
    while time.time() - t0 < 60:
        st = client.get("/api/evaluation/status").json()
        if st["state"] in ("done", "error"):
            break
        time.sleep(0.2)
    assert st["state"] == "done", st
    res = client.get("/api/evaluation/results").json()
    assert res["summary"]["trials"] == 3 and len(res["trials"]) == 3
    assert client.get("/api/evaluation/results.csv").text.startswith("seed,")


def test_websocket_receives_state(client):
    with client.websocket_connect("/ws/race") as ws:
        first = ws.receive_json()
        assert first["total_laps"] == 25
        client.post("/api/race/step")
        second = ws.receive_json()
        assert second["version"] > first["version"]


def test_multicar_state_is_consistent_with_engine(client):
    client.post("/api/race/reset", json={"config_name": "demo"})
    for _ in range(6):
        client.post("/api/race/step")
    st = client.get("/api/race/state").json()
    cars = st["cars"]
    assert len(cars) == 8 and sum(c["is_primary"] for c in cars) == 1
    prim = next(c for c in cars if c["is_primary"])
    assert prim["laps"][-1]["elapsed_s"] == pytest.approx(st["elapsed_s"])
    assert [c["position"] for c in sorted(cars, key=lambda c: c["position"])] == list(range(1, 9))
    assert min(c["gap_to_leader_s"] for c in cars) == 0
    for c in cars:
        assert len(c["laps"]) == 6
        assert c["laps"][-1]["elapsed_s"] == pytest.approx(sum(l["lap_time_s"] for l in c["laps"]))
    # rain is shared: every car sees the same wetness history
    client.post("/api/race/event", json={"type": "RAIN", "intensity": 0.8})
    client.post("/api/race/step")
    st = client.get("/api/race/state").json()
    assert st["circuit_id"] == "silverstone" and 0 < st["pit_service_ratio"] < 1
