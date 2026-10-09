import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import type { RaceState } from "../types/race";

export interface RaceFeed {
  state: RaceState | null;
  mode: "ws" | "poll";
  online: boolean;
  /** performance.now() timestamp of the last lap/status change, used to animate the car */
  lapStartedAt: number;
  apply: (s: RaceState) => void;
}

export function useRaceState(): RaceFeed {
  const [state, setState] = useState<RaceState | null>(null);
  const [mode, setMode] = useState<"ws" | "poll">("poll");
  const [online, setOnline] = useState(false);
  const [lapStartedAt, setLapStartedAt] = useState(() => performance.now());
  const verRef = useRef(-1);
  const keyRef = useRef("");

  const apply = useCallback((s: RaceState) => {
    // versions are monotone within a backend run; a big drop means the backend restarted
    if (s.version < verRef.current && verRef.current - s.version < 50) return;
    verRef.current = s.version;
    const key = `${s.lap}|${s.status}|${s.speed}`;
    if (key !== keyRef.current) {
      keyRef.current = key;
      setLapStartedAt(performance.now());
    }
    setState(s);
    setOnline(true);
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: number | undefined;
    let closed = false;
    const connect = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      try {
        ws = new WebSocket(`${proto}://${location.host}/ws/race`);
      } catch {
        retry = window.setTimeout(connect, 5000);
        return;
      }
      ws.onopen = () => setMode("ws");
      ws.onmessage = (m) => {
        try { apply(JSON.parse(m.data) as RaceState); } catch { /* ignore malformed frame */ }
      };
      ws.onclose = () => {
        setMode("poll");
        if (!closed) retry = window.setTimeout(connect, 5000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      ws?.close();
    };
  }, [apply]);

  useEffect(() => {
    if (mode !== "poll") return;
    let stop = false;
    const tick = () => api.state().then((s) => { if (!stop) apply(s); }).catch(() => { if (!stop) setOnline(false); });
    tick();
    const id = window.setInterval(tick, 1000);
    return () => { stop = true; window.clearInterval(id); };
  }, [mode, apply]);

  return { state, mode, online, lapStartedAt, apply };
}
