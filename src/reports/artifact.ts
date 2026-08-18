import { createHash } from "node:crypto";

export type ReportSourceId = "agent_a" | "agent_b" | "third_ai" | "import";

export interface RawReportArtifact {
  sourceId: ReportSourceId;
  agentKind: string;
  model: string | null;
  capturedAt: string;
  content: string;
  sha256: string;
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function makeArtifact(input: {
  sourceId: ReportSourceId;
  agentKind: string;
  content: string;
  model?: string | null;
  capturedAt?: string;
}): RawReportArtifact {
  return {
    sourceId: input.sourceId,
    agentKind: input.agentKind,
    model: input.model ?? null,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    content: input.content,
    sha256: sha256Hex(input.content),
  };
}
