import { useMemo } from "react";
import type { Circuit } from "../../lib/circuit";
import type { QualitySettings } from "../../lib/quality";
import { makeTerrain } from "../../lib/terrain";
import type { Recommendation } from "../../types/race";
import { useWetUniform } from "./materials";
import type { LiveData } from "./live";
import { Safe } from "./Safe";
import Sky from "./Sky";
import Track from "./Track";
import { Ground, PitComplex, Scenery } from "./Venue";
import { buildTrackGeometries } from "./trackGeometry";

interface Props {
  circuit: Circuit;
  live: React.MutableRefObject<LiveData>;
  reco: Recommendation | null;
  boxLabel: string;
  q: QualitySettings;
}

/** The racing venue: sky and light, terrain, the textured circuit, the pit complex and the trackside scenery. */
export default function Environment({ circuit: c, live, reco, boxLabel, q }: Props) {
  const geo = useMemo(() => buildTrackGeometries(c), [c]);
  const terrain = useMemo(() => makeTerrain(c, q.terrainSegments), [c, q.terrainSegments]);
  const wet = useWetUniform();
  return (
    <group>
      <Safe name="sky"><Sky live={live} q={q} /></Safe>
      <Safe name="terrain"><Ground terrain={terrain} q={q} wet={wet} /></Safe>
      <Safe name="circuit"><Track circuit={c} geo={geo} live={live} q={q} wet={wet} reco={reco} boxLabel={boxLabel} /></Safe>
      <Safe name="pit complex"><PitComplex circuit={c} /></Safe>
      <Safe name="scenery"><Scenery circuit={c} terrain={terrain} q={q} /></Safe>
    </group>
  );
}
