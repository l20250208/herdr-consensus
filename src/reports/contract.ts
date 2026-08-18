export const CONTRACT_VERSION = 1;

export interface ContractMarkers {
  start: string;
  end: string;
}

export const DEFAULT_MARKERS: ContractMarkers = {
  start: "===HERDR_CONSENSUS_REPORT_JSON_START===",
  end: "===HERDR_CONSENSUS_REPORT_JSON_END===",
};

/**
 * Builds the versioned, read-only review contract sent to each reviewer. The
 * same text is used for both agents; it never names the other reviewer.
 */
export function buildReviewContract(input: {
  projectPath: string;
  markers?: ContractMarkers;
}): string {
  const markers = input.markers ?? DEFAULT_MARKERS;
  return [
    "You are performing a READ-ONLY security and correctness review of a codebase.",
    "",
    `Project: ${input.projectPath}`,
    "",
    "Rules:",
    "- Do NOT modify, create, or delete files in the reviewed project. Project review is read-only.",
    "- You may use read-only inspection commands, but do NOT execute the project's code, scripts, or tests.",
    "- The only allowed write is the final JSON report to the exact path in HERDR_CONSENSUS_OUTPUT.",
    "- Your artifact working directory is not the reviewed project; inspect the absolute Project path above.",
    "- Review the project as a whole; report concrete, actionable findings.",
    "",
    "Output format:",
    "- Emit your findings as a single JSON object between the two markers below, and nothing else between them.",
    `- The JSON object must have a numeric "schemaVersion" (use ${CONTRACT_VERSION}) and an array "findings".`,
    '- Each finding in "findings" must include at least: title, category, severity, location (with optional path/startLine/endLine/symbol), rootCause, impact, evidence (array of strings), and reproduction (array of strings).',
    "- Keep every JSON string value at or below 100 characters; split supporting detail into multiple array entries.",
    "- Also write the same JSON object, without markers or prose, to HERDR_CONSENSUS_OUTPUT.",
    '- If you find nothing, return an empty "findings" array.',
    "",
    markers.start,
    "",
    markers.end,
  ].join("\n");
}
