import { describe, expect, it } from "vitest";
import { buildImplementationPrompt } from "../../src/apply/prompt.js";
import { ensureCleanGitWorktree, createFixWorktree } from "../../src/apply/git.js";
import type { LockedFixPlan } from "../../src/fix-plan/types.js";
import type { Runner } from "../../src/spawn.js";

const plan: LockedFixPlan = { runId: "r", version: 1, sha256: "h", createdAt: "now", items: [] };

describe("apply helpers", () => {
  it("builds an implementation prompt constrained to the locked plan", () => {
    const prompt = buildImplementationPrompt(plan);
    expect(prompt).toContain("Do not add opportunistic refactors");
    expect(prompt).toContain("Fix plan SHA-256: h");
  });

  it("rejects dirty main worktrees", async () => {
    const run: Runner = async (argv) => argv[1] === "rev-parse" ? { ok: true, code: 0, stdout: "true\n", stderr: "" } : { ok: true, code: 0, stdout: " M file\n", stderr: "" };
    expect(await ensureCleanGitWorktree("/repo", run)).toEqual({ ok: false, reason: "main worktree has uncommitted changes" });
  });

  it("creates a git worktree using argv arrays", async () => {
    const calls: readonly string[][] = [];
    const mutable: string[][] = calls as string[][];
    const run: Runner = async (argv) => { mutable.push([...argv]); return { ok: true, code: 0, stdout: "", stderr: "" }; };
    await createFixWorktree({ projectPath: "/repo", worktreePath: "/state/wt", branchName: "b", run });
    expect(calls[0]).toEqual(["git", "worktree", "add", "-b", "b", "/state/wt"]);
  });
});
