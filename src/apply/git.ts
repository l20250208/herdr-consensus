import type { Runner } from "../spawn.js";

export interface GitCheckResult { ok: boolean; reason: string | null }

export async function ensureCleanGitWorktree(projectPath: string, run: Runner): Promise<GitCheckResult> {
  const inside = await run(["git", "rev-parse", "--is-inside-work-tree"], { cwd: projectPath });
  if (!inside.ok || inside.code !== 0 || inside.stdout.trim() !== "true") return { ok: false, reason: "not a git worktree" };
  const status = await run(["git", "status", "--porcelain"], { cwd: projectPath });
  if (!status.ok || status.code !== 0) return { ok: false, reason: "failed to inspect git status" };
  if (status.stdout.trim() !== "") return { ok: false, reason: "main worktree has uncommitted changes" };
  return { ok: true, reason: null };
}

export async function createFixWorktree(input: { projectPath: string; worktreePath: string; branchName: string; run: Runner }): Promise<void> {
  const result = await input.run(["git", "worktree", "add", "-b", input.branchName, input.worktreePath], { cwd: input.projectPath, timeoutMs: 120_000 });
  if (!result.ok || result.code !== 0) throw new Error(result.ok ? result.stderr : result.error);
}
