import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeArtifact } from "../../src/reports/artifact.js";
import { saveRawReports } from "../../src/reports/storage.js";
import { runDir } from "../../src/state/paths.js";
import { RunStore } from "../../src/state/store.js";
import { resumeRun } from "../../src/workflow/resume.js";

const roots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const emptyReport = JSON.stringify({ schemaVersion: 1, findings: [] });

async function reviewingFixture(complete: boolean): Promise<{
  store: RunStore;
  runId: string;
  stateRoot: string;
}> {
  const stateRoot = await tempRoot("herdr-resume-state-");
  const project = await tempRoot("herdr-resume-project-");
  const store = new RunStore(stateRoot);
  const created = await store.createRun({ runId: complete ? "run-complete" : "run-partial", projectPath: project });
  const run = await store.transition(created.runId, "reviewing");
  await saveRawReports(runDir(stateRoot, run.projectHash, run.runId), {
    a: makeArtifact({ sourceId: "agent_a", agentKind: "claude", content: emptyReport }),
    b: complete ? makeArtifact({ sourceId: "agent_b", agentKind: "codex", content: emptyReport }) : null,
  });
  return { store, runId: run.runId, stateRoot };
}

describe("resumeRun", () => {
  it("resumes complete raw artifacts from reviewing to consensus", async () => {
    const fixture = await reviewingFixture(true);

    const result = await resumeRun(fixture.runId, fixture.stateRoot, fixture.store);

    expect(result).toEqual({ stage: "consensus", nextCommand: `validate ${fixture.runId}` });
    expect((await fixture.store.findRunById(fixture.runId))?.stage).toBe("consensus");
  });

  it("does not restart agents when a raw artifact is missing", async () => {
    const fixture = await reviewingFixture(false);

    await expect(resumeRun(fixture.runId, fixture.stateRoot, fixture.store))
      .rejects.toThrow(/cannot resume.*missing raw.*B/i);
    expect((await fixture.store.findRunById(fixture.runId))?.stage).toBe("reviewing");
  });

  it("leaves approval-bearing stages unchanged and recommends the next command", async () => {
    const fixture = await reviewingFixture(true);
    await resumeRun(fixture.runId, fixture.stateRoot, fixture.store);

    const result = await resumeRun(fixture.runId, fixture.stateRoot, fixture.store);

    expect(result).toEqual({ stage: "consensus", nextCommand: `validate ${fixture.runId}` });
  });
});
