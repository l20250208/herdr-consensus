import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonFile, writeJsonAtomic } from "../../src/state/json.js";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "herdr-json-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workflow JSON artifacts", () => {
  it("atomically writes and reads a nested artifact", async () => {
    const path = join(await tempRoot(), "nested", "artifact.json");

    await writeJsonAtomic(path, { items: ["a"] });

    await expect(readJsonFile(path)).resolves.toEqual({ items: ["a"] });
    expect(await readFile(path, "utf8")).toBe('{\n  "items": [\n    "a"\n  ]\n}\n');
  });

  it("reads the committed artifact when a stale temp file exists", async () => {
    const root = await tempRoot();
    const path = join(root, "artifact.json");
    await writeJsonAtomic(path, { version: 1 });
    await writeFile(join(root, ".artifact.json.tmp"), "{ partial", "utf8");

    await expect(readJsonFile(path)).resolves.toEqual({ version: 1 });
  });

  it("returns null when an artifact does not exist", async () => {
    await expect(readJsonFile(join(await tempRoot(), "missing.json"))).resolves.toBeNull();
  });
});
