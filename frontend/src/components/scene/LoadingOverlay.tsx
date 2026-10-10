import { useEffect, useState } from "react";
import { useProgress } from "@react-three/drei";

/** Shows asset-loading progress over the 3D view, and a notice if any optional asset failed to load. */
export default function LoadingOverlay() {
  const { active, progress, loaded, total } = useProgress();
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => {
    const on = (e: Event) => setFailed((f) => (f.includes((e as CustomEvent).detail) ? f : [...f, (e as CustomEvent).detail]));
    window.addEventListener("scene-asset-failed", on);
    return () => window.removeEventListener("scene-asset-failed", on);
  }, []);
  return (
    <>
      {active && (
        <div className="absolute inset-x-0 top-24 z-20 flex justify-center pointer-events-none">
          <div className="px-4 py-2 text-[13px] num uppercase tracking-wider"
            style={{ background: "rgba(36,9,15,.88)", border: "1px solid rgba(255,120,130,.35)" }}>
            Loading 3D assets {Math.round(progress)}% <span className="opacity-60">({loaded}/{total})</span>
            <div className="mt-1 h-[3px] w-56" style={{ background: "rgba(255,255,255,.12)" }}>
              <div className="h-full" style={{ width: `${progress}%`, background: "#ff2d3a" }} />
            </div>
          </div>
        </div>
      )}
      {failed.length > 0 && (
        <div className="absolute left-3 bottom-[250px] z-20 text-[12px] px-2 py-1 pointer-events-none"
          style={{ background: "rgba(60,20,0,.85)", border: "1px solid #ffb020", color: "#ffd9a0" }}>
          {failed.length} asset(s) failed to load; using simple fallbacks ({failed.slice(0, 3).join(", ")})
        </div>
      )}
    </>
  );
}
