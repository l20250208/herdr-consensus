import { afterEach, describe, expect, it } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveFixPlanVersion } from "../../src/fix-plan/store.js";
import type { LockedFixPlan } from "../../src/fix-plan/types.js";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "herdr-fix-plan-store-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function plan(version: number, sha256: string): LockedFixPlan {
  return { runId: "run-plan", version, items: [], createdAt: `v${version}`, sha256 };
}

describe("fix-plan version storage", () => {
  it("keeps immutable archives and updates the latest root files", async () => {
    const dir = await tempRoot();
    const v1 = plan(1, "one");
    const v2 = plan(2, "two");

    await saveFixPlanVersion(dir, v1, "# v1\n");
    await saveFixPlanVersion(dir, v2, "# v2\n");

    expect(JSON.parse(await readFile(join(dir, "fix-plans", "v1.json"), "utf8"))).toEqual(v1);
    expect(await readFile(join(dir, "fix-plans", "v1.md"), "utf8")).toBe("# v1\n");
    expect(JSON.parse(await readFile(join(dir, "fix-plan.json"), "utf8"))).toEqual(v2);
    expect(await readFile(join(dir, "fix-plan.md"), "utf8")).toBe("# v2\n");
  });

  it("rejects a duplicate version before changing latest", async () => {
    const dir = await tempRoot();
    const v1 = plan(1, "one");
    await saveFixPlanVersion(dir, v1, "# original\n");

    await expect(saveFixPlanVersion(dir, v1, "# duplicate\n")).rejects.toThrow(/version 1 already exists/i);
    expect(await readFile(join(dir, "fix-plan.md"), "utf8")).toBe("# original\n");
  });

  it("preflights both archive files and leaves no partial sibling", async () => {
    const dir = await tempRoot();
    await mkdir(join(dir, "fix-plans"), { recursive: true });
    await writeFile(join(dir, "fix-plans", "v1.md"), "# existing\n", "utf8");

    await expect(saveFixPlanVersion(dir, plan(1, "one"), "# new\n")).rejects.toThrow(/version 1 already exists/i);
    await expect(access(join(dir, "fix-plans", "v1.json"))).rejects.toThrow();
    await expect(access(join(dir, "fix-plan.json"))).rejects.toThrow();
  });

  it("rolls back archives and latest files when the latest markdown publish fails", async () => {
    const dir = await tempRoot();
    await mkdir(join(dir, "fix-plan.md.tmp"));

    await expect(saveFixPlanVersion(dir, plan(1, "one"), "# v1\n")).rejects.toThrow();
    for (const path of ["fix-plan.json", "fix-plans/v1.json", "fix-plans/v1.md"]) {
      await expect(access(join(dir, path))).rejects.toThrow();
    }

    await rm(join(dir, "fix-plan.md.tmp"), { recursive: true, force: true });
    await expect(saveFixPlanVersion(dir, plan(1, "one"), "# v1\n")).resolves.toBeUndefined();
  });
});
