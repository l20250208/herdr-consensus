import { describe, expect, it } from "vitest";
import { DEFAULT_MARKERS } from "../../src/reports/contract.js";
import { parseReportContent, sanitizeReportContent } from "../../src/reports/content.js";

const reportJson = JSON.stringify({ schemaVersion: 1, findings: [] });

describe("report content parsing", () => {
  it.each([
    ["whole JSON", reportJson],
    ["fenced JSON", `review follows\n\n\`\`\`json\n${reportJson}\n\`\`\``],
    ["marked JSON", `${DEFAULT_MARKERS.start}\n${reportJson}\n${DEFAULT_MARKERS.end}`],
  ])("parses %s without inventing fields", (_label, content) => {
    expect(parseReportContent(content)).toEqual({
      ok: true,
      report: { schemaVersion: 1, findings: [] },
    });
  });

  it("rejects unstructured text with supported-format guidance", () => {
    const result = parseReportContent("looks fine to me");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/supported formats/i);
  });

  it("removes terminal controls but preserves line and tab structure", () => {
    expect(sanitizeReportContent("a\u001b[31m\tb\nc")).toEqual({
      content: "a[31m\tb\nc",
      rejected: false,
      reason: null,
    });
  });

  it("rejects reports larger than 2 MiB", () => {
    const result = sanitizeReportContent("x".repeat(2 * 1024 * 1024 + 1));

    expect(result.rejected).toBe(true);
    expect(result.reason).toMatch(/2 MiB/i);
  });

  it("enforces the size limit through the public parser", () => {
    const result = parseReportContent("x".repeat(2 * 1024 * 1024 + 1));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/2 MiB/i);
  });
});
