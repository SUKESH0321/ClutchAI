import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Circuit } from "../../lib/circuit";
import { baselineLaps, placeCar, placeOptsFor, poseOf, type LapPoint, type RaceClock } from "../../lib/raceClock";
import type { CarSummary } from "../../types/race";
import type { RaceState } from "../../types/race";
import type { LiveData } from "./live";

/** Low-poly formula car. Local +X is the nose; dimensions in metres (real scale), enlarged at render. */
export function CarModel({ color, ghost = false }: { color: string; ghost?: boolean }) {
  const body = useMemo(() => new THREE.MeshStandardMaterial({
    color, metalness: 0.35, roughness: 0.4, transparent: ghost, opacity: ghost ? 0.35 : 1,
  }), [color, ghost]);
  const dark = useMemo(() => new THREE.MeshStandardMaterial({ color: "#0c0d10", roughness: 0.7, transparent: ghost, opacity: ghost ? 0.35 : 1 }), [ghost]);
  const white = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f2f2f2", roughness: 0.5, transparent: ghost, opacity: ghost ? 0.35 : 1 }), [ghost]);
  return (
    <group>
      <mesh material={body} position={[0.2, 0.5, 0]} castShadow><boxGeometry args={[3.0, 0.5, 0.85]} /></mesh>
      <mesh material={body} position={[2.3, 0.38, 0]} castShadow><boxGeometry args={[1.6, 0.22, 0.45]} /></mesh>
      <mesh material={white} position={[0.3, 0.78, 0]}><boxGeometry args={[2.2, 0.06, 0.18]} /></mesh>
      <mesh material={dark} position={[0.5, 0.9, 0]} castShadow><boxGeometry args={[0.9, 0.35, 0.5]} /></mesh>
      <mesh material={body} position={[-1.0, 0.85, 0]} castShadow><boxGeometry args={[1.3, 0.4, 0.55]} /></mesh>
      <mesh material={body} position={[3.1, 0.18, 0]}><boxGeometry args={[0.5, 0.06, 2.0]} /></mesh>
      <mesh material={white} position={[3.1, 0.3, 1.0]}><boxGeometry args={[0.5, 0.25, 0.06]} /></mesh>
      <mesh material={white} position={[3.1, 0.3, -1.0]}><boxGeometry args={[0.5, 0.25, 0.06]} /></mesh>
      <mesh material={body} position={[-2.2, 1.25, 0]} castShadow><boxGeometry args={[0.55, 0.06, 1.7]} /></mesh>
      <mesh material={dark} position={[-2.2, 0.95, 0.8]}><boxGeometry args={[0.55, 0.7, 0.05]} /></mesh>
      <mesh material={dark} position={[-2.2, 0.95, -0.8]}><boxGeometry args={[0.55, 0.7, 0.05]} /></mesh>
      <mesh material={body} position={[-2.0, 0.55, 0]}><boxGeometry args={[0.8, 0.2, 0.5]} /></mesh>
      {[[1.9, 1.0, 0.33], [1.9, -1.0, 0.33], [-1.5, 1.05, 0.38], [-1.5, -1.05, 0.38]].map(([x, z, r], i) => (
        <mesh key={i} material={dark} position={[x, r, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[r, r, i < 2 ? 0.5 : 0.7, 14]} />
        </mesh>
      ))}
    </group>
  );
}

interface Props {
  circuit: Circuit;
  state: RaceState;
  clock: RaceClock;
  live: React.MutableRefObject<LiveData>;
  selectedId: string;
  onSelect: (id: string) => void;
}

const _v = new THREE.Vector3();

export default function Cars({ circuit: c, state, clock, live, selectedId, onSelect }: Props) {
  const camera = useThree((s) => s.camera);
  const groups = useRef<Record<string, THREE.Group | null>>({});
  const ghostRef = useRef<THREE.Group>(null);
  const scRef = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  const scLabel = useRef<HTMLDivElement>(null);
  const cars = state.cars;
  const stateRef = useRef(state);
  stateRef.current = state;

  const opts = useMemo(() => {
    const m = new Map<string, ReturnType<typeof placeOptsFor>>();
    cars.forEach((car, i) => m.set(car.id, placeOptsFor(c, state.pit_service_ratio, car.grid_slot, i, cars.length)));
    m.set("__ghost", placeOptsFor(c, state.pit_service_ratio, 5, 0, cars.length));
    return m;
  }, [c, cars.length, state.pit_service_ratio]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ clock: three }) => {
    const s = stateRef.current;
    const t = clock.now();
    const L = live.current;
    L.raceT = t;
    let leader = -Infinity;
    for (const car of s.cars) {
      const o = opts.get(car.id)!;
      const laps: LapPoint[] = car.laps;
      const place = placeCar(laps, t, o);
      const pose = poseOf(c, place);
      leader = Math.max(leader, place.total);
      let x = pose.x, y = pose.y;
      if (place.kind === "track" && place.total < 0.012) {            // staggered grid, fades after launch
        const lat = (car.grid_slot % 2 ? 3.2 : -3.2) * Math.min(1, Math.max(0, 1 - Math.max(0, place.total) / 0.012));
        x += -pose.ty * lat; y += pose.tx * lat;
      }
      L.poses.set(car.id, { x, y, tx: pose.tx, ty: pose.ty, place });
      const g = groups.current[car.id];
      if (g) {
        g.position.set(x, 0.12, -y);
        g.rotation.y = Math.atan2(pose.ty, pose.tx);
        const d = camera.position.distanceTo(_v.set(x, 0, -y));
        const base = Math.min(4.2, Math.max(1.3, d * 0.0085));
        g.scale.setScalar(car.is_primary ? base * 1.12 : base);
      }
      if (car.is_primary) {
        L.primaryPit = place.kind === "pit" ? (place.stopped ? "stopped" : place.s < c.pit.lineDist ? "in" : "out") : "none";
      }
    }
    L.leaderTotal = leader;

    // visual weather / safety-car state comes from the lap the clock is currently inside
    const prim = s.cars.find((q) => q.is_primary);
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

    // baseline ghost
    if (s.baseline && ghostRef.current) {
      const bl = baselineLaps(s);
      const place = placeCar(bl, t, opts.get("__ghost")!);
      const pose = poseOf(c, place);
      L.ghost = { x: pose.x, y: pose.y, tx: pose.tx, ty: pose.ty, place };
      ghostRef.current.visible = true;
      ghostRef.current.position.set(pose.x, 0.3, -pose.y);
      ghostRef.current.rotation.y = Math.atan2(pose.ty, pose.tx);
      const d = camera.position.distanceTo(_v.set(pose.x, 0, -pose.y));
      ghostRef.current.scale.setScalar(Math.min(4.2, Math.max(1.3, d * 0.0085)));
    } else if (ghostRef.current) ghostRef.current.visible = false;

    // safety car leads the field
    if (scRef.current) {
      scRef.current.visible = L.safetyCar;
      if (scLabel.current) scLabel.current.style.display = L.safetyCar ? "block" : "none";
      if (L.safetyCar) {
        const lf = ((leader % 1) + 1) % 1;
        const p = c.pointAt(lf + 140 / c.length);
        scRef.current.position.set(p.x, 0.12, -p.y);
        scRef.current.rotation.y = Math.atan2(p.ty, p.tx);
        const d = camera.position.distanceTo(_v.set(p.x, 0, -p.y));
        scRef.current.scale.setScalar(Math.min(4.2, Math.max(1.3, d * 0.0085)));
      }
    }
    // pulsing beacon on the strategy car
    const pp = L.poses.get(prim?.id ?? "");
    if (beacon.current && pp) {
      beacon.current.position.set(pp.x, 0, -pp.y);
      const sc = 1 + 0.25 * Math.sin(three.elapsedTime * 4);
      const d = camera.position.distanceTo(_v.set(pp.x, 0, -pp.y));
      const k = Math.min(60, Math.max(10, d * 0.04));
      beacon.current.scale.set(k * 0.35 * sc, k, k * 0.35 * sc);
      beacon.current.position.y = k * 0.5;
      beacon.current.visible = d > 120;
    }
  });

  return (
    <group>
      {cars.map((car: CarSummary) => (
        <group key={car.id} ref={(g) => { groups.current[car.id] = g; }}
          onClick={(e) => { e.stopPropagation(); onSelect(car.id); }}>
          <CarModel color={car.color} />
          <mesh position={[0.2, 1, 0]} visible={true}>
            <sphereGeometry args={[5, 8, 8]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          {selectedId === car.id && (
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.2, 0.05, 0]}>
              <ringGeometry args={[3.6, 4.2, 40]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.9} side={THREE.DoubleSide} />
            </mesh>
          )}
          <Html position={[0.2, car.is_primary ? 4.2 : 3.2, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
            <div className={`num uppercase whitespace-nowrap leading-none ${car.is_primary ? "text-[17px] px-2 py-[2px]" : "text-[12px] px-[5px]"}`}
              style={{ background: car.is_primary ? "#ff2d3a" : "rgba(0,0,0,.65)", color: "#fff", border: `1px solid ${car.color}` }}>
              {car.is_primary ? "STRATEGY CAR" : car.code}
            </div>
          </Html>
        </group>
      ))}
      <group ref={ghostRef} visible={false}><CarModel color="#ffffff" ghost /></group>
      <group ref={scRef} visible={false}>
        <CarModel color="#ffcc00" />
        <mesh position={[0.2, 1.4, 0]}><boxGeometry args={[0.4, 0.15, 1.2]} /><meshBasicMaterial color="#ff8800" /></mesh>
        <Html position={[0.2, 4.5, 0]} center><div ref={scLabel} className="num text-[12px] px-1" style={{ background: "#ffb020", color: "#000", display: "none" }}>SAFETY CAR</div></Html>
      </group>
      <mesh ref={beacon}>
        <cylinderGeometry args={[1, 1, 1, 12, 1, true]} />
        <meshBasicMaterial color="#ff2d3a" transparent opacity={0.28} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
