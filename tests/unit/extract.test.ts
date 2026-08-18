import { describe, expect, it } from "vitest";
import {
  buildRepairPrompt,
  extractReportJson,
  parseReviewReport,
} from "../../src/reports/extract.js";
import { DEFAULT_MARKERS } from "../../src/reports/contract.js";

function wrap(jsonText: string): string {
  return `some preamble\n${DEFAULT_MARKERS.start}\n${jsonText}\n${DEFAULT_MARKERS.end}\ntrailing text`;
}

describe("extractReportJson", () => {
  it("extracts JSON between markers", () => {
    expect(extractReportJson(wrap('{"findings":[]}'), DEFAULT_MARKERS)).toBe('{"findings":[]}');
  });

  it("returns null when the start marker is missing", () => {
    expect(extractReportJson('{"findings":[]}', DEFAULT_MARKERS)).toBeNull();
  });

  it("returns null when the end marker is missing", () => {
    const text = `${DEFAULT_MARKERS.start}\n{"findings":[]}`;
    expect(extractReportJson(text, DEFAULT_MARKERS)).toBeNull();
  });
});

describe("parseReviewReport", () => {
  it("accepts a report with a numeric schemaVersion and findings array", () => {
    const result = parseReviewReport('{"schemaVersion":1,"findings":[{"title":"x"}]}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.schemaVersion).toBe(1);
      expect(result.report.findings).toHaveLength(1);
    }
  });

  it("rejects malformed JSON", () => {
    const result = parseReviewReport("{ not valid");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JSON/);
  });

  it("rejects a report without a findings array", () => {
    const result = parseReviewReport('{"schemaVersion":1}');
    expect(result.ok).toBe(false);
  });

  it("rejects a report without a numeric schemaVersion", () => {
    const result = parseReviewReport('{"findings":[]}');
    expect(result.ok).toBe(false);
  });
});

describe("buildRepairPrompt", () => {
  it("references the parse error and asks to re-emit between markers", () => {
    const prompt = buildRepairPrompt("JSON parse error");
    expect(prompt).toContain("JSON parse error");
    expect(prompt).toContain(DEFAULT_MARKERS.start);
  });
});
