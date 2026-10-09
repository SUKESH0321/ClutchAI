import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Circuit } from "../../lib/circuit";
import type { QualitySettings } from "../../lib/quality";
import { baselineLaps, placeCar, placeOptsFor, poseOf, type LapPoint, type RaceClock } from "../../lib/raceClock";
import type { Compound, RaceState } from "../../types/race";
import { CarRig, type CarRigApi, type RigUpdate } from "./CarRig";
import { liveryFor, type Livery } from "./livery";
import type { CarLive, LiveData } from "./live";
import { Safe } from "./Safe";

/** Shown if a car model fails to load: a plain coloured block that keeps the simulation fully usable. */
const FallbackRig = forwardRef<CarRigApi, { color: string }>(function FallbackRig({ color }, ref) {
  const root = useRef<THREE.Group>(null);
  useImperativeHandle(ref, () => ({
    get root() { return root.current!; },
    update() { /* no animation for the fallback */ },
    setSelected() { /* no ring */ },
    setScale(s: number) { root.current?.scale.setScalar(s); },
  }), []);
  return (
    <group ref={root}>
      <mesh position={[0, 0.55, 0]} castShadow><boxGeometry args={[5.4, 0.8, 1.8]} /><meshStandardMaterial color={color} roughness={0.5} /></mesh>
    </group>
  );
});

interface Props {
  circuit: Circuit;
  state: RaceState;
  clock: RaceClock;
  live: React.MutableRefObject<LiveData>;
  selectedId: string;
  onSelect: (id: string) => void;
  q: QualitySettings;
}

const _v = new THREE.Vector3();
const SC_LIVERY: Livery = { primary: "#ffb020", secondary: "#16181d", number: 0, model: "race" };

interface Track { x: number; y: number; t: number; speed: number; brake: number; init: boolean }

export default function Cars({ circuit: c, state, clock, live, selectedId, onSelect, q }: Props) {
  const camera = useThree((s) => s.camera);
  const rigs = useRef<Record<string, CarRigApi | null>>({});
  const ghostRig = useRef<CarRigApi | null>(null);
  const scGroup = useRef<THREE.Group>(null);
  const scRig = useRef<CarRigApi | null>(null);
  const lightbar = useRef<THREE.MeshStandardMaterial>(null);
  const beacon = useRef<THREE.Mesh>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const tracks = useRef<Map<string, Track>>(new Map());

  const cars = state.cars;
  const liveries = useMemo(() => {
    const out = new Map<string, Livery>();
    let rival = 0;
    cars.forEach((car) => out.set(car.id, liveryFor(car.is_primary ? 0 : rival++, car.color, car.is_primary)));
    return out;
  }, [cars.map((c0) => c0.id + c0.color).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const opts = useMemo(() => {
    const m = new Map<string, ReturnType<typeof placeOptsFor>>();
    cars.forEach((car, i) => m.set(car.id, placeOptsFor(c, state.pit_service_ratio, car.grid_slot, i, cars.length)));
    m.set("__ghost", placeOptsFor(c, state.pit_service_ratio, 5, 0, cars.length));
    live.current.boxes.clear();
    cars.forEach((car) => { const o = m.get(car.id)!; live.current.boxes.set(car.id, c.pitAt(Math.max(1, o.laneIn - o.boxBeforeM))); });
    return m;
  }, [c, cars.length, state.pit_service_ratio]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ clock: three }, dtWall) => {
    const s = stateRef.current;
    const L = live.current;
    const dbg = import.meta.env.DEV ? (window as unknown as { __hold?: boolean; __live?: unknown }) : null;
    if (dbg) dbg.__live = L;                                   // dev-only: lets the test scripts read/freeze the visual clock
    const t = dbg?.__hold ? L.raceT : clock.now();
    const dtRace = t - L.raceT;
    L.raceT = t;
    let leader = -Infinity;
    // after the flag each car coasts to its own stopping point (winner furthest on) so they do not stack
    const rank = new Map<string, number>();
    [...s.cars].sort((a, b) => a.elapsed_s - b.elapsed_s).forEach((car, i) => rank.set(car.id, i));
    L.finished = s.status === "finished";

    for (const car of s.cars) {
      const o = { ...opts.get(car.id)!, rollCap: 0.085 - 0.0085 * (rank.get(car.id) ?? 0) };
      const laps: LapPoint[] = car.laps;
      const place = placeCar(laps, t, o);
      const pose = poseOf(c, place);
      leader = Math.max(leader, place.total);
      let x = pose.x, y = pose.y;
      if (place.kind === "track" && place.total < 0.012) {            // staggered grid, fades after launch
        const lat = (car.grid_slot % 2 ? 3.2 : -3.2) * Math.min(1, Math.max(0, 1 - Math.max(0, place.total) / 0.012));
        x += -pose.ty * lat; y += pose.tx * lat;
      }
      // speed from the authoritative timing (distance / race time), smoothed
      let tr = tracks.current.get(car.id);
      if (!tr) { tr = { x, y, t, speed: 0, brake: 0, init: false }; tracks.current.set(car.id, tr); }
      if (dtRace > 1e-4 && tr.init) {
        const v = Math.hypot(x - tr.x, y - tr.y) / dtRace;
        const vs = tr.speed + (Math.min(v, 120) - tr.speed) * Math.min(1, dtWall * 8);
        const dec = (tr.speed - vs) / Math.max(dtRace, 1e-3);
        tr.brake += (THREE.MathUtils.clamp(dec / 20, 0, 1) - tr.brake) * Math.min(1, dtWall * 10);
        tr.speed = vs;
      } else if (dtRace <= 1e-4) {
        tr.speed *= Math.exp(-dtWall * 5); tr.brake *= Math.exp(-dtWall * 8);
      }
      tr.x = x; tr.y = y; tr.t = t; tr.init = true;

      const kappa = place.kind === "track" ? c.kappa[Math.round(place.frac * c.n) % c.n] : 0;
      const steer = THREE.MathUtils.clamp(Math.atan(2.8 * kappa) * 1.6, -0.5, 0.5);
      const cur: CarLive = { x, y, tx: pose.tx, ty: pose.ty, place, speed: tr.speed, brake: tr.brake, steer };
      L.poses.set(car.id, cur);

      const rig = rigs.current[car.id];
      if (!rig) continue;
      const g = rig.root;
      g.position.set(x, 0.02, -y);
      g.rotation.y = Math.atan2(pose.ty, pose.tx);
      const d = camera.position.distanceTo(_v.set(x, 0, -y));
      const base = Math.min(4.2, Math.max(1.0, d * 0.0085));
      rig.setScale(car.is_primary ? base * 1.12 : base);
      rig.setSelected(car.id === selectedId);

      const phase: RigUpdate["pit"] = place.kind === "pit" ? (place.stopped ? "stopped" : place.s < c.pit.lineDist ? "in" : "out") : "none";
      if (car.is_primary) L.primaryPit = phase === "none" ? "none" : phase;
      const lapIdx = Math.min(Math.max(place.lapNo - 1, 0), Math.max(0, car.laps.length - 1));
      let compound: Compound = car.laps[lapIdx]?.compound ?? car.compound;
      if (place.kind === "pit" && place.swapped) compound = car.laps[lapIdx + 1]?.compound ?? car.compound;
      if (place.kind === "track" && place.lapNo >= 2 && car.laps[place.lapNo - 2]?.pitted) compound = car.laps[lapIdx]?.compound ?? compound;
      rig.update({
        dt: dtWall, speed: tr.speed, brake: tr.brake, steer, latAccel: tr.speed * tr.speed * kappa, wet: L.wet,
        pit: phase, compound, pitLaunch: phase === "out" ? THREE.MathUtils.clamp(tr.speed / 40, 0, 1) * (1 - Math.min(1, (place.kind === "pit" ? place.s : 0) / (c.pit.lineDist + 60))) : 0,
      });
    }
    L.leaderTotal = leader;
    L.totalLaps = s.total_laps;
    L.startLights = clock.lights();

    // weather and safety-car state of the lap currently on screen; wetness eases toward its target
    const prim = s.cars.find((q0) => q0.is_primary);
    if (prim && s.laps.length) {
      let lo = 0, hi = prim.laps.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (prim.laps[mid].elapsed_s > t) hi = mid; else lo = mid + 1; }
      const rec = s.laps[Math.min(lo, s.laps.length - 1)];
      L.wetness = rec.wetness;
      L.safetyCar = rec.safety_car && (s.status === "running" || t < (prim.laps[Math.min(lo, prim.laps.length - 1)]?.elapsed_s ?? 0));
    } else {
      L.wetness = s.conditions.track_wetness;
      L.safetyCar = false;
    }
    L.wet += (L.wetness - L.wet) * (1 - Math.exp(-dtWall * 0.9));

    // baseline shadow car (what the fixed-stint strategy is doing under the same events)
    const gRig = ghostRig.current;
    if (gRig) {
      gRig.root.visible = !!s.baseline;
      if (s.baseline) {
        const bl = baselineLaps(s);
        const place = placeCar(bl, t, opts.get("__ghost")!);
        const pose = poseOf(c, place);
        L.ghost = { x: pose.x, y: pose.y, tx: pose.tx, ty: pose.ty, place, speed: 0, brake: 0, steer: 0 };
        gRig.root.position.set(pose.x, 0.05, -pose.y);
        gRig.root.rotation.y = Math.atan2(pose.ty, pose.tx);
        gRig.setScale(Math.min(4.2, Math.max(1.0, camera.position.distanceTo(_v.set(pose.x, 0, -pose.y)) * 0.0085)));
      }
    }

    // safety car leads the field
    const sg = scGroup.current;
    if (sg) {
      sg.visible = L.safetyCar;
      if (L.safetyCar) {
        const lf = ((leader % 1) + 1) % 1;
        const p = c.pointAt(lf + 150 / c.length);
        sg.position.set(p.x, 0.02, -p.y);
        sg.rotation.y = Math.atan2(p.ty, p.tx);
        sg.scale.setScalar(Math.min(4.2, Math.max(1.0, camera.position.distanceTo(_v.set(p.x, 0, -p.y)) * 0.0085)));
        scRig.current?.update({ dt: dtWall, speed: 20, brake: 0, steer: 0, latAccel: 0, wet: L.wet, pit: "none", compound: "MEDIUM", pitLaunch: 0 });
        if (lightbar.current) lightbar.current.emissiveIntensity = 1.2 + 3 * (Math.sin(three.elapsedTime * 14) > 0 ? 1 : 0);
      }
    }

    // pulsing beacon on the strategy car so it can be found from the overview camera
    const pp = L.poses.get(prim?.id ?? "");
    const b = beacon.current;
    if (b && pp) {
      const d = camera.position.distanceTo(_v.set(pp.x, 0, -pp.y));
      const k = Math.min(60, Math.max(10, d * 0.04)), sc = 1 + 0.25 * Math.sin(three.elapsedTime * 4);
      b.position.set(pp.x, k * 0.5, -pp.y);
      b.scale.set(k * 0.35 * sc, k, k * 0.35 * sc);
      b.visible = d > 140;
    }
  });

  return (
    <group>
      {cars.map((car) => {
        const lv = liveries.get(car.id)!;
        const props = { livery: lv, label: car.code, primary: car.is_primary, q, accent: car.color, onClick: () => onSelect(car.id) };
        return (
          <Safe key={car.id} name={`car ${car.code}`}
            fallback={
              <Safe name={`car ${car.code} (fallback model)`} fallback={<FallbackRig ref={(r) => { rigs.current[car.id] = r; }} color={car.color} />}>
                <CarRig ref={(r) => { rigs.current[car.id] = r; }} {...props} livery={{ ...lv, model: "race" }} />
              </Safe>}>
            <CarRig ref={(r) => { rigs.current[car.id] = r; }} {...props} />
          </Safe>
        );
      })}
      <Safe name="baseline ghost car">
        <CarRig ref={(r) => { ghostRig.current = r; }} livery={SC_LIVERY} label="BASE" primary={false} ghost q={q} accent="#ffffff" />
      </Safe>
      <group ref={scGroup} visible={false}>
        <Safe name="safety car">
          <CarRig ref={(r) => { scRig.current = r; }} livery={SC_LIVERY} label="SC" primary={false} q={q} accent="#ffb020" />
          <mesh position={[-0.2, 1.52, 0]}>
            <boxGeometry args={[0.5, 0.14, 1.9]} />
            <meshStandardMaterial ref={lightbar} color="#ffb020" emissive="#ff8800" emissiveIntensity={2} />
          </mesh>
        </Safe>
      </group>
      <mesh ref={beacon}>
        <cylinderGeometry args={[1, 1, 1, 12, 1, true]} />
        <meshBasicMaterial color="#ff2d3a" transparent opacity={0.28} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
