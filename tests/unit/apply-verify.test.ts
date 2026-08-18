import { describe, expect, it } from "vitest";
import type { LockedFixPlan } from "../../src/fix-plan/types.js";
import type { Runner } from "../../src/spawn.js";
import type { ValidationRecord } from "../../src/validation/types.js";
import {
  listChangedPaths,
  readHeadCommit,
  runTargetedChecks,
  verifyAllowedPaths,
} from "../../src/apply/verify.js";

function plan(allowedPaths: string[]): LockedFixPlan {
  return {
    runId: "run-apply",
    version: 1,
    createdAt: "now",
    sha256: "hash",
    items: [{
      itemId: "i1",
      severity: "P2",
      acceptanceCriteria: ["test"],
      allowedPaths,
    }],
  };
}

function validation(itemId: string, approvedByUser: boolean): ValidationRecord {
  return {
    validationId: `v-${itemId}`,
    itemId,
    argv: ["pnpm", "test"],
    cwd: "/original",
    approvedByUser,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    stdoutSha256: null,
    stderrSha256: null,
    conclusion: "inconclusive",
  };
}

describe("apply verification", () => {
  it("rejects changed paths outside the locked allowlist", () => {
    expect(verifyAllowedPaths(plan(["src/a.ts"]), ["src/a.ts", "src/b.ts"]))
      .toEqual({ ok: false, violations: ["src/b.ts"] });
  });

  it("parses unique repo-relative changed paths", async () => {
    const runner: Runner = async (argv) => ({
      ok: true,
      code: 0,
      stdout: argv[1] === "diff"
        ? "src/a.ts\nsrc/b.ts\nsrc/a.ts\n"
        : "src/new.ts\n",
      stderr: "",
    });

    await expect(listChangedPaths("/worktree", runner, "base123")).resolves.toEqual(["src/a.ts", "src/b.ts", "src/new.ts"]);
  });

  it("reads HEAD so callers can reject implementation-agent commits", async () => {
    const runner: Runner = async (argv) => ({ ok: true, code: 0, stdout: argv.join(" ").includes("rev-parse") ? "abc123\n" : "", stderr: "" });
    await expect(readHeadCommit("/worktree", runner)).resolves.toBe("abc123");
  });

  it("runs only matching validation commands that the user already approved", async () => {
    const calls: Array<{ argv: readonly string[]; cwd: string | undefined }> = [];
    const runner: Runner = async (argv, options) => {
      calls.push({ argv, cwd: options?.cwd });
      return { ok: true, code: 0, stdout: "ok", stderr: "" };
    };

    const results = await runTargetedChecks(
      plan(["src/a.ts"]),
      [validation("i1", true), validation("i2", true), validation("i1", false)],
      "/worktree",
      runner,
    );

    expect(calls).toEqual([{ argv: ["pnpm", "test"], cwd: "/worktree" }]);
    expect(results).toEqual([
      expect.objectContaining({ itemId: "i1", argv: ["pnpm", "test"], exitCode: 0 }),
    ]);
  });
});
