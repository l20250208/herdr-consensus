import type { NormalizedFinding, SourceLocation } from "./types.js";
import { tokenJaccard } from "./text.js";

function lineRange(loc: SourceLocation): [number, number] | null {
  if (loc.startLine === null) return null;
  return [loc.startLine, loc.endLine ?? loc.startLine];
}

function lineRangesOverlap(a: SourceLocation, b: SourceLocation): boolean {
  const ra = lineRange(a);
  const rb = lineRange(b);
  if (ra === null || rb === null) return false;
  return ra[0] <= rb[1] && rb[0] <= ra[1];
}

function lineOverlapRatio(a: SourceLocation, b: SourceLocation): number {
  const ra = lineRange(a);
  const rb = lineRange(b);
  if (ra === null || rb === null) return 0;
  const overlap = Math.min(ra[1], rb[1]) - Math.max(ra[0], rb[0]) + 1;
  if (overlap <= 0) return 0;
  const union = Math.max(ra[1], rb[1]) - Math.min(ra[0], rb[0]) + 1;
  return overlap / union;
}

function locationSimilarity(a: SourceLocation | null, b: SourceLocation | null): number {
  if (a === null || b === null) return 0;
  if (a.symbol !== null && b.symbol !== null) {
    return a.symbol === b.symbol ? 1 : 0;
  }
  return lineOverlapRatio(a, b);
}

/** Deterministic match: same file with overlapping line ranges. */
export function isDeterministicMatch(a: NormalizedFinding, b: NormalizedFinding): boolean {
  if (a.location === null || b.location === null) return false;
  if (a.location.path !== b.location.path) return false;
  return lineRangesOverlap(a.location, b.location);
}

/** Weighted local similarity: path .30, location/symbol .20, category .15, title/root .25, fix .10. */
export function similarityScore(a: NormalizedFinding, b: NormalizedFinding): number {
  const pathSim =
    a.location !== null && b.location !== null && a.location.path === b.location.path ? 1 : 0;
  const locSim = locationSimilarity(a.location, b.location);
  const catSim = a.category === b.category ? 1 : 0;
  const tokenSim = tokenJaccard(`${a.title} ${a.rootCause ?? ""}`, `${b.title} ${b.rootCause ?? ""}`);
  const fixSim =
    a.suggestedFix !== null && b.suggestedFix !== null ? tokenJaccard(a.suggestedFix, b.suggestedFix) : 0;
  return 0.3 * pathSim + 0.2 * locSim + 0.15 * catSim + 0.25 * tokenSim + 0.1 * fixSim;
}
