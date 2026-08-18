import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkValidationCommandSafety } from "../../src/validation/safety.js";
import { planP2Validations } from "../../src/validation/planner.js";
import { executeValidation } from "../../src/validation/runner.js";
import type { ConsensusItem } from "../../src/consensus/types.js";

const tmpRoots: string[] = [];
async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-validation-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const p2Item: ConsensusItem = {
  itemId: "item-1",
  findingIds: ["f1"],
  relation: "single_source",
  matchScore: null,
  severity: "P2",
  evidenceTier: "agent_asserted",
  disagreementReasons: [],
  status: "needs_validation",
};

describe("validation safety", () => {
  it("blocks dangerous commands", () => {
    expect(checkValidationCommandSafety(["sudo", "rm", "-rf", "/"]).safe).toBe(false);
    expect(checkValidationCommandSafety(["pnpm", "test"]).safe).toBe(true);
  });
});

describe("validation planner", () => {
  it("plans existing package test commands for P2 items only", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }), "utf8");
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfile\n", "utf8");
    const plans = await planP2Validations({ projectPath: root, items: [p2Item, { ...p2Item, itemId: "p1", severity: "P1" }] });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.argv).toEqual(["pnpm", "test"]);
  });
});

describe("validation runner", () => {
  it("records stdout/stderr hashes and classifies exit code", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "validations"));
    const record = await executeValidation({
      plan: { itemId: "item-1", argv: ["pnpm", "test"], cwd: root, timeoutMs: 1000, reason: "test" },
      outputDir: join(root, "validations"),
      approvedByUser: true,
      run: async () => ({ ok: true, code: 1, stdout: "failed", stderr: "boom" }),
    });
    expect(record.conclusion).toBe("inconclusive");
    expect(record.exitCode).toBe(1);
    expect(await readFile(join(root, "validations", `${record.validationId}.stdout.txt`), "utf8")).toBe("failed");
  });
});
