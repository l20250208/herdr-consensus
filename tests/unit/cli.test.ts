import { describe, expect, it } from "vitest";
import { main, parseArgv, PLUGIN_VERSION, type CliDeps } from "../../src/cli.js";
import type { SpawnResult } from "../../src/spawn.js";

function ok(stdout: string): SpawnResult {
  return { ok: true, code: 0, stdout, stderr: "" };
}

const AGENT_LIST_JSON = JSON.stringify({
  result: {
    agents: [{ agent: "claude", agent_status: "idle", pane_id: "w7:p2", workspace_id: "w7" }],
    type: "agent_list",
  },
});

function makeDeps(): { deps: CliDeps; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  const deps: CliDeps = {
    run: async (argv) => {
      const key = argv.join(" ");
      if (key === "node --version") return ok("v22.23.1\n");
      if (key === "git --version") return ok("git version 2.50.1\n");
      if (key === "herdr --version") return ok("herdr 0.8.0\n");
      if (key === "herdr agent list") return ok(AGENT_LIST_JSON);
      throw new Error(`unexpected command in test: ${key}`);
    },
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
  };
  return { deps, out: () => out, err: () => err };
}

describe("parseArgv", () => {
  it("parses a command and the json flag", () => {
    expect(parseArgv(["--json", "doctor"])).toEqual({
      command: "doctor",
      json: true,
      help: false,
      version: false,
      args: [],
    });
  });

  it("parses help and version flags", () => {
    expect(parseArgv(["--help"]).help).toBe(true);
    expect(parseArgv(["-V"]).version).toBe(true);
  });

  it("leaves the command null when only flags are present", () => {
    expect(parseArgv(["--json"]).command).toBeNull();
  });
});

describe("main", () => {
  it("prints the version and exits 0", async () => {
    const { deps, out } = makeDeps();
    const code = await main(["--version"], deps);
    expect(code).toBe(0);
    expect(out()).toBe(`${PLUGIN_VERSION}\n`);
  });

  it("prints usage on --help", async () => {
    const { deps, out } = makeDeps();
    const code = await main(["--help"], deps);
    expect(code).toBe(0);
    expect(out()).toContain("doctor");
  });

  it("runs doctor and exits 0 on a healthy environment", async () => {
    const { deps, out } = makeDeps();
    const code = await main(["doctor"], deps);
    expect(code).toBe(0);
    expect(out()).toContain("All required checks passed");
  });

  it("emits machine-readable JSON with --json", async () => {
    const { deps, out } = makeDeps();
    const code = await main(["doctor", "--json"], deps);
    expect(code).toBe(0);
    const parsed = JSON.parse(out()) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it("reports not-implemented commands to stderr and exits 2", async () => {
    const { deps, err } = makeDeps();
    const code = await main(["start"], deps);
    expect(code).toBe(2);
    expect(err()).toContain("not implemented");
  });

  it("rejects unknown commands with exit 2", async () => {
    const { deps, err } = makeDeps();
    const code = await main(["bogus"], deps);
    expect(code).toBe(2);
    expect(err()).toContain("unknown command");
  });
});
