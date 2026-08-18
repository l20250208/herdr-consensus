import { DEFAULT_MARKERS, type ContractMarkers } from "./contract.js";

export interface ReviewReportV1 {
  schemaVersion: number;
  findings: unknown[];
}

/** Extracts the JSON text between the markers, or `null` if markers are missing. */
export function extractReportJson(content: string, markers: ContractMarkers): string | null {
  const startIndex = content.indexOf(markers.start);
  if (startIndex < 0) return null;
  const contentStart = startIndex + markers.start.length;
  const endIndex = content.indexOf(markers.end, contentStart);
  if (endIndex < 0) return null;
  return content.slice(contentStart, endIndex).trim();
}

/**
 * Lightweight validation of the review report envelope: valid JSON, a numeric
 * `schemaVersion`, and a `findings` array. Full finding normalization happens
 * in the report normalizer (stage 5).
 */
export function parseReviewReport(
  jsonText: string,
): { ok: true; report: ReviewReportV1 } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `JSON parse error: ${detail}` };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "report must be a JSON object" };
  }
  const findings = (parsed as { findings?: unknown }).findings;
  if (!Array.isArray(findings)) {
    return { ok: false, error: 'report must contain a "findings" array' };
  }
  const schemaVersion = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (typeof schemaVersion !== "number") {
    return { ok: false, error: 'report must declare a numeric "schemaVersion"' };
  }
  return { ok: true, report: { schemaVersion, findings } };
}

export function buildRepairPrompt(parseError: string, markers: ContractMarkers = DEFAULT_MARKERS): string {
  return [
    `Your previous report could not be parsed as valid JSON (${parseError}).`,
    "Re-emit the full report as a single JSON object between the SAME markers, with no prose outside the markers.",
    'Fix the syntax and confirm the top-level object has a numeric "schemaVersion" and an array "findings".',
    "",
    markers.start,
    "",
    markers.end,
  ].join("\n");
}
