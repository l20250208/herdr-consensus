import type { LockedFixPlan } from "../fix-plan/types.js";
import type { Runner } from "../spawn.js";
import { checkValidationCommandSafety } from "../validation/safety.js";
import type { ValidationRecord } from "../validation/types.js";

export interface AllowedPathResult {
  ok: boolean;
  violations: string[];
}

export interface TargetedCheckResult {
  itemId: string;
  argv: string[];
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export async function readHeadCommit(worktreePath: string, run: Runner): Promise<string> {
  const result = await run(["git", "rev-parse", "HEAD"], { cwd: worktreePath });
  if (!result.ok || result.code !== 0) throw new Error(result.ok ? result.stderr : result.error);
  const commit = result.stdout.trim();
  if (commit === "") throw new Error("git rev-parse HEAD returned an empty commit");
  return commit;
}

export async function listChangedPaths(worktreePath: string, run: Runner, baseCommit: string): Promise<string[]> {
  const [tracked, untracked] = await Promise.all([
    run(["git", "diff", "--name-only", baseCommit, "--"], { cwd: worktreePath }),
    run(["git", "ls-files", "--others", "--exclude-standard"], { cwd: worktreePath }),
  ]);
  for (const result of [tracked, untracked]) {
    if (!result.ok || result.code !== 0) {
      throw new Error(result.ok ? result.stderr : result.error);
    }
  }
  return [...new Set(
    `${tracked.ok ? tracked.stdout : ""}\n${untracked.ok ? untracked.stdout : ""}`
      .split("\n")
      .map((path) => path.trim())
      .filter((path) => path !== ""),
  )]
    .sort();
}

export function verifyAllowedPaths(
  plan: LockedFixPlan,
  changedPaths: readonly string[],
): AllowedPathResult {
  const allowed = new Set(plan.items.flatMap((item) => item.allowedPaths));
  const violations = [...new Set(changedPaths.filter((path) => !allowed.has(path)))].sort();
  return { ok: violations.length === 0, violations };
}

export async function runTargetedChecks(
  plan: LockedFixPlan,
  validations: readonly ValidationRecord[],
  worktreePath: string,
  run: Runner,
): Promise<TargetedCheckResult[]> {
  const itemIds = new Set(plan.items.map((item) => item.itemId));
  const eligible = validations.filter((record) => (
    itemIds.has(record.itemId) &&
    record.approvedByUser &&
    checkValidationCommandSafety(record.argv).safe
  ));
  const results: TargetedCheckResult[] = [];
  const seen = new Set<string>();
  for (const record of eligible) {
    const key = `${record.itemId}\0${JSON.stringify(record.argv)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const startedAt = new Date().toISOString();
    const result = await run(record.argv, { cwd: worktreePath, timeoutMs: 300_000 });
    results.push({
      itemId: record.itemId,
      argv: [...record.argv],
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: result.ok ? result.code : null,
      stdout: result.ok ? result.stdout : "",
      stderr: result.ok ? result.stderr : result.error,
    });
  }
  return results;
}
