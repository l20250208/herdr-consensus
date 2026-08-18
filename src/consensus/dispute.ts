import type { NormalizedFinding } from "./types.js";
import { severityIndex } from "./types.js";
import { tokenJaccard } from "./text.js";

const PROTECTION_PATTERNS = [
  "already handled",
  "already mitigated",
  "already fixed",
  "not exploitable",
  "false positive",
  "no action needed",
  "protected by",
  "not an issue",
  "cannot be exploited",
  "not reachable",
  "existing guard",
  "already covered",
];

function looksLikeProtectionClaim(finding: NormalizedFinding): boolean {
  const text = `${finding.rootCause ?? ""} ${finding.suggestedFix ?? ""} ${finding.impact}`.toLowerCase();
  return PROTECTION_PATTERNS.some((pattern) => text.includes(pattern));
}

/**
 * Detects forced disagreements between two matched findings. Returns an empty
 * array when they agree. Presence/absence and protection-vs-exploitable
 * conflicts are surfaced here; purely semantic conflicts remain for the
 * third-AI arbiter (stage 7).
 */
export function detectDisputes(a: NormalizedFinding, b: NormalizedFinding): string[] {
  const reasons: string[] = [];

  const gap = Math.abs(severityIndex(a.severity) - severityIndex(b.severity));
  if (gap >= 2) {
    reasons.push(`severity differs by ${gap} levels (${a.severity} vs ${b.severity})`);
  }

  if (
    a.rootCause !== null &&
    a.rootCause.trim() !== "" &&
    b.rootCause !== null &&
    b.rootCause.trim() !== "" &&
    tokenJaccard(a.rootCause, b.rootCause) === 0
  ) {
    reasons.push("root causes are mutually exclusive");
  }

  if (
    a.suggestedFix !== null &&
    a.suggestedFix.trim() !== "" &&
    b.suggestedFix !== null &&
    b.suggestedFix.trim() !== "" &&
    tokenJaccard(a.suggestedFix, b.suggestedFix) === 0
  ) {
    reasons.push("suggested fixes are mutually exclusive");
  }

  if (looksLikeProtectionClaim(a) !== looksLikeProtectionClaim(b)) {
    reasons.push("one report claims the issue is already protected, the other claims it is not");
  }

  return reasons;
}
