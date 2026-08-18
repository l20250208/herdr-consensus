import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type CliDeps } from "../../src/cli.js";
import { RunStore } from "../../src/state/store.js";
import { runDir } from "../../src/state/paths.js";
import { evidenceSnapshotSha256 } from "../../src/decisions/snapshot.js";
import type { ConsensusItem, NormalizedFinding } from "../../src/consensus/types.js";

const tmpRoots: string[] = [];
async function tempRoot(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), "herdr-cli-lock-")); tmpRoots.push(dir); return dir; }
afterEach(async () => { await Promise.all(tmpRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function createRun(root: string, decision: "approved_fix" | "validate_more" | "missing" = "approved_fix"): Promise<string> {
  const project = await tempRoot();
  const store = new RunStore(root);
  const run = await store.createRun({ runId: "run-lock", projectPath: project });
  await store.transition(run.runId, "reviewing");
  await store.transition(run.runId, "normalized");
  await store.transition(run.runId, "consensus");
  await store.transition(run.runId, "validating");
  await store.transition(run.runId, "arbitrating");
  await store.transition(run.runId, "deciding");
  const dir = runDir(root, run.projectHash, run.runId);
  await mkdir(join(dir, "normalized"), { recursive: true });
  const item: ConsensusItem = { itemId: "i1", findingIds: ["f1"], relation: "single_source", matchScore: null, severity: "P2", evidenceTier: "agent_asserted", disagreementReasons: [], status: "needs_validation" };
  const finding: NormalizedFinding = { findingId: "f1", sourceId: "agent_a", originalSeverity: "m", severity: "P2", title: "bug", category: "bug", location: { path: "src/a.ts", startLine: 1, endLine: 1, symbol: null }, rootCause: null, impact: "impact", evidence: [], evidenceTier: "agent_asserted", reproduction: [], suggestedFix: null, needsRuntimeValidation: true, rawArtifactSha256: "x" };
  await writeFile(join(dir, "consensus.json"), JSON.stringify({ items: [item] }), "utf8");
  await writeFile(join(dir, "normalized", "findings.json"), JSON.stringify([finding]), "utf8");
  const snapshot = evidenceSnapshotSha256({ item, findings: [finding], validations: [], arbitration: [] });
  await writeFile(join(dir, "decisions.json"), JSON.stringify(decision === "missing" ? [] : [{ itemId: "i1", decision, reason: "yes", decidedAt: "t", evidenceSnapshotSha256: snapshot }]), "utf8");
  return run.runId;
}

describe("lock command", () => {
  it("writes fix-plan json and markdown", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    let out = "";
    const deps: CliDeps = { stateDir: root, run: async () => { throw new Error("unused"); }, stdout: (s) => { out += s; }, stderr: () => {} };
    const code = await main(["lock", runId], deps);
    expect(code).toBe(0);
    expect(out).toContain("Locked fix plan v1");
    const store = new RunStore(root);
    const run = (await store.findRunById(runId))!;
    expect(run.stage).toBe("locked");
    const json = await readFile(join(runDir(root, run.projectHash, run.runId), "fix-plan.json"), "utf8");
    expect(json).toContain("src/a.ts");
    const md = await readFile(join(runDir(root, run.projectHash, run.runId), "fix-plan.md"), "utf8");
    expect(md).toContain("SHA-256");
    const archived = await readFile(join(runDir(root, run.projectHash, run.runId), "fix-plans", "v1.json"), "utf8");
    expect(archived).toBe(json);
  });

  it.each(["missing", "validate_more"] as const)("rejects %s terminal decisions", async (decision) => {
    const root = await tempRoot();
    const runId = await createRun(root, decision);
    let err = "";
    const code = await main(["lock", runId], { stateDir: root, run: async () => { throw new Error("unused"); }, stdout: () => {}, stderr: (s) => { err += s; } });
    expect(code).toBe(1);
    expect(err).toMatch(/missing decision|requires more validation/i);
  });

  it("rejects a decision whose evidence snapshot is stale", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    const run = (await new RunStore(root).findRunById(runId))!;
    const path = join(runDir(root, run.projectHash, run.runId), "consensus.json");
    const consensus = JSON.parse(await readFile(path, "utf8")) as { items: Array<{ disagreementReasons: string[] }> };
    consensus.items[0]?.disagreementReasons.push("new evidence");
    await writeFile(path, JSON.stringify(consensus), "utf8");
    let err = "";
    expect(await main(["lock", runId], { stateDir: root, run: async () => { throw new Error("unused"); }, stdout: () => {}, stderr: (s) => { err += s; } })).toBe(1);
    expect(err).toMatch(/stale evidence snapshot/i);
  });

  it("rejects schema-invalid consensus JSON instead of treating it as empty", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    const run = (await new RunStore(root).findRunById(runId))!;
    const dir = runDir(root, run.projectHash, run.runId);
    await writeFile(join(dir, "consensus.json"), JSON.stringify({ items: null }), "utf8");
    let err = "";
    expect(await main(["lock", runId], { stateDir: root, run: async () => { throw new Error("unused"); }, stdout: () => {}, stderr: (s) => { err += s; } })).toBe(1);
    expect(err).toMatch(/invalid consensus\.json artifact/i);
    await expect(readFile(join(dir, "fix-plan.json"), "utf8")).rejects.toThrow();
  });
});
