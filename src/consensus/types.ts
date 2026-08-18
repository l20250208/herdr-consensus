export type Severity = "P0" | "P1" | "P2" | "P3";

export type EvidenceTier =
  | "runtime_reproduced"
  | "code_proven"
  | "corroborated"
  | "agent_asserted"
  | "unknown";

export interface SourceLocation {
  path: string;
  startLine: number | null;
  endLine: number | null;
  symbol: string | null;
}

export interface NormalizedFinding {
  findingId: string;
  sourceId: string;
  originalSeverity: string;
  severity: Severity;
  title: string;
  category: string;
  location: SourceLocation | null;
  rootCause: string | null;
  impact: string;
  evidence: string[];
  evidenceTier: EvidenceTier;
  reproduction: string[];
  suggestedFix: string | null;
  needsRuntimeValidation: boolean;
  rawArtifactSha256: string;
}

export type Relation = "common" | "single_source" | "possible_match" | "disputed";

export interface ConsensusItem {
  itemId: string;
  findingIds: string[];
  relation: Relation;
  matchScore: number | null;
  severity: Severity;
  evidenceTier: EvidenceTier;
  disagreementReasons: string[];
  status: string;
}

export const SEVERITY_ORDER: readonly Severity[] = ["P0", "P1", "P2", "P3"];

export function severityIndex(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

/** Returns the more severe of two severities (P0 is most severe). */
export function higherSeverity(a: Severity, b: Severity): Severity {
  return severityIndex(a) <= severityIndex(b) ? a : b;
}
