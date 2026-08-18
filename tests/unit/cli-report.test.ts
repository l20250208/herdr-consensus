import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type CliDeps } from "../../src/cli.js";
import { RunStore } from "../../src/state/store.js";
import { runDir } from "../../src/state/paths.js";
import type { Runner } from "../../src/spawn.js";
import { computeLockedFixPlanSha256 } from "../../src/fix-plan/generate.js";
import { saveFixPlanVersion } from "../../src/fix-plan/store.js";
import { computeWorkspaceSnapshotSha256 } from "../../src/apply/snapshot.js";

const tmpRoots: string[] = [];
async function tempRoot(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), "herdr-cli-report-")); tmpRoots.push(dir); return dir; }
afterEach(async () => { await Promise.all(tmpRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function createRun(root: string): Promise<string> {
  const project = await tempRoot();
  const store = new RunStore(root);
  const run = await store.createRun({ runId: "run-report", projectPath: project });
  await store.transition(run.runId, "reviewing");
  await store.transition(run.runId, "normalized");
  await store.transition(run.runId, "consensus");
  await store.transition(run.runId, "validating");
  await store.transition(run.runId, "arbitrating");
  await store.transition(run.runId, "deciding");
  const dir = runDir(root, run.projectHash, run.runId);
  await mkdir(join(dir, "worktree"), { recursive: true });
  await mkdir(join(dir, "validations"), { recursive: true });
  await mkdir(join(dir, "arbitration"), { recursive: true });
  await mkdir(join(dir, "logs"), { recursive: true });
  await writeFile(join(dir, "worktree", "package.json"), JSON.stringify({ scripts: { test: "vitest" } }), "utf8");
  const withoutHash = { runId: run.runId, version: 1, items: [{ itemId: "i1", severity: "P2" as const, allowedPaths: ["src/a.ts"], acceptanceCriteria: [] }], createdAt: "now" };
  const plan = { ...withoutHash, sha256: computeLockedFixPlanSha256(withoutHash) };
  await saveFixPlanVersion(dir, plan, "# plan\n");
  await store.transition(run.runId, "locked", { version: plan.version, sha256: plan.sha256 });
  await store.transition(run.runId, "applying");
  await writeFile(join(dir, "consensus.json"), JSON.stringify({ items: [] }), "utf8");
  await writeFile(join(dir, "decisions.json"), "[]", "utf8");
  await writeFile(join(dir, "validations", "records.json"), "[]", "utf8");
  await writeFile(join(dir, "arbitration", "advice.json"), "[]", "utf8");
  await writeFile(join(dir, "arbitration", "metadata.json"), JSON.stringify({ reviewAgentKinds: ["codex", "claude"], agentKind: "gemini", model: null, provider: null, independence: "strong" }), "utf8");
  await writeFile(join(dir, "logs", "path-policy.json"), JSON.stringify({ baseCommit: "base", currentHead: "base", headMoved: false, changedPaths: ["src/a.ts"], ok: true, violations: [] }), "utf8");
  await writeFile(join(dir, "logs", "targeted-checks.json"), "[]", "utf8");
  const snapshotRunner: Runner = async (argv) => {
    if (argv[1] === "diff") return { ok: true, code: 0, stdout: "src/a.ts\n", stderr: "" };
    if (argv[1] === "ls-files") return { ok: true, code: 0, stdout: "", stderr: "" };
    return { ok: true, code: 0, stdout: "", stderr: "" };
  };
  const workspaceSnapshotSha256 = await computeWorkspaceSnapshotSha256({ worktreePath: join(dir, "worktree"), baseCommit: "base", run: snapshotRunner });
  await writeFile(join(dir, "logs", "regression.json"), JSON.stringify({ argv: ["npm", "test"], approvedByUser: true, startedAt: "a", finishedAt: "b", exitCode: 0, stdout: "ok", stderr: "", workspaceSnapshotSha256 }), "utf8");
  return run.runId;
}

describe("report command", () => {
  it("writes markdown and json final reports", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    let regressionRuns = 0;
    const runner: Runner = async (argv) => {
      if (argv[1] === "rev-parse") return { ok: true, code: 0, stdout: "base\n", stderr: "" };
      if (argv[1] === "diff" && argv[2] === "--name-only") return { ok: true, code: 0, stdout: "src/a.ts\n", stderr: "" };
      if (argv[1] === "diff") return { ok: true, code: 0, stdout: "src/a.ts | 1 +", stderr: "" };
      if (argv[1] === "ls-files") return { ok: true, code: 0, stdout: "", stderr: "" };
      if (argv[0] === "npm") regressionRuns += 1;
      return { ok: true, code: 0, stdout: "ok", stderr: "" };
    };
    let out = "";
    const deps: CliDeps = { stateDir: root, run: runner, stdout: (s) => { out += s; }, stderr: () => {} };
    const code = await main(["report", runId], deps);
    expect(code).toBe(0);
    expect(out).toContain("Wrote final report");
    const store = new RunStore(root);
    const run = (await store.findRunById(runId))!;
    expect(run.stage).toBe("reported");
    const md = await readFile(join(runDir(root, run.projectHash, run.runId), "final-report.md"), "utf8");
    expect(md).toContain("src/a.ts | 1 +");
    const json = await readFile(join(runDir(root, run.projectHash, run.runId), "final-report.json"), "utf8");
    expect(json).toContain("regression");
    expect(JSON.parse(json)).toMatchObject({ schemaVersion: 1, changedPaths: ["src/a.ts"] });
    expect(regressionRuns).toBe(0);

    let reopened = "";
    expect(await main(["report", runId, "--json"], {
      stateDir: root,
      run: async () => { throw new Error("reported runs must not execute commands"); },
      stdout: (text) => { reopened += text; },
      stderr: () => {},
    })).toBe(0);
    expect(JSON.parse(reopened)).toMatchObject({ runId, schemaVersion: 1 });
  });

  it("fails closed when apply verification artifacts are missing", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    const store = new RunStore(root);
    const run = (await store.findRunById(runId))!;
    await rm(join(runDir(root, run.projectHash, run.runId), "logs", "targeted-checks.json"));
    let err = "";
    const deps: CliDeps = { stateDir: root, run: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }), stdout: () => {}, stderr: (text) => { err += text; } };

    expect(await main(["report", runId], deps)).toBe(1);
    expect(err).toMatch(/targeted-checks\.json/i);
  });

  it("fails closed when persisted regression evidence is missing", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    const run = (await new RunStore(root).findRunById(runId))!;
    await rm(join(runDir(root, run.projectHash, run.runId), "logs", "regression.json"));
    let err = "";
    const code = await main(["report", runId], { stateDir: root, run: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }), stdout: () => {}, stderr: (text) => { err += text; } });
    expect(code).toBe(1);
    expect(err).toMatch(/regression\.json/i);
  });

  it("fails closed if the worktree HEAD moved after apply", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    let err = "";
    const code = await main(["report", runId], {
      stateDir: root,
      run: async (argv) => argv[1] === "rev-parse"
        ? { ok: true, code: 0, stdout: "moved\n", stderr: "" }
        : { ok: true, code: 0, stdout: "", stderr: "" },
      stdout: () => {},
      stderr: (text) => { err += text; },
    });
    expect(code).toBe(1);
    expect(err).toMatch(/head moved/i);
  });

  it("rejects changes to an allowed file made after the successful regression", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    const run = (await new RunStore(root).findRunById(runId))!;
    const worktree = join(runDir(root, run.projectHash, run.runId), "worktree");
    await mkdir(join(worktree, "src"), { recursive: true });
    await writeFile(join(worktree, "src", "a.ts"), "changed after regression\n", "utf8");
    const runner: Runner = async (argv) => {
      if (argv[1] === "rev-parse") return { ok: true, code: 0, stdout: "base\n", stderr: "" };
      if (argv[1] === "diff" && argv[2] === "--name-only") return { ok: true, code: 0, stdout: "src/a.ts\n", stderr: "" };
      if (argv[1] === "ls-files") return { ok: true, code: 0, stdout: "", stderr: "" };
      return { ok: true, code: 0, stdout: "", stderr: "" };
    };
    let err = "";
    expect(await main(["report", runId], { stateDir: root, run: runner, stdout: () => {}, stderr: (text) => { err += text; } })).toBe(1);
    expect(err).toMatch(/changed after the approved regression/i);
  });
});
