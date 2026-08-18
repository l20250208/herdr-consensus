import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewCollector, type ReviewAgentGateway, type ReviewSource } from "../../src/reports/collector.js";
import { DEFAULT_MARKERS } from "../../src/reports/contract.js";
import { sha256Hex } from "../../src/reports/artifact.js";
import type { AgentInfo, PromptInput, PromptOutcome, StartAgentInput } from "../../src/herdr/types.js";

const VALID_JSON = JSON.stringify({ schemaVersion: 1, findings: [{ title: "x" }] });
const INVALID_OUTPUT = `${DEFAULT_MARKERS.start}\n{ not valid json\n${DEFAULT_MARKERS.end}\n`;
const tmpRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function done(output: string): PromptOutcome {
  return { kind: "done", status: "idle", output };
}

function blocked(output: string): PromptOutcome {
  return { kind: "blocked", output };
}

function exited(message: string): PromptOutcome {
  return { kind: "exited", message };
}

function stalled(output: string): PromptOutcome {
  return { kind: "stalled", output, message: "no observed state change" };
}

class FakeGateway implements ReviewAgentGateway {
  readonly prompts: Array<{ name: string; text: string }> = [];
  maxActive = 0;
  private active = 0;
  private calls = new Map<string, number>();

  constructor(
    private readonly script: (name: string, call: number) => PromptOutcome,
    private readonly startedName: (requested: string) => string = (requested) => requested,
  ) {}

  async splitPane(): Promise<{ paneId: string }> {
    return { paneId: "w9:p9" };
  }

  async startAgent(input: StartAgentInput): Promise<AgentInfo> {
    return { name: this.startedName(input.name), status: "idle", paneId: input.paneId, workspaceId: "w9", tabId: "t9" };
  }

  async prompt(input: PromptInput): Promise<PromptOutcome> {
    const name = input.target;
    const call = this.calls.get(name) ?? 0;
    this.calls.set(name, call + 1);
    this.prompts.push({ name, text: input.text });
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    // Yield so the sibling coroutine can also enter prompt() concurrently.
    await Promise.resolve();
    try {
      return this.script(name, call);
    } finally {
      this.active -= 1;
    }
  }
}

function source(slot: "a" | "b"): ReviewSource {
  return { slot, kind: "claude", name: slot === "a" ? "reviewer-a" : "reviewer-b" };
}

function sources(): [ReviewSource, ReviewSource] {
  return [source("a"), source("b")];
}

describe("ReviewCollector", () => {
  it("collects both reports with the same contract prompt", async () => {
    const gateway = new FakeGateway(() => done(`${DEFAULT_MARKERS.start}\n${VALID_JSON}\n${DEFAULT_MARKERS.end}\n`));
    const collector = new ReviewCollector(gateway);
    const result = await collector.collect({ projectPath: "/tmp/repo", cwd: "/tmp/repo", sources: sources() });

    expect(result.artifacts.a).not.toBeNull();
    expect(result.artifacts.b).not.toBeNull();
    expect(result.outcomes.map((o) => o.kind)).toEqual(["collected", "collected"]);

    // Both agents received the exact same contract text (isolation by construction).
    const promptTexts = gateway.prompts.map((p) => p.text);
    expect(new Set(promptTexts).size).toBe(1);
    expect(promptTexts[0]).toContain("/tmp/repo");
    expect(promptTexts[0]).not.toContain("reviewer-b");
  });

  it("runs the two reviews in parallel", async () => {
    const gateway = new FakeGateway(() => done(`${DEFAULT_MARKERS.start}\n${VALID_JSON}\n${DEFAULT_MARKERS.end}\n`));
    await new ReviewCollector(gateway).collect({ projectPath: "/tmp/repo", cwd: "/tmp/repo", sources: sources() });
    expect(gateway.maxActive).toBe(2);
  });

  it("uses the stable name returned by Herdr for review and repair prompts", async () => {
    const gateway = new FakeGateway(
      (_name, call) => call === 0 ? done(INVALID_OUTPUT) : done(`${DEFAULT_MARKERS.start}\n${VALID_JSON}\n${DEFAULT_MARKERS.end}\n`),
      (requested) => `stable-${requested}`,
    );

    const result = await new ReviewCollector(gateway).collect({ projectPath: "/tmp/repo", cwd: "/tmp/repo", sources: sources() });

    expect(result.outcomes.map((outcome) => outcome.kind)).toEqual(["collected", "collected"]);
    expect(gateway.prompts.map((prompt) => prompt.name)).toEqual([
      "stable-reviewer-a",
      "stable-reviewer-b",
      "stable-reviewer-a",
      "stable-reviewer-b",
    ]);
  });

  it("prefers isolated controlled artifact files over corrupted terminal output", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "herdr-collector-output-"));
    tmpRoots.push(artifactDir);
    const paths = new Map<string, string>();
    const contracts: string[] = [];
    const paneCwds: string[] = [];
    let paneNumber = 0;
    const fileGateway: ReviewAgentGateway = {
      async splitPane(input: { cwd: string; env?: Record<string, string> }) {
        paneCwds.push(input.cwd);
        const paneId = `p${++paneNumber}`;
        const outputPath = input.env?.HERDR_CONSENSUS_OUTPUT;
        if (outputPath === undefined) throw new Error("missing controlled output path");
        paths.set(paneId, outputPath);
        return { paneId };
      },
      async startAgent(input) {
        const outputPath = paths.get(input.paneId);
        if (outputPath === undefined) throw new Error("unknown pane");
        paths.set(input.name, outputPath);
        return { name: input.name, status: "idle", paneId: input.paneId, workspaceId: "w", tabId: "t" };
      },
      async prompt(input) {
        contracts.push(input.text);
        const outputPath = paths.get(input.target);
        if (outputPath === undefined) throw new Error("missing output path");
        await writeFile(outputPath, VALID_JSON, "utf8");
        return done("terminal redraw corrupted this output");
      },
    };

    const result = await new ReviewCollector(fileGateway).collect({ projectPath: "/tmp/repo", cwd: "/tmp/repo", sources: sources(), artifactDir });

    expect(result.outcomes.map((outcome) => outcome.kind)).toEqual(["collected", "collected"]);
    expect(result.artifacts.a?.content).toBe(VALID_JSON);
    expect(new Set(contracts).size).toBe(1);
    expect(new Set([...paths.values()]).size).toBe(2);
    expect(paneCwds.every((cwd) => cwd.startsWith(artifactDir) && cwd !== "/tmp/repo")).toBe(true);
  });

  it("repairs invalid JSON exactly once and succeeds", async () => {
    const gateway = new FakeGateway((_name, call) =>
      call === 0 ? done(INVALID_OUTPUT) : done(`${DEFAULT_MARKERS.start}\n${VALID_JSON}\n${DEFAULT_MARKERS.end}\n`),
    );
    const collector = new ReviewCollector(gateway);
    const result = await collector.collect({ projectPath: "/tmp/repo", cwd: "/tmp/repo", sources: sources() });

    expect(result.artifacts.a).not.toBeNull();
    const outcomeA = result.outcomes.find((o) => o.slot === "a");
    expect(outcomeA?.kind).toBe("collected");
    expect(outcomeA?.repairs).toBe(1);
    // Each agent is prompted twice: the review and exactly one repair.
    expect(gateway.prompts.filter((p) => p.name === "reviewer-a")).toHaveLength(2);
  });

  it("gives up after one repair and preserves the raw output", async () => {
    const gateway = new FakeGateway(() => done(INVALID_OUTPUT));
    const collector = new ReviewCollector(gateway);
    const result = await collector.collect({ projectPath: "/tmp/repo", cwd: "/tmp/repo", sources: sources() });

    const outcomeA = result.outcomes.find((o) => o.slot === "a");
    expect(outcomeA?.kind).toBe("invalid");
    expect(outcomeA?.repairs).toBe(1);
    expect(result.artifacts.a?.content).toBe(INVALID_OUTPUT);
    expect(result.artifacts.a?.sha256).toBe(sha256Hex(INVALID_OUTPUT));
    // No third prompt: review + exactly one repair.
    expect(gateway.prompts.filter((p) => p.name === "reviewer-a")).toHaveLength(2);
  });

  it("records a blocked agent and keeps its raw output", async () => {
    const gateway = new FakeGateway(() => blocked("approval needed"));
    const collector = new ReviewCollector(gateway);
    const result = await collector.collect({ projectPath: "/tmp/repo", cwd: "/tmp/repo", sources: sources() });

    expect(result.outcomes.find((o) => o.slot === "a")?.kind).toBe("blocked");
    expect(result.artifacts.a?.content).toBe("approval needed");
  });

  it("records an exited agent with no artifact", async () => {
    const gateway = new FakeGateway(() => exited("agent not found"));
    const collector = new ReviewCollector(gateway);
    const result = await collector.collect({ projectPath: "/tmp/repo", cwd: "/tmp/repo", sources: sources() });

    expect(result.outcomes.find((o) => o.slot === "a")?.kind).toBe("exited");
    expect(result.artifacts.a).toBeNull();
  });

  it("retries one stalled prompt only when no submission trace exists", async () => {
    const gateway = new FakeGateway((_name, call) =>
      call === 0 ? stalled("agent welcome screen") : done(`${DEFAULT_MARKERS.start}\n${VALID_JSON}\n${DEFAULT_MARKERS.end}`),
    );

    const result = await new ReviewCollector(gateway).collect({ projectPath: "/tmp/repo", cwd: "/tmp/repo", sources: sources() });

    expect(result.outcomes.map((outcome) => outcome.kind)).toEqual(["collected", "collected"]);
    expect(result.outcomes.map((outcome) => outcome.repairs)).toEqual([0, 0]);
    expect(gateway.prompts).toHaveLength(4);
  });

  it("does not resend a stalled prompt when its marker is already visible", async () => {
    const gateway = new FakeGateway(() => stalled(`echoed ${DEFAULT_MARKERS.start}`));

    const result = await new ReviewCollector(gateway).collect({ projectPath: "/tmp/repo", cwd: "/tmp/repo", sources: sources() });

    expect(result.outcomes.map((outcome) => outcome.kind)).toEqual(["stalled", "stalled"]);
    expect(gateway.prompts).toHaveLength(2);
  });
});
