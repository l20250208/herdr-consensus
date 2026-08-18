import type { ArbitrationIndependence } from "./types.js";

export function assessIndependence(
  reviewAgentKinds: readonly string[],
  arbiterKind: string,
): ArbitrationIndependence {
  const known = [...new Set(reviewAgentKinds.filter((kind) => kind.trim() !== ""))];
  if (known.length < 2) return "unknown";
  return known.includes(arbiterKind) ? "weak" : "strong";
}
