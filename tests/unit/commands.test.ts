import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type CliDeps } from "../../src/cli.js";
import { RunStore } from "../../src/state/store.js";
import type { Runner } from "../../src/spawn.js";

const tmpRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-consensus-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const unusedRun: Runner = async () => {
  throw new Error("runner should not be called for status/resume");
};

function makeDeps(stateDir: string): { deps: CliDeps; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  const deps: CliDeps = {
    run: unusedRun,
    stateDir,
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
  };
  return { deps, out: () => out, err: () => err };
}

describe("status command", () => {
  it("reports no runs when the store is empty", async () => {
    const { deps, out } = makeDeps(await tempRoot());
    const code = await main(["status"], deps);
    expect(code).toBe(0);
    expect(out()).toContain("No runs");
  });

  it("reports a run's status", async () => {
    const root = await tempRoot();
    await new RunStore(root).createRun({ runId: "run-1", projectPath: "/tmp/repo" });
    const { deps, out } = makeDeps(root);
    const code = await main(["status", "run-1"], deps);
    expect(code).toBe(0);
    expect(out()).toContain("run-1");
    expect(out()).toContain("created");
  });

  it("exits 1 for a missing run", async () => {
    const { deps, err } = makeDeps(await tempRoot());
    const code = await main(["status", "nope"], deps);
    expect(code).toBe(1);
    expect(err()).toContain("nope");
  });
});

describe("resume command", () => {
  it("prints the stage to resume from", async () => {
    const root = await tempRoot();
    await new RunStore(root).createRun({ runId: "run-1", projectPath: "/tmp/repo" });
    const { deps, out } = makeDeps(root);
    const code = await main(["resume", "run-1"], deps);
    expect(code).toBe(0);
    expect(out()).toContain("run-1");
    expect(out()).toContain("created");
  });

  it("exits 2 when no run id is given", async () => {
    const { deps, err } = makeDeps(await tempRoot());
    const code = await main(["resume"], deps);
    expect(code).toBe(2);
    expect(err()).toContain("run");
  });
});
