import { describe, expect, it } from "vitest";
import { buildUnifiedReport, collectGitDiffSummary, renderUnifiedReportMarkdown, runRegression } from "../../src/reporting/generate.js";
import type { RunRecord } from "../../src/state/run.js";
import type { Runner } from "../../src/spawn.js";
import { UnifiedReportSchema } from "../../src/reporting/schema.js";

const runRecord: RunRecord = { schemaVersion: 1, runId: "r", projectPath: "/repo", projectHash: "h", stage: "applying", createdAt: "c", updatedAt: "u", events: [] };

describe("reporting", () => {
  it("renders markdown with traceable sections", () => {
    const metadata = { reviewAgentKinds: ["codex", "claude"], agentKind: "gemini", model: null, provider: null, independence: "strong" };
    const report = buildUnifiedReport({
      run: runRecord,
      consensus: { items: [] },
      validations: [],
      arbitration: [],
      arbitrationMetadata: metadata,
      decisions: [],
      fixPlan: { runId: "r", version: 1, items: [], createdAt: "now", sha256: "hash" },
      gitDiffSummary: "a.ts | 1 +",
      changedPaths: ["a.ts"],
      pathPolicy: { ok: true, violations: [] },
      targetedChecks: [],
      regression: { argv: ["npm", "test"], approvedByUser: true, startedAt: "s", finishedAt: "f", exitCode: 0, stdout: "ok", stderr: "", workspaceSnapshotSha256: "a".repeat(64) },
      generatedAt: "2026-08-18T00:00:00.000Z",
    });
    const md = renderUnifiedReportMarkdown(report);
    expect(md).toContain("Herdr Consensus Final Report");
    expect(md).toContain("Git Diff Summary");
    expect(report.arbitrationMetadata).toEqual(metadata);
    expect(md).toContain("Arbitration Metadata");
    expect(report.schemaVersion).toBe(1);
    expect(UnifiedReportSchema.safeParse(report).success).toBe(true);
  });

  it("collects diff and regression output", async () => {
    const runner: Runner = async (argv) => argv[1] === "diff" ? { ok: true, code: 0, stdout: "x | 1 +", stderr: "" } : { ok: true, code: 0, stdout: "ok", stderr: "" };
    expect(await collectGitDiffSummary("/wt", runner, "base123")).toBe("x | 1 +");
    expect((await runRegression({ worktreePath: "/wt", argv: ["npm", "test"], run: runner, approvedByUser: true })).exitCode).toBe(0);
  });
});
