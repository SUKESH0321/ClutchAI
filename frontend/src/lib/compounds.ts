import type { Compound } from "../types/race";

export const COMPOUND_COLOR: Record<Compound, string> = {
  SOFT: "#FF3B3B", MEDIUM: "#FFD12E", HARD: "#EDEDED", WET: "#2F8BFF",
};
export const COMPOUND_LABEL: Record<Compound, string> = { SOFT: "S", MEDIUM: "M", HARD: "H", WET: "W" };
export const COMPOUNDS: Compound[] = ["SOFT", "MEDIUM", "HARD", "WET"];
