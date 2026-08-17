import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStore } from "../../src/state/store.js";
import { projectHash } from "../../src/state/paths.js";

const tmpRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-consensus-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("RunStore", () => {
  it("creates a run and idempotently re-returns it on repeat", async () => {
    const store = new RunStore(await tempRoot());
    const first = await store.createRun({ runId: "run-1", projectPath: "/tmp/repo" });
    expect(first.stage).toBe("created");
    expect(first.events).toHaveLength(1);
    expect(first.events[0]?.type).toBe("created");

    const second = await store.createRun({ runId: "run-1", projectPath: "/tmp/repo" });
    expect(second).toEqual(first);
    expect(second.events).toHaveLength(1);
  });

  it("transitions forward and appends an audit event", async () => {
    const store = new RunStore(await tempRoot());
    await store.createRun({ runId: "run-1", projectPath: "/tmp/repo" });
    const run = await store.transition("run-1", "reviewing", { note: "x" });

    expect(run.stage).toBe("reviewing");
    expect(run.events).toHaveLength(2);
    expect(run.events[1]?.type).toBe("transition");
    expect(run.events[1]?.from).toBe("created");
    expect(run.events[1]?.to).toBe("reviewing");
    expect(run.events[1]?.detail).toEqual({ note: "x" });
    expect(run.updatedAt).not.toBe(run.createdAt);
  });

  it("is idempotent when transitioning to the current stage", async () => {
    const store = new RunStore(await tempRoot());
    await store.createRun({ runId: "run-1", projectPath: "/tmp/repo" });
    await store.transition("run-1", "reviewing");

    const again = await store.transition("run-1", "reviewing");
    expect(again.stage).toBe("reviewing");
    expect(again.events).toHaveLength(2);
  });

  it("rejects a backward transition", async () => {
    const store = new RunStore(await tempRoot());
    await store.createRun({ runId: "run-1", projectPath: "/tmp/repo" });
    await store.transition("run-1", "reviewing");

    await expect(store.transition("run-1", "created")).rejects.toThrow(/backwards/);
  });

  it("recovers after a simulated crash (stale temp file)", async () => {
    const root = await tempRoot();
    const store = new RunStore(root);
    await store.createRun({ runId: "run-1", projectPath: "/tmp/repo" });
    await store.transition("run-1", "reviewing");

    const runPath = join(root, "projects", projectHash("/tmp/repo"), "runs", "run-1");
    await writeFile(join(runPath, ".run.json.tmp"), "{ partial");

    const run = await store.findRunById("run-1");
    expect(run?.stage).toBe("reviewing");
    expect(run?.events).toHaveLength(2);

    await store.transition("run-1", "normalized");
    const after = await store.findRunById("run-1");
    expect(after?.stage).toBe("normalized");
    expect(after?.events).toHaveLength(3);
  });

  it("surfaces a clear error on a corrupt run.json", async () => {
    const root = await tempRoot();
    const store = new RunStore(root);
    await store.createRun({ runId: "run-1", projectPath: "/tmp/repo" });

    const runPath = join(root, "projects", projectHash("/tmp/repo"), "runs", "run-1");
    await writeFile(join(runPath, "run.json"), "{ not json");

    await expect(store.findRunById("run-1")).rejects.toThrow();
  });

  it("lists runs across projects and finds by id", async () => {
    const store = new RunStore(await tempRoot());
    await store.createRun({ runId: "run-a", projectPath: "/tmp/a" });
    await store.createRun({ runId: "run-b", projectPath: "/tmp/b" });

    const runs = await store.listRuns();
    expect(runs.map((run) => run.runId).sort()).toEqual(["run-a", "run-b"]);

    const found = await store.findRunById("run-b");
    expect(found?.projectPath).toBe("/tmp/b");
    expect(await store.findRunById("missing")).toBeNull();
  });
});
