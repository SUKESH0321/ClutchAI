import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { LiveData } from "./live";
import type { QualitySettings } from "../../lib/quality";

const BOX = 260;

/** Rain streaks around the camera target; density follows the on-screen lap's track wetness. */
export default function Rain({ live, q }: { live: React.MutableRefObject<LiveData>; q: QualitySettings }) {
  const COUNT = Math.max(1, q.rain);
  const lines = useRef<THREE.LineSegments>(null);
  const camera = useThree((s) => s.camera);
  const base = useMemo(() => {
    const a = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      a[i * 3] = (Math.random() - 0.5) * BOX;
      a[i * 3 + 1] = Math.random() * 120;
      a[i * 3 + 2] = (Math.random() - 0.5) * BOX;
    }
    return a;
  }, [COUNT]);
  const pos = useMemo(() => new Float32Array(COUNT * 6), [COUNT]);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, [pos]);

  useFrame(({ clock }) => {
    const m = lines.current;
    if (!m) return;
    const w = live.current.wet;
    const n = Math.floor(COUNT * Math.min(1, Math.max(0, (w - 0.05) * 1.3)));
    m.visible = n > 0;
    if (!n) return;
    const t = clock.elapsedTime;
    const cx = camera.position.x, cz = camera.position.z;
    const h = Math.min(160, Math.max(40, camera.position.y));
    for (let i = 0; i < n; i++) {
      const y = h - ((base[i * 3 + 1] + t * 90) % h);
      const x = cx + base[i * 3], z = cz + base[i * 3 + 2];
      pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = x - 0.6; pos[i * 6 + 4] = y - 3.2; pos[i * 6 + 5] = z;
    }
    geo.setDrawRange(0, n * 2);
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  });

  return (
    <lineSegments ref={lines} geometry={geo} frustumCulled={false}>
      <lineBasicMaterial color="#9ec7ff" transparent opacity={0.45} />
    </lineSegments>
  );
}
