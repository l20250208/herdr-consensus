import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeArtifact } from "../../src/reports/artifact.js";
import { runDir } from "../../src/state/paths.js";
import { RunStore } from "../../src/state/store.js";
import { processReview } from "../../src/workflow/process-review.js";

const roots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function report(title: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    findings: [{
      title,
      category: "correctness",
      severity: "P1",
      location: { path: "src/a.ts", startLine: 4, endLine: 6, symbol: "run" },
      rootCause: "unchecked result",
      impact: "request fails",
      evidence: ["return value ignored"],
      reproduction: ["pnpm test"],
      suggestedFix: "check result",
    }],
  });
}

describe("processReview", () => {
  it("writes normalized findings and consensus while preserving slot independence", async () => {
    const state = await tempRoot("herdr-process-state-");
    const project = await tempRoot("herdr-process-project-");
    const store = new RunStore(state);
    const created = await store.createRun({ runId: "run-process", projectPath: project });
    const reviewing = await store.transition(created.runId, "reviewing");
    const dir = runDir(state, reviewing.projectHash, reviewing.runId);
    const artifacts = {
      a: makeArtifact({ sourceId: "import", agentKind: "import", content: report("Unchecked result") }),
      b: makeArtifact({ sourceId: "import", agentKind: "import", content: report("Unchecked result") }),
    };

    const result = await processReview({ run: reviewing, runDir: dir, artifacts }, store);

    expect(result.findings.map((finding) => finding.sourceId)).toEqual(["agent_a", "agent_b"]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ relation: "common", status: "common_confirmed" });
    expect((await store.findRunById(reviewing.runId))?.stage).toBe("consensus");
    expect(JSON.parse(await readFile(join(dir, "normalized", "findings.json"), "utf8")))
      .toEqual(result.findings);
    expect(JSON.parse(await readFile(join(dir, "consensus.json"), "utf8")))
      .toEqual({ items: result.items });
  });

  it("fails closed before transitioning when either report is unstructured", async () => {
    const state = await tempRoot("herdr-process-state-");
    const project = await tempRoot("herdr-process-project-");
    const store = new RunStore(state);
    const created = await store.createRun({ runId: "run-invalid", projectPath: project });
    const reviewing = await store.transition(created.runId, "reviewing");
    const dir = runDir(state, reviewing.projectHash, reviewing.runId);
    const artifacts = {
      a: makeArtifact({ sourceId: "import", agentKind: "import", content: report("Valid") }),
      b: makeArtifact({ sourceId: "import", agentKind: "import", content: "plain prose" }),
    };

    await expect(processReview({ run: reviewing, runDir: dir, artifacts }, store))
      .rejects.toThrow(/report B.*supported formats/i);
    expect((await store.findRunById(reviewing.runId))?.stage).toBe("reviewing");
  });
});
