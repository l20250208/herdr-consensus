import { DEFAULT_MARKERS, type ContractMarkers } from "./contract.js";

export interface ReviewReportV1 {
  schemaVersion: number;
  findings: unknown[];
}

function normalizeTerminalWrapsInJsonStrings(jsonText: string): string {
  let normalized = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < jsonText.length; index++) {
    const character = jsonText[index];
    if (character === undefined) break;

    if (inString && (character === "\n" || character === "\r")) {
      if (character === "\r" && jsonText[index + 1] === "\n") index++;
      while (jsonText[index + 1] === " " || jsonText[index + 1] === "\t") index++;
      const previous = normalized.at(-1);
      const next = jsonText[index + 1];
      if (!escaped && previous !== undefined && next !== undefined && !/\s/.test(previous) && !/\s/.test(next)) {
        normalized += " ";
      }
      continue;
    }

    normalized += character;
    if (!inString) {
      if (character === '"') inString = true;
      continue;
    }
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      inString = false;
    }
  }

  return normalized;
}

/** Extracts the JSON text between the markers, or `null` if markers are missing. */
export function extractReportJson(content: string, markers: ContractMarkers): string | null {
  const startIndex = content.lastIndexOf(markers.start);
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
    parsed = JSON.parse(normalizeTerminalWrapsInJsonStrings(jsonText)) as unknown;
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
    "Keep every JSON string value at or below 100 characters; split supporting detail into multiple array entries.",
    "Overwrite HERDR_CONSENSUS_OUTPUT with the same corrected JSON object, without markers or prose.",
    "",
    markers.start,
    "",
    markers.end,
  ].join("\n");
}
