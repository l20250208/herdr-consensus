import { isDeterministicMatch, similarityScore } from "./matcher.js";
import { detectDisputes } from "./dispute.js";
import { higherSeverity, type ConsensusItem, type EvidenceTier, type NormalizedFinding, type Relation } from "./types.js";

interface Candidate {
  a: number;
  b: number;
  deterministic: boolean;
  score: number;
}

function buildCandidates(a: NormalizedFinding[], b: NormalizedFinding[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const x = a[i]!;
      const y = b[j]!;
      const deterministic = isDeterministicMatch(x, y);
      const score = similarityScore(x, y);
      if (deterministic || score >= 0.55) {
        candidates.push({ a: i, b: j, deterministic, score });
      }
    }
  }
  candidates.sort((x, y) => {
    if (x.deterministic !== y.deterministic) return x.deterministic ? -1 : 1;
    return y.score - x.score;
  });
  return candidates;
}

function tierStrength(tier: EvidenceTier): number {
  switch (tier) {
    case "runtime_reproduced":
      return 4;
    case "code_proven":
      return 3;
    case "corroborated":
      return 2;
    case "agent_asserted":
      return 1;
    default:
      return 0;
  }
}

function maxTier(a: EvidenceTier, b: EvidenceTier): EvidenceTier {
  return tierStrength(a) >= tierStrength(b) ? a : b;
}

function statusFor(relation: Relation): string {
  if (relation === "common") return "common_confirmed";
  if (relation === "possible_match") return "needs_validation";
  if (relation === "disputed") return "disputed";
  return "single_source";
}

/**
 * Runs the consensus engine over two normalized finding lists: deterministic
 * and similarity-based matching with greedy assignment, then dispute detection.
 */
export function runConsensus(
  findingsA: NormalizedFinding[],
  findingsB: NormalizedFinding[],
): ConsensusItem[] {
  const candidates = buildCandidates(findingsA, findingsB);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const pairs: Candidate[] = [];
  for (const candidate of candidates) {
    if (usedA.has(candidate.a) || usedB.has(candidate.b)) continue;
    usedA.add(candidate.a);
    usedB.add(candidate.b);
    pairs.push(candidate);
  }

  const items: ConsensusItem[] = [];
  let seq = 0;

  for (const pair of pairs) {
    const a = findingsA[pair.a]!;
    const b = findingsB[pair.b]!;
    const reasons = detectDisputes(a, b);
    let relation: Relation;
    if (reasons.length > 0) relation = "disputed";
    else if (pair.deterministic || pair.score >= 0.8) relation = "common";
    else relation = "possible_match";

    const evidenceTier: EvidenceTier =
      relation === "common" ? "corroborated" : maxTier(a.evidenceTier, b.evidenceTier);

    items.push({
      itemId: `c-${++seq}`,
      findingIds: [a.findingId, b.findingId],
      relation,
      matchScore: pair.score,
      severity: higherSeverity(a.severity, b.severity),
      evidenceTier,
      disagreementReasons: reasons,
      status: statusFor(relation),
    });
  }

  for (let i = 0; i < findingsA.length; i++) {
    if (!usedA.has(i)) {
      const finding = findingsA[i]!;
      items.push({
        itemId: `c-${++seq}`,
        findingIds: [finding.findingId],
        relation: "single_source",
        matchScore: null,
        severity: finding.severity,
        evidenceTier: finding.evidenceTier,
        disagreementReasons: [],
        status: "single_source",
      });
    }
  }
  for (let j = 0; j < findingsB.length; j++) {
    if (!usedB.has(j)) {
      const finding = findingsB[j]!;
      items.push({
        itemId: `c-${++seq}`,
        findingIds: [finding.findingId],
        relation: "single_source",
        matchScore: null,
        severity: finding.severity,
        evidenceTier: finding.evidenceTier,
        disagreementReasons: [],
        status: "single_source",
      });
    }
  }

  return items;
}
