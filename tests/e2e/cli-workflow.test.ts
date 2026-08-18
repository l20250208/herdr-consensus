import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARBITRATION_MARKERS } from "../../src/arbitration/prompt.js";
import { main, type CliDeps } from "../../src/cli.js";
import type { AgentInfo, PromptInput, PromptOutcome, StartAgentInput } from "../../src/herdr/types.js";
import { DEFAULT_MARKERS } from "../../src/reports/contract.js";
import type { ReviewAgentGateway } from "../../src/reports/collector.js";
import { runDir } from "../../src/state/paths.js";
import { RunStore } from "../../src/state/store.js";
import type { PromptAdapter } from "../../src/ui/prompts.js";
import type { Runner } from "../../src/spawn.js";

const roots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function markedReport(findings: unknown[]): string {
  return `${DEFAULT_MARKERS.start}\n${JSON.stringify({ schemaVersion: 1, findings })}\n${DEFAULT_MARKERS.end}`;
}

const common = {
  title: "Unchecked request result",
  category: "correctness",
  severity: "P1",
  location: { path: "src/a.ts", startLine: 1, endLine: 2, symbol: "run" },
  rootCause: "unchecked result",
  impact: "request fails",
  evidence: ["error is ignored"],
  reproduction: [],
  suggestedFix: "check the result",
};

const reportA = markedReport([
  common,
  {
    title: "Boundary failure",
    category: "correctness",
    severity: "P2",
    location: { path: "src/a.ts", startLine: 10, endLine: 11, symbol: "parse" },
    rootCause: "boundary input is not checked",
    impact: "specific input fails",
    evidence: ["branch lacks guard"],
    reproduction: ["npm test"],
    suggestedFix: "add boundary guard",
  },
  {
    title: "Protection dispute",
    category: "security",
    severity: "P2",
    location: { path: "src/a.ts", startLine: 20, endLine: 21, symbol: "authorize" },
    rootCause: "missing authorization",
    impact: "access may be allowed",
    evidence: ["no local check"],
    reproduction: [],
    suggestedFix: "add authorization",
  },
]);

const reportB = markedReport([
  common,
  {
    title: "Protection dispute",
    category: "security",
    severity: "P2",
    location: { path: "src/a.ts", startLine: 20, endLine: 21, symbol: "authorize" },
    rootCause: "upstream middleware protects access",
    impact: "request is already rejected",
    evidence: ["middleware guard"],
    reproduction: [],
    suggestedFix: "keep middleware",
  },
]);

class FixtureGateway implements ReviewAgentGateway {
  async splitPane(): Promise<{ paneId: string }> {
    return { paneId: "fixture-pane" };
  }

  async startAgent(input: StartAgentInput): Promise<AgentInfo> {
    return { name: input.name, status: "idle", paneId: input.paneId, workspaceId: "fixture", tabId: "tab" };
  }

  async prompt(input: PromptInput): Promise<PromptOutcome> {
    if (input.text.includes("LOCKED_FIX_PLAN_JSON")) {
      return { kind: "done", status: "idle", output: "fixture apply complete" };
    }
    if (input.text.includes("CONSENSUS_ITEM:")) {
      const itemId = /"itemId":\s*"([^"]+)"/.exec(input.text)?.[1] ?? "unknown";
      return {
        kind: "done",
        status: "idle",
        output: `${ARBITRATION_MARKERS.start}\n${JSON.stringify({
          itemId,
          recommendation: "fix",
          rationale: "fixture arbitration",
          evidenceRefs: [],
          confidence: "medium",
          missingValidation: [],
        })}\n${ARBITRATION_MARKERS.end}`,
      };
    }
    return { kind: "done", status: "idle", output: input.target.endsWith("-a") ? reportA : reportB };
  }
}

describe("complete CLI workflow", () => {
  it("runs a no-model fixture from review through final report without changing the main project", async () => {
    const state = await tempRoot("herdr-e2e-state-");
    const project = await tempRoot("herdr-e2e-project-");
    await writeFile(join(project, "package.json"), JSON.stringify({ scripts: { test: "fixture-test" } }), "utf8");
    const before = await readdir(project);
    let worktreePath: string | null = null;

    const runner: Runner = async (argv, options) => {
      const command = argv.join(" ");
      if (command === "git rev-parse --is-inside-work-tree") return { ok: true, code: 0, stdout: "true\n", stderr: "" };
      if (command === "git status --porcelain") return { ok: true, code: 0, stdout: "", stderr: "" };
      if (argv[0] === "git" && argv[1] === "worktree" && argv[2] === "add") {
        worktreePath = argv[5] ?? null;
        if (worktreePath !== null) {
          await mkdir(worktreePath, { recursive: true });
          await writeFile(join(worktreePath, "package.json"), JSON.stringify({ scripts: { test: "fixture-test" } }), "utf8");
        }
        return { ok: true, code: 0, stdout: "", stderr: "" };
      }
      if (argv[0] === "git" && argv[1] === "rev-parse" && argv[2] === "HEAD") return { ok: true, code: 0, stdout: "fixture-base\n", stderr: "" };
      if (argv[0] === "git" && argv[1] === "diff" && argv[2] === "--name-only") return { ok: true, code: 0, stdout: "src/a.ts\n", stderr: "" };
      if (command === "git ls-files --others --exclude-standard") return { ok: true, code: 0, stdout: "", stderr: "" };
      if (argv[0] === "git" && argv[1] === "diff" && argv[2] === "--stat") return { ok: true, code: 0, stdout: "src/a.ts | 3 ++-\n", stderr: "" };
      if (command === "npm test") {
        return options?.cwd === project
          ? { ok: true, code: 1, stdout: "fixture reproduced", stderr: "" }
          : { ok: true, code: 0, stdout: "fixture fixed", stderr: "" };
      }
      return { ok: true, code: 0, stdout: "", stderr: "" };
    };

    const prompts: PromptAdapter = {
      async input() { return "approved in fixture"; },
      async select<T>() { return "approved_fix" as T; },
      async confirm() { throw new Error("unexpected confirmation"); },
    };
    const gateway = new FixtureGateway();

    async function invoke(argv: string[], interactive = false): Promise<{ code: number; stdout: string; stderr: string }> {
      let stdout = "";
      let stderr = "";
      const deps: CliDeps = {
        stateDir: state,
        run: runner,
        gateway,
        prompts,
        interactive,
        stdout: (text) => { stdout += text; },
        stderr: (text) => { stderr += text; },
      };
      const code = await main(argv, deps);
      return { code, stdout, stderr };
    }

    const started = await invoke(["start", "--agent-a", "claude", "--agent-b", "codex", "--json"]);
    expect(started.code, started.stderr).toBe(0);
    const runId = (JSON.parse(started.stdout) as { runId: string }).runId;
    expect((await invoke(["validate", runId])).code).toBe(0);
    expect((await invoke(["validate", runId, "--approve"])).code).toBe(0);
    expect((await invoke(["arbitrate", runId, "--agent", "gemini"])).code).toBe(0);
    expect((await invoke(["decide", runId], true)).code).toBe(0);
    expect((await invoke(["lock", runId])).code).toBe(0);
    expect((await invoke(["apply", runId, "--agent", "codex", "--approve-regression"])).code).toBe(0);
    expect(worktreePath).not.toBeNull();
    const reported = await invoke(["report", runId]);
    expect(reported.code, reported.stderr).toBe(0);

    const store = new RunStore(state);
    const run = (await store.findRunById(runId))!;
    expect(run.stage).toBe("reported");
    const finalReport = JSON.parse(await readFile(join(runDir(state, run.projectHash, run.runId), "final-report.json"), "utf8")) as Record<string, unknown>;
    expect(finalReport).toMatchObject({ schemaVersion: 1, pathPolicy: { ok: true } });
    expect(await readdir(project)).toEqual(before);
  });
});
