import { DEFAULT_MARKERS } from "./contract.js";
import {
  extractReportJson,
  parseReviewReport,
  type ReviewReportV1,
} from "./extract.js";

export const MAX_REPORT_BYTES = 2 * 1024 * 1024;

export type ParseReportContentResult =
  | { ok: true; report: ReviewReportV1 }
  | { ok: false; error: string };

export function sanitizeReportContent(content: string): {
  content: string;
  rejected: boolean;
  reason: string | null;
} {
  if (Buffer.byteLength(content, "utf8") > MAX_REPORT_BYTES) {
    return {
      content: "",
      rejected: true,
      reason: "report exceeds the 2 MiB limit",
    };
  }

  return {
    content: content.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ""),
    rejected: false,
    reason: null,
  };
}

function parseCandidate(jsonText: string): ParseReportContentResult {
  const parsed = parseReviewReport(jsonText);
  return parsed.ok ? parsed : { ok: false, error: parsed.error };
}

export function parseReportContent(content: string): ParseReportContentResult {
  const sanitized = sanitizeReportContent(content);
  if (sanitized.rejected) {
    return {
      ok: false,
      error: sanitized.reason ?? "report content was rejected",
    };
  }

  const safeContent = sanitized.content;
  const marked = extractReportJson(safeContent, DEFAULT_MARKERS);
  if (marked !== null) return parseCandidate(marked);

  const trimmed = safeContent.trim();
  if (trimmed.startsWith("{")) return parseCandidate(trimmed);

  const fenced = [...safeContent.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (fenced.length === 1) {
    const jsonText = fenced[0]?.[1];
    if (jsonText !== undefined) return parseCandidate(jsonText.trim());
  }

  return {
    ok: false,
    error: "unsupported report content; supported formats are marked JSON, a whole JSON object, or one fenced json block",
  };
}
