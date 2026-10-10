import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { CHARACTER } from "../../lib/assets";
import type { Circuit } from "../../lib/circuit";
import type { LiveData } from "./live";

/**
 * Pit crew (Kenney Blocky Characters, CC0). Two pooled crews of six: four wheel gunners and two jack men.
 * A crew is assigned to a car when the real race state says it is entering the pit lane, works only while the
 * car is actually stationary in its box (the simulation's service time), cheers briefly when the car is released,
 * and is freed once the car has left. Nothing here changes timing: it only reads where the car is.
 */
const POOL = 3;
const CH = 1.75;                       // character scale (Kenney characters are ~1 unit tall)
const FILES = ["character-a", "character-c", "character-k"] as const;
const LOCAL = [                         // [x forward, z right, yaw], relative to the car at its box (mid-wheelbase)
  [1.565, -1.55, 0], [1.565, 1.55, Math.PI], [-1.565, -1.55, 0], [-1.565, 1.55, Math.PI],   // wheel gunners
  [3.55, 0, -Math.PI / 2], [-3.55, 0, Math.PI / 2],                                         // front / rear jack
] as const;

interface Member { root: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>; cur: string }
type Mode = "free" | "wait" | "work" | "done";

export default function PitCrew({ circuit: c, live }: { circuit: Circuit; live: React.MutableRefObject<LiveData> }) {
  const gl = FILES.map((f) => useGLTF(CHARACTER(f)));      // eslint-disable-line react-hooks/rules-of-hooks
  const crews = useMemo(() => Array.from({ length: POOL }, (_, ci) => {
    const group = new THREE.Group();
    group.visible = false;
    const members: Member[] = LOCAL.map((_l, mi) => {
      const g = gl[(ci + mi) % gl.length];
      const root = g.scene.clone(true);
      root.scale.setScalar(CH);
      root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; } });
      const holder = new THREE.Group(); holder.add(root); group.add(holder);
      const mixer = new THREE.AnimationMixer(root);
      const actions = new Map<string, THREE.AnimationAction>();
      for (const clip of g.animations) actions.set(clip.name, mixer.clipAction(clip));
      return { root: holder, mixer, actions, cur: "" };
    });
    return { group, members, car: "" as string, mode: "free" as Mode, t: 0 };
  }), [gl]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { crews.forEach((cr) => cr.members.forEach((m) => m.mixer.stopAllAction())); }, [crews]);

  const play = (m: Member, name: string) => {
    if (m.cur === name) return;
    const next = m.actions.get(name); if (!next) return;
    const prev = m.actions.get(m.cur);
    next.reset().fadeIn(0.18).play();
    prev?.fadeOut(0.18);
    m.cur = name;
  };

  useFrame((_, dt) => {
    const L = live.current;
    const claimed = new Set<string>();
    for (const [id, p] of L.poses) {
      const box = L.boxes.get(id);
      if (!box || p.place.kind !== "pit") continue;
      const pl = p.place;
      const phase = pl.stopped ? "stopped" : pl.s < c.pit.lineDist ? "in" : "out";
      const dist = Math.hypot(p.x - box.x, p.y - box.y);
      const need = (phase === "in" && dist < 120) || phase === "stopped" || (phase === "out" && dist < 35);
      if (!need) continue;
      claimed.add(id);
      let cr = crews.find((k) => k.car === id);
      if (!cr) cr = crews.find((k) => k.mode === "free");
      if (!cr) continue;
      if (cr.car !== id) { cr.car = id; cr.mode = "wait"; cr.t = 0; cr.group.visible = true; }
      if (phase === "stopped") cr.mode = "work";
      else if (phase === "out" && cr.mode === "work") { cr.mode = "done"; cr.t = 0; }
    }
    for (const cr of crews) {
      if (cr.mode === "free") continue;
      if (!claimed.has(cr.car) && !(cr.mode === "done" && cr.t < 1.6)) { cr.mode = "free"; cr.car = ""; cr.group.visible = false; continue; }
      const box = L.boxes.get(cr.car);
      if (!box) continue;
      cr.t += dt;
      cr.group.position.set(box.x, 0, -box.y);
      cr.group.rotation.y = Math.atan2(box.ty, box.tx);
      const arrive = Math.min(1, cr.t / 1.4);                                     // crew walks out from the pit wall
      const walkIn = (1 - arrive) * (1 - arrive) * 6;
      cr.members.forEach((m, i) => {
        const [x, z, yaw] = LOCAL[i];
        m.root.position.set(x - walkIn, 0, z);
        m.root.rotation.y = yaw;
        const gunner = i < 4;
        const name = cr.mode === "work" ? (gunner ? "interact-right" : "holding-both")
          : cr.mode === "done" ? "emote-yes" : arrive < 1 ? "walk" : "idle";
        play(m, name);
        m.mixer.update(dt * (cr.mode === "work" && gunner ? 1.6 : 1));
      });
    }
  });

  return <>{crews.map((cr, i) => <primitive key={i} object={cr.group} />)}</>;
}
