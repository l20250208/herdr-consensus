import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveRawReports } from "../../src/reports/storage.js";
import { makeArtifact } from "../../src/reports/artifact.js";

const tmpRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-consensus-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("saveRawReports", () => {
  it("writes raw content and a manifest, skipping null slots", async () => {
    const runDir = await tempRoot();
    const a = makeArtifact({ sourceId: "agent_a", agentKind: "claude", content: "raw A\n" });
    await saveRawReports(runDir, { a, b: null });

    expect(await readFile(join(runDir, "raw", "a.txt"), "utf8")).toBe("raw A\n");

    const manifest = JSON.parse(await readFile(join(runDir, "raw", "manifest.json"), "utf8")) as {
      a: unknown;
      b: unknown;
    };
    expect(manifest.b).toBeNull();
    expect((manifest.a as { sha256: string }).sha256).toBe(a.sha256);

    await expect(stat(join(runDir, "raw", "b.txt"))).rejects.toThrow();
  });
});
