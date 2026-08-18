import { describe, expect, it } from "vitest";
import { HerdrAgentAdapter } from "../../src/herdr/adapter.js";
import { classifyErrorCode } from "../../src/herdr/types.js";
import type { Runner, SpawnResult } from "../../src/spawn.js";

function json(result: unknown): SpawnResult {
  return { ok: true, code: 0, stdout: JSON.stringify({ result }), stderr: "" };
}

function err(code: string, message: string, exitCode: number): SpawnResult {
  return { ok: true, code: exitCode, stdout: JSON.stringify({ error: { code, message } }), stderr: "" };
}

describe("classifyErrorCode", () => {
  it("maps herdr error codes to classified kinds", () => {
    expect(classifyErrorCode("timeout")).toBe("timeout");
    expect(classifyErrorCode("agent_prompt_stalled")).toBe("stalled");
    expect(classifyErrorCode("agent_not_found")).toBe("exited");
    expect(classifyErrorCode("something_else")).toBe("unknown");
    expect(classifyErrorCode(null)).toBe("unknown");
  });
});

function promptRunner(scenario: string): Runner {
  return async (argv) => {
    const sub = argv[2];
    if (sub === "prompt") {
      const agent = { agent: "claude", agent_status: "idle", pane_id: "p1", workspace_id: "w1", tab_id: "t1" };
      switch (scenario) {
        case "blocked":
          return json({ agent: { ...agent, agent_status: "blocked" } });
        case "timeout":
          return err("timeout", "timed out", 1);
        case "exit":
          return err("agent_not_found", "gone", 1);
        case "stalled":
          return err("agent_prompt_stalled", "stalled", 1);
        default:
          return json({ agent });
      }
    }
    if (sub === "read") return { ok: true, code: 0, stdout: "terminal output\n", stderr: "" };
    throw new Error(`unexpected command in test: ${argv.join(" ")}`);
  };
}

describe("HerdrAgentAdapter.prompt classification", () => {
  it("classifies a settled prompt as done", async () => {
    const adapter = new HerdrAgentAdapter({ run: promptRunner("done") });
    const result = await adapter.prompt({ target: "p1", text: "review this" });
    expect(result).toEqual({ kind: "done", status: "idle", output: "terminal output\n" });
  });

  it("classifies a settled prompt in the blocked state", async () => {
    const adapter = new HerdrAgentAdapter({ run: promptRunner("blocked") });
    const result = await adapter.prompt({ target: "p1", text: "review this" });
    expect(result).toEqual({ kind: "blocked", output: "terminal output\n" });
  });

  it("classifies a prompt timeout", async () => {
    const adapter = new HerdrAgentAdapter({ run: promptRunner("timeout") });
    const result = await adapter.prompt({ target: "p1", text: "review this" });
    expect(result.kind).toBe("timed_out");
  });

  it("classifies an exited agent", async () => {
    const adapter = new HerdrAgentAdapter({ run: promptRunner("exit") });
    const result = await adapter.prompt({ target: "p1", text: "review this" });
    expect(result).toEqual({ kind: "exited", message: "gone" });
  });

  it("classifies a stalled prompt", async () => {
    const adapter = new HerdrAgentAdapter({ run: promptRunner("stalled") });
    const result = await adapter.prompt({ target: "p1", text: "review this" });
    expect(result.kind).toBe("stalled");
  });
});

describe("HerdrAgentAdapter.startAgent", () => {
  it("retries a newly split pane that has not reached a shell prompt", async () => {
    let attempts = 0;
    const run: Runner = async () => {
      attempts++;
      if (attempts === 1) {
        return err("agent_start_failed", "agent target pane w7:pC is not an available shell", 1);
      }
      return json({
        agent: {
          agent: "codex",
          name: "hc-run-a",
          agent_status: "idle",
          pane_id: "w7:pC",
          workspace_id: "w7",
          tab_id: "w7:t2",
        },
      });
    };
    const adapter = new HerdrAgentAdapter({ run, startRetryDelayMs: 0 });

    await expect(adapter.startAgent({ name: "hc-run-a", kind: "codex", paneId: "w7:pC" })).resolves.toMatchObject({ name: "hc-run-a" });
    expect(attempts).toBe(2);
  });

  it("does not retry non-transient start errors", async () => {
    let attempts = 0;
    const run: Runner = async () => {
      attempts++;
      return err("agent_start_failed", "agent executable is unavailable", 1);
    };
    const adapter = new HerdrAgentAdapter({ run, startRetryDelayMs: 0 });

    await expect(adapter.startAgent({ name: "hc-run-a", kind: "codex", paneId: "w7:pC" })).rejects.toThrow("agent executable is unavailable");
    expect(attempts).toBe(1);
  });
});

describe("HerdrAgentAdapter.read", () => {
  it("requests unwrapped recent terminal output", async () => {
    const run: Runner = async (argv) => {
      expect(argv).toContain("recent-unwrapped");
      return { ok: true, code: 0, stdout: "report\n", stderr: "" };
    };
    const adapter = new HerdrAgentAdapter({ run });

    await expect(adapter.read("hc-run-a", { lines: 4000 })).resolves.toBe("report\n");
  });
});

describe("HerdrAgentAdapter.splitPane", () => {
  it("creates an isolated non-focused tab and returns its root pane", async () => {
    const run: Runner = async (argv) => {
      expect(argv.slice(1, 3)).toEqual(["tab", "create"]);
      expect(argv).toContain("--no-focus");
      expect(argv).toContain("HERDR_CONSENSUS_OUTPUT=/tmp/report.json");
      return json({
        root_pane: {
          pane_id: "w7:pH",
          tab_id: "w7:t3",
          workspace_id: "w7",
        },
      });
    };
    const adapter = new HerdrAgentAdapter({ run });

    await expect(adapter.splitPane({ cwd: "/tmp/repo", env: { HERDR_CONSENSUS_OUTPUT: "/tmp/report.json" } })).resolves.toEqual({ paneId: "w7:pH" });
  });
});
