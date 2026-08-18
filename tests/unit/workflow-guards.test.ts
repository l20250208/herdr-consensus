import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "../../src/state/run.js";
import {
  WorkflowPreconditionError,
  requireArtifacts,
  requireRunStage,
} from "../../src/workflow/guards.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function runAt(stage: RunRecord["stage"]): RunRecord {
  return {
    schemaVersion: 1,
    runId: "run-guard",
    projectPath: "/tmp/project",
    projectHash: "hash",
    stage,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    events: [],
  };
}

describe("workflow guards", () => {
  it("rejects a command at the wrong stage with the accepted stage", () => {
    expect(() => requireRunStage(runAt("reviewing"), ["consensus"], "validate"))
      .toThrow(/validate requires stage consensus; current stage is reviewing/i);
  });

  it("accepts an explicitly allowed stage", () => {
    expect(() => requireRunStage(runAt("consensus"), ["consensus"], "validate"))
      .not.toThrow();
  });

  it("reports every missing artifact without modifying existing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "herdr-guards-"));
    roots.push(root);
    const present = join(root, "present.json");
    const missing = join(root, "missing.json");
    await writeFile(present, "{}", "utf8");

    await expect(requireArtifacts([present, missing], "lock")).rejects.toEqual(
      expect.objectContaining<Partial<WorkflowPreconditionError>>({
        message: expect.stringContaining("missing.json"),
      }),
    );
  });
});
