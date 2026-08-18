import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type CliDeps } from "../../src/cli.js";
import { RunStore } from "../../src/state/store.js";
import { runDir } from "../../src/state/paths.js";
import type { Runner } from "../../src/spawn.js";
import type { ReviewAgentGateway } from "../../src/reports/collector.js";
import type { AgentInfo, PromptInput, PromptOutcome, StartAgentInput } from "../../src/herdr/types.js";
import type { LockedFixPlan } from "../../src/fix-plan/types.js";
import { computeLockedFixPlanSha256 } from "../../src/fix-plan/generate.js";
import { saveFixPlanVersion } from "../../src/fix-plan/store.js";

const tmpRoots: string[] = [];
async function tempRoot(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), "herdr-cli-apply-")); tmpRoots.push(dir); return dir; }
afterEach(async () => { await Promise.all(tmpRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

const gateway: ReviewAgentGateway = {
  async splitPane(input) { expect(input.cwd).toContain("worktree"); return { paneId: "p1" }; },
  async startAgent(input: StartAgentInput): Promise<AgentInfo> {
    expect(input.name).toMatch(/^hc-[a-zA-Z0-9._-]+-fix$/);
    return { name: input.name, status: "idle", paneId: input.paneId, workspaceId: "w", tabId: "t" };
  },
  async prompt(input: PromptInput): Promise<PromptOutcome> { expect(input.text).toContain("LOCKED_FIX_PLAN_JSON"); return { kind: "done", status: "idle", output: "fixed" }; },
};

async function createRun(root: string, items: LockedFixPlan["items"] = []): Promise<string> {
  const project = await tempRoot();
  const store = new RunStore(root);
  const run = await store.createRun({ runId: "run-apply", projectPath: project });
  await store.transition(run.runId, "reviewing");
  await store.transition(run.runId, "normalized");
  await store.transition(run.runId, "consensus");
  await store.transition(run.runId, "validating");
  await store.transition(run.runId, "arbitrating");
  await store.transition(run.runId, "deciding");
  const dir = runDir(root, run.projectHash, run.runId);
  await mkdir(join(dir, "worktree"), { recursive: true });
  await writeFile(join(dir, "worktree", "package.json"), JSON.stringify({ scripts: { test: "vitest" } }), "utf8");
  const withoutHash = { runId: run.runId, version: 1, items, createdAt: "now" };
  const plan = { ...withoutHash, sha256: computeLockedFixPlanSha256(withoutHash) };
  await saveFixPlanVersion(dir, plan, "# plan\n");
  await store.transition(run.runId, "locked", { version: plan.version, sha256: plan.sha256 });
  return run.runId;
}

describe("apply command", () => {
  it("creates an isolated worktree and starts the fix agent", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    const calls: string[][] = [];
    const runner: Runner = async (argv) => {
      calls.push([...argv]);
      if (argv[1] === "rev-parse") return { ok: true, code: 0, stdout: "true\n", stderr: "" };
      return { ok: true, code: 0, stdout: "", stderr: "" };
    };
    let out = "";
    const deps: CliDeps = { stateDir: root, run: runner, gateway, stdout: (s) => { out += s; }, stderr: () => {} };
    const code = await main(["apply", runId, "--agent", "codex", "--approve-regression"], deps);
    expect(code).toBe(0);
    expect(calls.some((call) => call.slice(0, 3).join(" ") === "git worktree add")).toBe(true);
    expect(out).toContain("Started apply");
    const store = new RunStore(root);
    const run = (await store.findRunById(runId))!;
    expect(run.stage).toBe("applying");
    const log = await readFile(join(runDir(root, run.projectHash, run.runId), "logs", "apply-agent-output.txt"), "utf8");
    expect(log).toBe("fixed");
    expect(JSON.parse(await readFile(join(runDir(root, run.projectHash, run.runId), "logs", "targeted-checks.json"), "utf8"))).toEqual([]);
    expect(JSON.parse(await readFile(join(runDir(root, run.projectHash, run.runId), "logs", "regression.json"), "utf8"))).toMatchObject({ approvedByUser: true, exitCode: 0 });
  });

  it("preserves the worktree and rejects changes outside locked paths", async () => {
    const root = await tempRoot();
    const runId = await createRun(root, [{
      itemId: "i1",
      severity: "P2",
      acceptanceCriteria: ["fix"],
      allowedPaths: ["src/a.ts"],
    }]);
    const runner: Runner = async (argv) => {
      if (argv[1] === "rev-parse") return { ok: true, code: 0, stdout: "true\n", stderr: "" };
      if (argv[1] === "diff" && argv[2] === "--name-only") return { ok: true, code: 0, stdout: "src/b.ts\n", stderr: "" };
      return { ok: true, code: 0, stdout: "", stderr: "" };
    };
    let err = "";
    const deps: CliDeps = { stateDir: root, run: runner, gateway, stdout: () => {}, stderr: (text) => { err += text; } };

    const code = await main(["apply", runId, "--agent", "codex", "--approve-regression"], deps);

    expect(code).toBe(1);
    expect(err).toContain("src/b.ts");
    expect((await new RunStore(root).findRunById(runId))?.stage).toBe("locked");
  });

  it("requires explicit approval before creating a worktree or running project code", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    let called = false;
    let err = "";
    const code = await main(["apply", runId, "--agent", "codex"], {
      stateDir: root,
      run: async () => { called = true; return { ok: true, code: 0, stdout: "", stderr: "" }; },
      gateway,
      stdout: () => {},
      stderr: (text) => { err += text; },
    });
    expect(code).toBe(2);
    expect(called).toBe(false);
    expect(err).toContain("--approve-regression");
  });

  it("keeps the run locked when the approved regression fails", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    const runner: Runner = async (argv) => {
      if (argv[1] === "rev-parse" && argv[2] === "--is-inside-work-tree") return { ok: true, code: 0, stdout: "true\n", stderr: "" };
      if (argv[1] === "rev-parse") return { ok: true, code: 0, stdout: "base\n", stderr: "" };
      if (argv[0] === "npm") return { ok: true, code: 1, stdout: "", stderr: "failed" };
      return { ok: true, code: 0, stdout: "", stderr: "" };
    };
    let err = "";
    const code = await main(["apply", runId, "--agent", "codex", "--approve-regression"], {
      stateDir: root, run: runner, gateway, stdout: () => {}, stderr: (text) => { err += text; },
    });
    expect(code).toBe(1);
    expect(err).toContain("regression");
    expect((await new RunStore(root).findRunById(runId))?.stage).toBe("locked");
  });

  it("rejects an apply agent that moves worktree HEAD", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    let headReads = 0;
    let err = "";
    const runner: Runner = async (argv) => {
      if (argv[1] === "rev-parse" && argv[2] === "--is-inside-work-tree") return { ok: true, code: 0, stdout: "true\n", stderr: "" };
      if (argv[1] === "rev-parse") return { ok: true, code: 0, stdout: `${headReads++ === 0 ? "base" : "moved"}\n`, stderr: "" };
      return { ok: true, code: 0, stdout: "", stderr: "" };
    };
    const code = await main(["apply", runId, "--agent", "codex", "--approve-regression"], { stateDir: root, run: runner, gateway, stdout: () => {}, stderr: (text) => { err += text; } });
    expect(code).toBe(1);
    expect(err).toMatch(/head moved/i);
    expect((await new RunStore(root).findRunById(runId))?.stage).toBe("locked");
  });

  it("rejects a schema-valid root fix plan that no longer matches its hash and archive", async () => {
    const root = await tempRoot();
    const runId = await createRun(root, [{ itemId: "i1", severity: "P2", acceptanceCriteria: [], allowedPaths: ["src/a.ts"] }]);
    const run = (await new RunStore(root).findRunById(runId))!;
    const path = join(runDir(root, run.projectHash, run.runId), "fix-plan.json");
    const plan = JSON.parse(await readFile(path, "utf8")) as { items: Array<{ allowedPaths: string[] }> };
    plan.items[0]?.allowedPaths.push("src/escape.ts");
    await writeFile(path, JSON.stringify(plan), "utf8");
    let called = false;
    let err = "";
    const code = await main(["apply", runId, "--agent", "codex", "--approve-regression"], {
      stateDir: root,
      run: async () => { called = true; return { ok: true, code: 0, stdout: "", stderr: "" }; },
      gateway,
      stdout: () => {},
      stderr: (text) => { err += text; },
    });
    expect(code).toBe(1);
    expect(called).toBe(false);
    expect(err).toMatch(/sha-256|archive|locked/i);
  });
});
