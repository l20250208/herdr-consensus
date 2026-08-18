import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type CliDeps } from "../../src/cli.js";
import type { AgentInfo, PromptInput, PromptOutcome, StartAgentInput } from "../../src/herdr/types.js";
import { makeArtifact } from "../../src/reports/artifact.js";
import { DEFAULT_MARKERS } from "../../src/reports/contract.js";
import type { ReviewAgentGateway } from "../../src/reports/collector.js";
import { saveRawReports } from "../../src/reports/storage.js";
import { runDir } from "../../src/state/paths.js";
import { RunStore } from "../../src/state/store.js";
import type { PromptAdapter } from "../../src/ui/prompts.js";
import { computeLockedFixPlanSha256 } from "../../src/fix-plan/generate.js";
import { saveFixPlanVersion } from "../../src/fix-plan/store.js";
import { computeWorkspaceSnapshotSha256 } from "../../src/apply/snapshot.js";

const roots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const reportJson = JSON.stringify({ schemaVersion: 1, findings: [] });
const report = `${DEFAULT_MARKERS.start}\n${reportJson}\n${DEFAULT_MARKERS.end}`;

const gateway: ReviewAgentGateway = {
  async splitPane() {
    return { paneId: "p1" };
  },
  async startAgent(input: StartAgentInput): Promise<AgentInfo> {
    return { name: input.name, status: "idle", paneId: input.paneId, workspaceId: "w", tabId: "t" };
  },
  async prompt(_input: PromptInput): Promise<PromptOutcome> {
    return { kind: "done", status: "idle", output: report };
  },
};

function fakePrompts(values: unknown[]): { adapter: PromptAdapter; messages: string[] } {
  const queue = [...values];
  const messages: string[] = [];
  return {
    messages,
    adapter: {
      async input(message) {
        messages.push(message);
        return String(queue.shift());
      },
      async select<T>(message: string): Promise<T> {
        messages.push(message);
        return queue.shift() as T;
      },
      async confirm(message) {
        messages.push(message);
        return Boolean(queue.shift());
      },
    },
  };
}

function deps(stateDir: string, prompts: PromptAdapter, overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    stateDir,
    interactive: true,
    prompts,
    gateway,
    run: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }),
    stdout: () => {},
    stderr: () => {},
    ...overrides,
  };
}

describe("no-argument Herdr actions", () => {
  it("prompts for two agent kinds when start has no flags", async () => {
    const state = await tempRoot("herdr-actions-state-");
    const prompts = fakePrompts(["claude", "codex"]);

    const code = await main(["start"], deps(state, prompts.adapter));

    expect(code).toBe(0);
    expect(prompts.messages).toEqual(["Agent A kind", "Agent B kind"]);
    expect((await new RunStore(state).listRuns())[0]?.stage).toBe("consensus");
  });

  it("selects and resumes an unfinished run", async () => {
    const state = await tempRoot("herdr-actions-state-");
    const project = await tempRoot("herdr-actions-project-");
    const store = new RunStore(state);
    const created = await store.createRun({ runId: "run-resume-action", projectPath: project });
    const reviewing = await store.transition(created.runId, "reviewing");
    await saveRawReports(runDir(state, reviewing.projectHash, reviewing.runId), {
      a: makeArtifact({ sourceId: "agent_a", agentKind: "claude", content: report }),
      b: makeArtifact({ sourceId: "agent_b", agentKind: "codex", content: report }),
    });
    const prompts = fakePrompts([reviewing.runId]);

    const code = await main(["resume"], deps(state, prompts.adapter));

    expect(code).toBe(0);
    expect(prompts.messages).toEqual(["Select a run to resume"]);
    expect((await store.findRunById(reviewing.runId))?.stage).toBe("consensus");
  });

  it("selects a run for decide and report actions", async () => {
    const state = await tempRoot("herdr-actions-state-");
    const project = await tempRoot("herdr-actions-project-");
    const store = new RunStore(state);
    const created = await store.createRun({ runId: "run-actions", projectPath: project });
    for (const stage of ["reviewing", "normalized", "consensus", "validating", "arbitrating"] as const) {
      await store.transition(created.runId, stage);
    }
    const run = (await store.findRunById(created.runId))!;
    const dir = runDir(state, run.projectHash, run.runId);
    await mkdir(join(dir, "normalized"), { recursive: true });
    await mkdir(join(dir, "validations"), { recursive: true });
    await mkdir(join(dir, "arbitration"), { recursive: true });
    await writeFile(join(dir, "consensus.json"), '{"items":[]}', "utf8");
    await writeFile(join(dir, "normalized", "findings.json"), "[]", "utf8");
    await writeFile(join(dir, "validations", "records.json"), "[]", "utf8");
    await writeFile(join(dir, "arbitration", "advice.json"), "[]", "utf8");
    const decidePrompts = fakePrompts([run.runId]);
    expect(await main(["decide"], deps(state, decidePrompts.adapter))).toBe(0);
    expect(decidePrompts.messages[0]).toBe("Select a run to decide");

    await store.transition(run.runId, "deciding");
    await writeFile(join(dir, "decisions.json"), "[]", "utf8");
    const withoutHash = { runId: run.runId, version: 1, items: [], createdAt: "now" };
    const plan = { ...withoutHash, sha256: computeLockedFixPlanSha256(withoutHash) };
    await saveFixPlanVersion(dir, plan, "# plan\n");
    await store.transition(run.runId, "locked", { version: plan.version, sha256: plan.sha256 });
    await store.transition(run.runId, "applying");
    await mkdir(join(dir, "worktree"), { recursive: true });
    await mkdir(join(dir, "logs"), { recursive: true });
    await writeFile(join(dir, "arbitration", "metadata.json"), JSON.stringify({ reviewAgentKinds: ["claude", "codex"], agentKind: "gemini", model: null, provider: null, independence: "strong" }), "utf8");
    await writeFile(join(dir, "logs", "path-policy.json"), JSON.stringify({ baseCommit: "base", currentHead: "base", headMoved: false, changedPaths: [], ok: true, violations: [] }), "utf8");
    await writeFile(join(dir, "logs", "targeted-checks.json"), "[]", "utf8");
    const snapshotRunner = async () => ({ ok: true as const, code: 0, stdout: "", stderr: "" });
    const workspaceSnapshotSha256 = await computeWorkspaceSnapshotSha256({ worktreePath: join(dir, "worktree"), baseCommit: "base", run: snapshotRunner });
    await writeFile(join(dir, "logs", "regression.json"), JSON.stringify({ argv: ["npm", "test"], approvedByUser: true, startedAt: "s", finishedAt: "f", exitCode: 0, stdout: "", stderr: "", workspaceSnapshotSha256 }), "utf8");
    const reportPrompts = fakePrompts([run.runId]);
    expect(await main(["report"], deps(state, reportPrompts.adapter, {
      run: async (argv) => argv[1] === "rev-parse"
        ? { ok: true, code: 0, stdout: "base\n", stderr: "" }
        : { ok: true, code: 0, stdout: "", stderr: "" },
    }))).toBe(0);
    expect(reportPrompts.messages[0]).toBe("Select a run to report");
  });

  it("keeps explicit usage errors in non-interactive mode", async () => {
    const state = await tempRoot("herdr-actions-state-");
    const prompts = fakePrompts([]);
    let err = "";

    const code = await main(["start"], {
      ...deps(state, prompts.adapter),
      interactive: false,
      stderr: (text) => {
        err += text;
      },
    });

    expect(code).toBe(2);
    expect(err).toContain("--agent-a");
    expect(prompts.messages).toEqual([]);
  });
});
