import type { Place } from "../../lib/raceClock";

/** Per-frame render state shared between scene components WITHOUT triggering React re-renders. */
export interface CarLive { x: number; y: number; tx: number; ty: number; place: Place }
export interface LiveData {
  poses: Map<string, CarLive>;
  ghost: CarLive | null;
  wetness: number;       // wetness of the lap currently on screen (leader's lap)
  safetyCar: boolean;    // safety car on the lap currently on screen
  raceT: number;         // visual race clock (s)
  leaderTotal: number;   // leader progress in laps
  primaryPit: "none" | "in" | "stopped" | "out";
}
export const newLive = (): LiveData => ({
  poses: new Map(), ghost: null, wetness: 0, safetyCar: false, raceT: 0, leaderTotal: 0, primaryPit: "none",
});

export type CamMode = "cinematic" | "top" | "follow";
