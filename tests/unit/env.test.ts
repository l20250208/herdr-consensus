import { describe, expect, it } from "vitest";
import { runDoctor } from "../../src/env.js";
import type { Runner, SpawnResult } from "../../src/spawn.js";

function ok(stdout: string): SpawnResult {
  return { ok: true, code: 0, stdout, stderr: "" };
}

function notFound(): SpawnResult {
  return { ok: false, error: "spawn node ENOENT" };
}

const AGENT_LIST_JSON = JSON.stringify({
  result: {
    agents: [
      { agent: "claude", agent_status: "idle", pane_id: "w7:p2", workspace_id: "w7" },
      { agent: "pi", agent_status: "idle", pane_id: "w7:p1", workspace_id: "w7" },
    ],
    type: "agent_list",
  },
});

const HEALTHY: Record<string, SpawnResult> = {
  "node --version": ok("v22.23.1\n"),
  "git --version": ok("git version 2.50.1\n"),
  "herdr --version": ok("herdr 0.8.0\n"),
  "herdr agent list": ok(AGENT_LIST_JSON),
};

function makeRunner(overrides: Record<string, SpawnResult> = {}): Runner {
  const map = { ...HEALTHY, ...overrides };
  return async (argv) => {
    const key = argv.join(" ");
    const found = map[key];
    if (found !== undefined) return found;
    throw new Error(`unexpected command in test: ${key}`);
  };
}

describe("runDoctor", () => {
  it("reports all checks green when the environment is healthy", async () => {
    const report = await runDoctor(makeRunner());
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.node.meetsMinimum).toBe(true);
    expect(report.node.version).toBe("v22.23.1");
    expect(report.git.found).toBe(true);
    expect(report.herdr.found).toBe(true);
    expect(report.agents.detected).toBe(true);
    expect(report.agents.list.map((a) => a.name)).toEqual(["claude", "pi"]);
  });

  it("flags an outdated Node.js", async () => {
    const report = await runDoctor(makeRunner({ "node --version": ok("v18.19.0\n") }));
    expect(report.ok).toBe(false);
    expect(report.node.meetsMinimum).toBe(false);
    expect(report.issues.some((i) => i.includes("20.0.0"))).toBe(true);
  });

  it("flags a missing git", async () => {
    const report = await runDoctor(makeRunner({ "git --version": notFound() }));
    expect(report.ok).toBe(false);
    expect(report.git.found).toBe(false);
    expect(report.issues).toContain("Git is not available");
  });

  it("flags a missing herdr and skips agent enumeration", async () => {
    const report = await runDoctor(makeRunner({ "herdr --version": notFound() }));
    expect(report.ok).toBe(false);
    expect(report.herdr.found).toBe(false);
    expect(report.agents.detected).toBe(false);
    expect(report.issues).toContain("Herdr is not available");
  });

  it("treats malformed agent list output as a warning, not a failure", async () => {
    const report = await runDoctor(makeRunner({ "herdr agent list": ok("not json\n") }));
    expect(report.ok).toBe(true);
    expect(report.agents.detected).toBe(false);
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it("warns when no agents are running", async () => {
    const empty = JSON.stringify({ result: { agents: [], type: "agent_list" } });
    const report = await runDoctor(makeRunner({ "herdr agent list": ok(empty) }));
    expect(report.ok).toBe(true);
    expect(report.agents.detected).toBe(true);
    expect(report.agents.list).toEqual([]);
    expect(report.warnings.some((w) => w.includes("no running agents"))).toBe(true);
  });
});
