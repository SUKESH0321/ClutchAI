import { useEffect, useState } from "react";
import type { LiveData } from "./live";

/** On-screen mirror of the start gantry (visible from any camera). Re-renders only when the light count changes. */
export default function StartLightsHud({ live }: { live: React.MutableRefObject<LiveData> }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => { const v = live.current.startLights; setN((p) => (p === v ? p : v)); }, 80);
    return () => window.clearInterval(id);
  }, [live]);
  if (n === 0) return null;
  return (
    <div className="absolute inset-x-0 top-36 z-20 flex flex-col items-center gap-1 pointer-events-none">
      <div className="flex gap-2 px-3 py-2" style={{ background: "rgba(10,10,14,.85)", border: "1px solid rgba(255,255,255,.15)" }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="w-6 h-6 rounded-full"
            style={{ background: n <= 5 && i < n ? "#ff2a2a" : "#2a0606", boxShadow: n <= 5 && i < n ? "0 0 12px #ff2a2a" : "none" }} />
        ))}
      </div>
      {n === 6 && <div className="num text-[22px] tracking-[.3em] text-white">LIGHTS OUT</div>}
    </div>
  );
}
