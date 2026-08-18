import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type CliDeps } from "../../src/cli.js";
import { RunStore } from "../../src/state/store.js";

const roots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function reviewingFixture(): Promise<{
  runId: string;
  deps: CliDeps;
  stderr: () => string;
}> {
  const state = await tempRoot("herdr-cli-guards-state-");
  const project = await tempRoot("herdr-cli-guards-project-");
  const store = new RunStore(state);
  const run = await store.createRun({ runId: "run-guard", projectPath: project });
  await store.transition(run.runId, "reviewing");
  let err = "";
  return {
    runId: run.runId,
    deps: {
      stateDir: state,
      run: async () => {
        throw new Error("external runner must not execute before workflow guards");
      },
      stdout: () => {},
      stderr: (text) => {
        err += text;
      },
    },
    stderr: () => err,
  };
}

describe("CLI workflow guards", () => {
  it.each([
    ["validate", (runId: string) => ["validate", runId]],
    ["arbitrate", (runId: string) => ["arbitrate", runId, "--agent", "gemini"]],
    ["decide", (runId: string) => ["decide", runId]],
    ["lock", (runId: string) => ["lock", runId]],
    ["apply", (runId: string) => ["apply", runId, "--agent", "codex"]],
    ["report", (runId: string) => ["report", runId]],
  ])("rejects %s before reading later-stage artifacts", async (command, argv) => {
    const fixture = await reviewingFixture();

    const code = await main(argv(fixture.runId), fixture.deps);

    expect(code).toBe(1);
    expect(fixture.stderr()).toMatch(new RegExp(`${command} requires stage`, "i"));
  });
});
