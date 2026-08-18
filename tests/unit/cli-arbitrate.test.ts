import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type CliDeps } from "../../src/cli.js";
import { RunStore } from "../../src/state/store.js";
import { runDir } from "../../src/state/paths.js";
import type { ReviewAgentGateway } from "../../src/reports/collector.js";
import type { AgentInfo, PromptInput, PromptOutcome, StartAgentInput } from "../../src/herdr/types.js";
import { makeArtifact } from "../../src/reports/artifact.js";
import { saveRawReports } from "../../src/reports/storage.js";

const tmpRoots: string[] = [];
async function tempRoot(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), "herdr-cli-arb-")); tmpRoots.push(dir); return dir; }
afterEach(async () => { await Promise.all(tmpRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

const gateway: ReviewAgentGateway = {
  async splitPane(input) { expect(input.cwd).toMatch(/arbitration\/agent-work$/); return { paneId: "p1" }; },
  async startAgent(input: StartAgentInput): Promise<AgentInfo> {
    expect(input.name).toMatch(/^hc-[a-zA-Z0-9._-]+-arb$/);
    return { name: input.name, status: "idle", paneId: input.paneId, workspaceId: "w", tabId: "t" };
  },
  async prompt(input: PromptInput): Promise<PromptOutcome> {
    expect(input.text).toContain("read-only");
    return { kind: "done", status: "idle", output: `<<<HERDR_CONSENSUS_ARBITRATION_JSON_START>>>\n${JSON.stringify({ itemId: "i1", recommendation: "validate_more", rationale: "need runtime proof", evidenceRefs: ["f1"], confidence: "low", missingValidation: ["run test"] })}\n<<<HERDR_CONSENSUS_ARBITRATION_JSON_END>>>` };
  },
};

async function createRun(root: string): Promise<string> {
  const project = await tempRoot();
  const store = new RunStore(root);
  const run = await store.createRun({ runId: "run-arb", projectPath: project });
  await store.transition(run.runId, "reviewing");
  await store.transition(run.runId, "normalized");
  await store.transition(run.runId, "consensus");
  await store.transition(run.runId, "validating");
  const dir = runDir(root, run.projectHash, run.runId);
  await mkdir(join(dir, "normalized"), { recursive: true });
  await mkdir(join(dir, "validations"), { recursive: true });
  await writeFile(join(dir, "consensus.json"), JSON.stringify({ items: [{ itemId: "i1", findingIds: ["f1"], relation: "disputed", matchScore: 0.8, severity: "P2", evidenceTier: "agent_asserted", disagreementReasons: ["conflict"], status: "disputed" }] }), "utf8");
  await writeFile(join(dir, "normalized", "findings.json"), JSON.stringify([{ findingId: "f1", sourceId: "agent_a", originalSeverity: "medium", severity: "P2", title: "bug", category: "bug", location: null, rootCause: null, impact: "impact", evidence: [], evidenceTier: "agent_asserted", reproduction: [], suggestedFix: null, needsRuntimeValidation: true, rawArtifactSha256: "x" }]), "utf8");
  await writeFile(join(dir, "validations", "records.json"), "[]", "utf8");
  await saveRawReports(dir, {
    a: makeArtifact({ sourceId: "agent_a", agentKind: "codex", content: "a" }),
    b: makeArtifact({ sourceId: "agent_b", agentKind: "claude", content: "b" }),
  });
  return run.runId;
}

describe("arbitrate command", () => {
  it("runs a read-only third AI prompt and persists advice", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    let out = ""; let err = "";
    const deps: CliDeps = { stateDir: root, gateway, run: async () => { throw new Error("unused"); }, stdout: (s) => { out += s; }, stderr: (s) => { err += s; } };
    const code = await main(["arbitrate", runId, "--agent", "gemini"], deps);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out).toContain("Recorded 1 arbitration");
    const store = new RunStore(root);
    const run = (await store.findRunById(runId))!;
    expect(run.stage).toBe("arbitrating");
    const advice = await readFile(join(runDir(root, run.projectHash, run.runId), "arbitration", "advice.json"), "utf8");
    expect(advice).toContain("validate_more");
    const metadata = JSON.parse(await readFile(join(runDir(root, run.projectHash, run.runId), "arbitration", "metadata.json"), "utf8")) as Record<string, unknown>;
    expect(metadata).toMatchObject({ agentKind: "gemini", model: null, provider: null, independence: "strong" });
  });

  it("warns when the arbiter repeats a reviewer kind", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    let err = "";
    const deps: CliDeps = { stateDir: root, gateway, run: async () => { throw new Error("unused"); }, stdout: () => {}, stderr: (s) => { err += s; } };

    const code = await main(["arbitrate", runId, "--agent", "codex"], deps);

    expect(code).toBe(0);
    expect(err).toMatch(/independence.*weak/i);
  });

  it("rejects advice for the wrong item and leaves arbitration retryable", async () => {
    const root = await tempRoot();
    const runId = await createRun(root);
    const wrongItemGateway: ReviewAgentGateway = {
      ...gateway,
      async prompt(): Promise<PromptOutcome> {
        return { kind: "done", status: "idle", output: `<<<HERDR_CONSENSUS_ARBITRATION_JSON_START>>>\n${JSON.stringify({ itemId: "other", recommendation: "fix", rationale: "wrong item", evidenceRefs: [], confidence: "low", missingValidation: [] })}\n<<<HERDR_CONSENSUS_ARBITRATION_JSON_END>>>` };
      },
    };
    const code = await main(["arbitrate", runId, "--agent", "gemini"], { stateDir: root, gateway: wrongItemGateway, run: async () => { throw new Error("unused"); }, stdout: () => {}, stderr: () => {} });
    expect(code).toBe(1);
    const store = new RunStore(root);
    const run = (await store.findRunById(runId))!;
    expect(run.stage).toBe("validating");
    expect(JSON.parse(await readFile(join(runDir(root, run.projectHash, run.runId), "arbitration", "advice.json"), "utf8"))).toEqual([]);
  });
});
