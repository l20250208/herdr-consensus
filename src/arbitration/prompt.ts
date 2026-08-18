import type { ConsensusItem, NormalizedFinding } from "../consensus/types.js";

export const ARBITRATION_MARKERS = {
  start: "<<<HERDR_CONSENSUS_ARBITRATION_JSON_START>>>",
  end: "<<<HERDR_CONSENSUS_ARBITRATION_JSON_END>>>",
} as const;

export function buildArbitrationPrompt(input: {
  item: ConsensusItem;
  findings: readonly NormalizedFinding[];
  validations: unknown[];
}): string {
  return [
    "You are a read-only third AI arbiter for Herdr Consensus.",
    "Do not modify files, run commands, or decide for the user. Provide advisory JSON only.",
    "Assess whether the item should be fixed, deferred, rejected, or validated more.",
    "Use only the supplied findings and validation records as evidence.",
    "Return exactly one JSON object between the markers with:",
    '{ "itemId": string, "recommendation": "fix|defer|reject|validate_more", "rationale": string, "evidenceRefs": string[], "confidence": "low|medium|high", "missingValidation": string[] }',
    "",
    "CONSENSUS_ITEM:",
    JSON.stringify(input.item, null, 2),
    "",
    "NORMALIZED_FINDINGS:",
    JSON.stringify(input.findings, null, 2),
    "",
    "VALIDATION_RECORDS:",
    JSON.stringify(input.validations, null, 2),
    "",
    ARBITRATION_MARKERS.start,
    "",
    ARBITRATION_MARKERS.end,
  ].join("\n");
}
