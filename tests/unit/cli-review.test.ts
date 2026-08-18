import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type CliDeps } from "../../src/cli.js";
import { RunStore } from "../../src/state/store.js";
import { DEFAULT_MARKERS } from "../../src/reports/contract.js";
import type { ReviewAgentGateway } from "../../src/reports/collector.js";
import type { AgentInfo, PromptInput, PromptOutcome, StartAgentInput } from "../../src/herdr/types.js";
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
  throw new Error("runner should not be called");
};

const validOutput = `${DEFAULT_MARKERS.start}\n${JSON.stringify({ schemaVersion: 1, findings: [] })}\n${DEFAULT_MARKERS.end}\n`;

const okGateway: ReviewAgentGateway = {
  async splitPane() {
    return { paneId: "w9:p9" };
  },
  async startAgent(input: StartAgentInput): Promise<AgentInfo> {
    return { name: input.name, status: "idle", paneId: input.paneId, workspaceId: "w9", tabId: "t9" };
  },
  async prompt(_input: PromptInput): Promise<PromptOutcome> {
    return { kind: "done", status: "idle", output: validOutput };
  },
};

function makeDeps(stateDir: string): { deps: CliDeps; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  const deps: CliDeps = {
    run: unusedRun,
    stateDir,
    gateway: okGateway,
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
  };
  return { deps, out: () => out, err: () => err };
}

describe("start command", () => {
  it("requires both agent flags", async () => {
    const { deps, err } = makeDeps(await tempRoot());
    const code = await main(["start"], deps);
    expect(code).toBe(2);
    expect(err()).toContain("--agent-a");
  });

  it("collects two reports and persists raw artifacts", async () => {
    const root = await tempRoot();
    const { deps, out } = makeDeps(root);
    const code = await main(["start", "--agent-a", "claude", "--agent-b", "codex"], deps);
    expect(code).toBe(0);
    expect(out()).toContain("Started review");

    const store = new RunStore(root);
    const runs = await store.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.stage).toBe("consensus");

    const runDir = join(root, "projects", runs[0]!.projectHash, "runs", runs[0]!.runId);
    expect(await readFile(join(runDir, "raw", "a.txt"), "utf8")).toBe(validOutput);
    expect(JSON.parse(await readFile(join(runDir, "normalized", "findings.json"), "utf8"))).toEqual([]);
    expect(JSON.parse(await readFile(join(runDir, "consensus.json"), "utf8"))).toEqual({ items: [] });
  });
});

describe("import command", () => {
  it("imports two report files into a run", async () => {
    const root = await tempRoot();
    const fileA = join(root, "a.md");
    const fileB = join(root, "b.json");
    const reportA = '{"schemaVersion":1,"findings":[]}\n';
    const reportB = '```json\n{"schemaVersion":1,"findings":[]}\n```\n';
    await writeFile(fileA, reportA, "utf8");
    await writeFile(fileB, reportB, "utf8");

    const { deps, out } = makeDeps(root);
    const code = await main(["import", "--agent-a", fileA, "--agent-b", fileB], deps);
    expect(code).toBe(0);
    expect(out()).toContain("Imported review");

    const store = new RunStore(root);
    const runs = await store.listRuns();
    expect(runs[0]?.stage).toBe("consensus");
    const runDir = join(root, "projects", runs[0]!.projectHash, "runs", runs[0]!.runId);
    expect(await readFile(join(runDir, "raw", "a.txt"), "utf8")).toBe(reportA);
    expect(await readFile(join(runDir, "raw", "b.txt"), "utf8")).toBe(reportB);
    expect(JSON.parse(await readFile(join(runDir, "consensus.json"), "utf8"))).toEqual({ items: [] });
  });

  it("preserves raw prose and fails closed without consensus", async () => {
    const root = await tempRoot();
    const fileA = join(root, "a.txt");
    const fileB = join(root, "b.json");
    await writeFile(fileA, "plain prose report\n", "utf8");
    await writeFile(fileB, '{"schemaVersion":1,"findings":[]}\n', "utf8");

    const { deps, err } = makeDeps(root);
    const code = await main(["import", "--agent-a", fileA, "--agent-b", fileB], deps);

    expect(code).toBe(1);
    expect(err()).toMatch(/report A.*supported formats/i);
    const store = new RunStore(root);
    const runs = await store.listRuns();
    expect(runs[0]?.stage).toBe("reviewing");
    const runDir = join(root, "projects", runs[0]!.projectHash, "runs", runs[0]!.runId);
    expect(await readFile(join(runDir, "raw", "a.txt"), "utf8")).toBe("plain prose report\n");
    await expect(readFile(join(runDir, "consensus.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("exits 1 when a report file is missing", async () => {
    const { deps, err } = makeDeps(await tempRoot());
    const code = await main(["import", "--agent-a", "/does/not/exist", "--agent-b", "/also/missing"], deps);
    expect(code).toBe(1);
    expect(err()).toContain("failed to read report");
  });
});
