import { afterEach, describe, expect, it } from "vitest";
import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HerdrAgentAdapter } from "../../src/herdr/adapter.js";
import { HerdrError } from "../../src/herdr/types.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/fake-herdr.mjs", import.meta.url));
const tmpRoots: string[] = [];

async function installFakeHerdr(
  scenario: Record<string, unknown> = {},
): Promise<{ adapter: HerdrAgentAdapter; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "fake-herdr-"));
  tmpRoots.push(root);
  const binPath = join(root, "herdr");
  await copyFile(FIXTURE, binPath);
  await chmod(binPath, 0o755);
  const adapter = new HerdrAgentAdapter({
    herdrBin: binPath,
    env: { FAKE_HERDR_SCENARIO: JSON.stringify(scenario) },
  });
  return { adapter, root };
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("HerdrAgentAdapter (fake herdr executable)", () => {
  it("splits a pane and returns the pane id", async () => {
    const { adapter } = await installFakeHerdr();
    const { paneId } = await adapter.splitPane({ cwd: "/tmp/repo" });
    expect(paneId).toBe("w9:p9");
  });

  it("lists agents", async () => {
    const { adapter } = await installFakeHerdr();
    const agents = await adapter.listAgents();
    expect(agents.map((a) => a.name)).toEqual(["claude", "pi"]);
    expect(agents[0]?.status).toBe("idle");
  });

  it("gets an agent by target", async () => {
    const { adapter } = await installFakeHerdr({ getStatus: "working" });
    const agent = await adapter.getAgent("p1");
    expect(agent.name).toBe("claude");
    expect(agent.status).toBe("working");
  });

  it("classifies a missing agent on get as exited", async () => {
    const { adapter } = await installFakeHerdr({ get: "missing" });
    await expect(adapter.getAgent("p1")).rejects.toMatchObject({ kind: "exited" });
  });

  it("starts an agent and returns its info", async () => {
    const { adapter } = await installFakeHerdr({ agentName: "codex" });
    const agent = await adapter.startAgent({ name: "reviewer", kind: "codex", paneId: "p9" });
    expect(agent.name).toBe("codex");
    expect(agent.status).toBe("idle");
  });

  it("classifies a failed start", async () => {
    const { adapter } = await installFakeHerdr({ start: "fail" });
    await expect(
      adapter.startAgent({ name: "reviewer", kind: "claude", paneId: "p9" }),
    ).rejects.toBeInstanceOf(HerdrError);
  });

  it("reads terminal output as plain text", async () => {
    const { adapter } = await installFakeHerdr({ read: "hello from the agent\n" });
    const output = await adapter.read("p1", { lines: 20 });
    expect(output).toBe("hello from the agent\n");
  });

  it("classifies a completed prompt as done", async () => {
    const { adapter } = await installFakeHerdr({ prompt: "done" });
    const result = await adapter.prompt({ target: "p1", text: "review this" });
    expect(result).toMatchObject({ kind: "done", status: "idle" });
  });

  it("classifies a blocked prompt", async () => {
    const { adapter } = await installFakeHerdr({ prompt: "blocked" });
    const result = await adapter.prompt({ target: "p1", text: "review this" });
    expect(result).toMatchObject({ kind: "blocked" });
  });

  it("classifies a prompt timeout", async () => {
    const { adapter } = await installFakeHerdr({ prompt: "timeout" });
    const result = await adapter.prompt({ target: "p1", text: "review this" });
    expect(result.kind).toBe("timed_out");
  });

  it("classifies an exited agent during prompt", async () => {
    const { adapter } = await installFakeHerdr({ prompt: "exit" });
    const result = await adapter.prompt({ target: "p1", text: "review this" });
    expect(result).toMatchObject({ kind: "exited" });
  });

  it("waits and returns the settled status", async () => {
    const { adapter } = await installFakeHerdr();
    const status = await adapter.wait({ target: "p1", until: ["idle", "done"] });
    expect(status).toBe("idle");
  });

  it("classifies a wait timeout", async () => {
    const { adapter } = await installFakeHerdr({ wait: "timeout" });
    await expect(adapter.wait({ target: "p1" })).rejects.toMatchObject({ kind: "timeout" });
  });
});
