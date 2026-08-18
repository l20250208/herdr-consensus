import { makeArtifact, type RawReportArtifact } from "./artifact.js";
import type { Slot } from "./collector.js";
import { sanitizeReportContent } from "./content.js";

/**
 * Wraps two externally-provided reports (Markdown, plain text, or JSON) as
 * import-sourced raw artifacts. Normalization and source-marking follow in the
 * report normalizer; no trust is assumed here.
 */
export function importReports(input: {
  a: string;
  b: string;
  capturedAt?: string;
}): Record<Slot, RawReportArtifact> {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const a = sanitizeReportContent(input.a);
  const b = sanitizeReportContent(input.b);
  if (a.rejected) throw new Error(`report A rejected: ${a.reason ?? "invalid report"}`);
  if (b.rejected) throw new Error(`report B rejected: ${b.reason ?? "invalid report"}`);
  return {
    a: makeArtifact({ sourceId: "import", agentKind: "import", content: a.content, capturedAt }),
    b: makeArtifact({ sourceId: "import", agentKind: "import", content: b.content, capturedAt }),
  };
}
