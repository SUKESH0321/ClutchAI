import type { Place } from "../../lib/raceClock";

/** Per-frame render state shared between scene components WITHOUT triggering React re-renders. */
export interface CarLive {
  x: number; y: number; tx: number; ty: number;   // map-frame pose (metres, unit tangent)
  place: Place;
  speed: number;     // m/s, from the authoritative lap timing (distance / time), smoothed
  brake: number;     // 0..1, how hard the car is slowing (drives brake lights)
  steer: number;     // radians, front-wheel steer from the track curvature
}

export interface LiveData {
  poses: Map<string, CarLive>;
  ghost: CarLive | null;
  wetness: number;       // wetness of the lap currently on screen (leader's lap): the target
  wet: number;           // smoothed wetness actually used by materials and effects
  safetyCar: boolean;    // safety car on the lap currently on screen
  raceT: number;         // visual race clock (s)
  leaderTotal: number;   // leader progress in laps
  primaryPit: "none" | "in" | "stopped" | "out";
  startLights: number;   // 0 = off; 1..5 = lights lit; 6 = all out (race start)
  focus: { x: number; z: number };   // ground point the camera is looking at (for shadows)
  finished: boolean;
}
export const newLive = (): LiveData => ({
  poses: new Map(), ghost: null, wetness: 0, wet: 0, safetyCar: false, raceT: 0, leaderTotal: 0,
  primaryPit: "none", startLights: 0, focus: { x: 0, z: 0 }, finished: false,
});

export type CamMode = "cinematic" | "top" | "follow" | "chase" | "corner";
