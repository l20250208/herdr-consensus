import type { Severity } from "./types.js";

/** Maps an agent's free-form severity string to a P0–P3 level. Unknown → P2. */
export function mapSeverity(raw: string): Severity {
  const s = raw.trim().toLowerCase();
  if (
    s.startsWith("p0") ||
    s === "critical" ||
    s === "crit" ||
    s === "blocker" ||
    s === "emergency" ||
    s === "catastrophic"
  ) {
    return "P0";
  }
  if (s.startsWith("p1") || s === "high" || s === "major" || s === "severe" || s === "error") {
    return "P1";
  }
  if (s.startsWith("p2") || s === "medium" || s === "moderate" || s === "normal" || s === "warning") {
    return "P2";
  }
  if (
    s.startsWith("p3") ||
    s === "low" ||
    s === "minor" ||
    s === "info" ||
    s === "informational" ||
    s === "trivial" ||
    s === "nit" ||
    s === "suggestion"
  ) {
    return "P3";
  }
  return "P2";
}
