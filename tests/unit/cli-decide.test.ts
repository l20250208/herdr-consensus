import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type CliDeps } from "../../src/cli.js";
import { RunStore } from "../../src/state/store.js";
import { runDir } from "../../src/state/paths.js";
import type { PromptAdapter } from "../../src/ui/prompts.js";

const tmpRoots: string[] = [];
async function tempRoot(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), "herdr-cli-decide-")); tmpRoots.push(dir); return dir; }
afterEach(async () => { await Promise.all(tmpRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function createRun(root: string): Promise<string> {
  const project = await tempRoot();
  const store = new RunStore(root);
  const run = await store.createRun({ runId: "run-dec", projectPath: project });
  await store.transition(run.runId, "reviewing");
  await store.transition(run.runId, "normalized");
  await store.transition(run.runId, "consensus");
  await store.transition(run.runId, "validating");
  await store.transition(run.runId, "arbitrating");
  const dir = runDir(root, run.projectHash, run.runId);
  await mkdir(join(dir, "normalized"), { recursive: true });
  await mkdir(join(dir, "validations"), { recursive: true });
  await mkdir(join(dir, "arbitration"), { recursive: true });
  await writeFile(join(dir, "consensus.json"), JSON.stringify({ items: [{ itemId: "i1", findingIds: ["f1"], relation: "single_source", matchScore: null, severity: "P2", evidenceTier: "agent_asserted", disagreementReasons: [], status: "needs_validation" }] }), "utf8");
  await writeFile(join(dir, "normalized", "findings.json"), JSON.stringify([{ findingId: "f1", sourceId: "agent_a", originalSeverity: "medium", severity: "P2", title: "bug", category: "bug", location: null, rootCause: null, impact: "impact", evidence: ["e"], evidenceTier: "agent_asserted", reproduction: [], suggestedFix: null, needsRuntimeValidation: true, rawArtifactSha256: "x" }]), "utf8");
  await writeFile(join(dir, "validations", "records.json"), "[]", "utf8");
  await writeFile(join(dir, "arbitration", "advice.json"), "[]", "utf8");
  return run.runId;
}

function deps(root: string): { deps: CliDeps; out: () => string; err: () => string } {
  let out = ""; let err = "";
  return { deps: { stateDir: root, run: async () => { throw new Error("unused"); }, stdout: (s) => { out += s; }, stderr: (s) => { err += s; } }, out: () => out, err: () => err };
}

describe("decide command", () => {
  it("lists pending items without mutating decisions", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    const d = deps(root);
    const code = await main(["decide", runId], d.deps);
    expect(code).toBe(0);
    expect(d.out()).toContain("pending");
  });

  it("records decisions with evidence snapshot hashes", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    const d = deps(root);
    const code = await main(["decide", runId, "--item", "i1", "--decision", "approved_fix", "--reason", "confirmed"], d.deps);
    expect(code).toBe(0);
    const store = new RunStore(root);
    const run = (await store.findRunById(runId))!;
    expect(run.stage).toBe("deciding");
    const decisions = await readFile(join(runDir(root, run.projectHash, run.runId), "decisions.json"), "utf8");
    expect(decisions).toContain("approved_fix");
    expect(decisions).toContain("evidenceSnapshotSha256");
  });

  it("keeps validate_more retryable and accepts a later terminal decision", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    const d = deps(root);
    expect(await main(["decide", runId, "--item", "i1", "--decision", "validate_more"], d.deps)).toBe(0);
    expect((await new RunStore(root).findRunById(runId))?.stage).toBe("arbitrating");
    expect(await main(["decide", runId, "--item", "i1", "--decision", "rejected"], d.deps)).toBe(0);
    expect((await new RunStore(root).findRunById(runId))?.stage).toBe("deciding");
  });

  it("accepts terminal decisions for remaining items after entering deciding", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    const run = (await new RunStore(root).findRunById(runId))!;
    const dir = runDir(root, run.projectHash, run.runId);
    const consensus = JSON.parse(await readFile(join(dir, "consensus.json"), "utf8")) as { items: unknown[] };
    consensus.items.push({ itemId: "i2", findingIds: ["f2"], relation: "single_source", matchScore: null, severity: "P3", evidenceTier: "agent_asserted", disagreementReasons: [], status: "single_source" });
    await writeFile(join(dir, "consensus.json"), JSON.stringify(consensus), "utf8");
    const findings = JSON.parse(await readFile(join(dir, "normalized", "findings.json"), "utf8")) as unknown[];
    findings.push({ findingId: "f2", sourceId: "agent_b", originalSeverity: "low", severity: "P3", title: "second", category: "bug", location: null, rootCause: null, impact: "impact", evidence: [], evidenceTier: "agent_asserted", reproduction: [], suggestedFix: null, needsRuntimeValidation: false, rawArtifactSha256: "y" });
    await writeFile(join(dir, "normalized", "findings.json"), JSON.stringify(findings), "utf8");
    const d = deps(root);
    expect(await main(["decide", runId, "--item", "i1", "--decision", "rejected"], d.deps)).toBe(0);
    expect(await main(["decide", runId, "--item", "i2", "--decision", "deferred"], d.deps)).toBe(0);
    const decisions = JSON.parse(await readFile(join(dir, "decisions.json"), "utf8")) as Array<{ itemId: string }>;
    expect(decisions.map((decision) => decision.itemId).sort()).toEqual(["i1", "i2"]);
  });

  it("allows validation again after a deciding run returns an item to validate_more", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    const d = deps(root);
    expect(await main(["decide", runId, "--item", "i1", "--decision", "approved_fix"], d.deps)).toBe(0);
    expect((await new RunStore(root).findRunById(runId))?.stage).toBe("deciding");
    expect(await main(["decide", runId, "--item", "i1", "--decision", "validate_more"], d.deps)).toBe(0);
    expect(await main(["validate", runId], d.deps)).toBe(0);
  });

  it("fails closed on corrupt decision JSON", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    const run = (await new RunStore(root).findRunById(runId))!;
    await writeFile(join(runDir(root, run.projectHash, run.runId), "decisions.json"), "{broken", "utf8");
    const d = deps(root);
    expect(await main(["decide", runId], d.deps)).toBe(1);
    expect(d.err()).toMatch(/json|decision/i);
  });

  it("runs the interactive wizard when no item flags are supplied", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    const promptAdapter: PromptAdapter = {
      async input() { return "runtime confirmed"; },
      async select<T>() { return "approved_fix" as T; },
      async confirm() { throw new Error("unused"); },
    };
    const d = deps(root);

    const code = await main(["decide", runId], {
      ...d.deps,
      interactive: true,
      prompts: promptAdapter,
    });

    expect(code).toBe(0);
    const store = new RunStore(root);
    const run = (await store.findRunById(runId))!;
    expect(run.stage).toBe("deciding");
    const decisions = JSON.parse(await readFile(join(runDir(root, run.projectHash, run.runId), "decisions.json"), "utf8")) as Array<{ decision: string; reason: string }>;
    expect(decisions).toEqual([
      expect.objectContaining({ decision: "approved_fix", reason: "runtime confirmed" }),
    ]);
  });
});
