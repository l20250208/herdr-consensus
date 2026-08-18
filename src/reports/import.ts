import { makeArtifact, type RawReportArtifact } from "./artifact.js";
import type { Slot } from "./collector.js";

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
  return {
    a: makeArtifact({ sourceId: "import", agentKind: "import", content: input.a, capturedAt }),
    b: makeArtifact({ sourceId: "import", agentKind: "import", content: input.b, capturedAt }),
  };
}
