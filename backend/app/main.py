"""FastAPI application. Run: python -m uvicorn app.main:app --port 8000"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from . import schemas as S
from .config import list_configs
from .evaluation import trials_csv
from .session import BenchmarkRunner, RaceSession, SessionError


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.session = RaceSession()
    app.state.bench = BenchmarkRunner()
    yield


app = FastAPI(title="The Impossible Pit Stop - Race Strategist", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


def _sess() -> RaceSession:
    return app.state.session


async def _run(coro) -> dict:
    try:
        await coro
    except SessionError as exc:
        raise HTTPException(409, str(exc))
    return _sess().to_state()


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/configs")
def configs():
    return list_configs()


@app.post("/api/race/reset", response_model=S.RaceState)
async def reset(req: S.ResetRequest | None = None):
    req = req or S.ResetRequest()
    try:
        await _sess().reset(req.config_name, req.seed, req.total_laps)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    return _sess().to_state()


@app.post("/api/race/start", response_model=S.RaceState)
async def start():
    return await _run(_sess().start())


@app.post("/api/race/pause", response_model=S.RaceState)
async def pause():
    return await _run(_sess().pause())


@app.post("/api/race/resume", response_model=S.RaceState)
async def resume():
    return await _run(_sess().resume())


@app.post("/api/race/step", response_model=S.RaceState)
async def step():
    return await _run(_sess().step())


@app.post("/api/race/finish", response_model=S.RaceState)
async def finish():
    return await _run(_sess().finish())


@app.post("/api/race/speed", response_model=S.RaceState)
async def speed(req: S.SpeedRequest):
    return await _run(_sess().set_speed(req.speed))


@app.post("/api/race/event", response_model=S.RaceState)
async def event(req: S.EventRequest):
    return await _run(_sess().event(req.type, req.intensity))


@app.get("/api/race/state", response_model=S.RaceState)
def state():
    return _sess().to_state()


@app.get("/api/strategy/recommendation", response_model=S.Recommendation)
async def recommendation(refresh: bool = Query(False)):
    s = _sess()
    if refresh:
        await _run(s.refresh_recommendation())
    reco = s.policy.recommendation_dict()
    if reco is None:
        raise HTTPException(404, "no recommendation yet")
    return reco


@app.post("/api/evaluation/run", response_model=S.BenchmarkStatus, status_code=202)
async def eval_run(req: S.EvalRequest | None = None):
    req = req or S.EvalRequest()
    try:
        app.state.bench.start(req.trials, req.seed_start, req.scenarios)
    except SessionError as exc:
        raise HTTPException(409, str(exc))
    return app.state.bench.status()


@app.get("/api/evaluation/status", response_model=S.BenchmarkStatus)
def eval_status():
    return app.state.bench.status()


@app.get("/api/evaluation/results", response_model=S.BenchmarkResults)
def eval_results():
    if app.state.bench.results is None:
        raise HTTPException(404, "no benchmark results yet")
    return app.state.bench.results


@app.get("/api/evaluation/results.csv", response_class=PlainTextResponse)
def eval_csv():
    if app.state.bench.results is None:
        raise HTTPException(404, "no benchmark results yet")
    return PlainTextResponse(trials_csv(app.state.bench.results), media_type="text/csv")


@app.websocket("/ws/race")
async def ws_race(ws: WebSocket):
    await ws.accept()
    s = _sess()
    s.sockets.add(ws)
    try:
        await ws.send_json(s.to_state())
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        s.sockets.discard(ws)
