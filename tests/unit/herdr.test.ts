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
