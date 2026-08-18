import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type CliDeps } from "../../src/cli.js";
import { RunStore } from "../../src/state/store.js";
import { runDir } from "../../src/state/paths.js";
import type { Runner } from "../../src/spawn.js";

const tmpRoots: string[] = [];
async function tempRoot(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), "herdr-cli-validation-")); tmpRoots.push(dir); return dir; }
afterEach(async () => { await Promise.all(tmpRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

function deps(stateDir: string, run: Runner): { deps: CliDeps; out: () => string; err: () => string } {
  let out = ""; let err = "";
  return { deps: { stateDir, run, stdout: (s) => { out += s; }, stderr: (s) => { err += s; } }, out: () => out, err: () => err };
}

async function createRunWithConsensus(root: string): Promise<string> {
  const project = await tempRoot();
  await writeFile(join(project, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }), "utf8");
  const store = new RunStore(root);
  const run = await store.createRun({ runId: "run-val", projectPath: project });
  await store.transition(run.runId, "reviewing");
  await store.transition(run.runId, "normalized");
  await store.transition(run.runId, "consensus");
  const dir = runDir(root, run.projectHash, run.runId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "consensus.json"), JSON.stringify({ items: [{ itemId: "i1", findingIds: ["f1"], relation: "single_source", matchScore: null, severity: "P2", evidenceTier: "agent_asserted", disagreementReasons: [], status: "needs_validation" }] }), "utf8");
  return run.runId;
}

describe("validate command", () => {
  it("prints a plan unless explicitly approved", async () => {
    const root = await tempRoot();
    const runId = await createRunWithConsensus(root);
    const d = deps(root, async () => { throw new Error("should not execute"); });
    const code = await main(["validate", runId], d.deps);
    expect(code).toBe(0);
    expect(d.out()).toContain("Re-run with --approve");
  });

  it("executes approved validation and writes records", async () => {
    const root = await tempRoot();
    const runId = await createRunWithConsensus(root);
    const d = deps(root, async () => ({ ok: true, code: 0, stdout: "ok", stderr: "" }));
    const code = await main(["validate", runId, "--approve"], d.deps);
    expect(code).toBe(0);
    const store = new RunStore(root);
    const run = (await store.findRunById(runId))!;
    expect(run.stage).toBe("validating");
    const records = await readFile(join(runDir(root, run.projectHash, run.runId), "validations", "records.json"), "utf8");
    expect(records).toContain("validated_false");
    const consensus = JSON.parse(await readFile(join(runDir(root, run.projectHash, run.runId), "consensus.json"), "utf8")) as { items: Array<{ status: string }> };
    expect(consensus.items[0]?.status).toBe("validated_false");
  });

  it("records nonzero validation as inconclusive and permits a later validation loop", async () => {
    const root = await tempRoot();
    const runId = await createRunWithConsensus(root);
    const first = deps(root, async () => ({ ok: true, code: 1, stdout: "failure", stderr: "" }));
    expect(await main(["validate", runId, "--approve"], first.deps)).toBe(0);
    const run = (await new RunStore(root).findRunById(runId))!;
    const consensusPath = join(runDir(root, run.projectHash, run.runId), "consensus.json");
    expect((JSON.parse(await readFile(consensusPath, "utf8")) as { items: Array<{ status: string }> }).items[0]?.status).toBe("inconclusive");
    await new RunStore(root).transition(runId, "arbitrating");
    const second = deps(root, async () => ({ ok: true, code: 0, stdout: "ok", stderr: "" }));
    expect(await main(["validate", runId, "--approve"], second.deps)).toBe(0);
    expect((JSON.parse(await readFile(consensusPath, "utf8")) as { items: Array<{ status: string }> }).items[0]?.status).toBe("validated_false");
    const records = JSON.parse(await readFile(join(runDir(root, run.projectHash, run.runId), "validations", "records.json"), "utf8")) as Array<{ validationId: string }>;
    expect(records).toHaveLength(2);
    expect(new Set(records.map((record) => record.validationId)).size).toBe(2);
  });
});
