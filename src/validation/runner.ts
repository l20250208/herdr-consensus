import { mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Runner } from "../spawn.js";
import type { ValidationPlan, ValidationRecord } from "./types.js";

export function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function conclusionFor(exitCode: number | null, timedOut: boolean): ValidationRecord["conclusion"] {
  if (timedOut) return "inconclusive";
  if (exitCode === 0) return "validated_false";
  if (exitCode === null) return "inconclusive";
  return "inconclusive";
}

export async function executeValidation(input: { plan: ValidationPlan; run: Runner; outputDir: string; approvedByUser: boolean }): Promise<ValidationRecord> {
  await mkdir(input.outputDir, { recursive: true });
  const validationId = `val_${input.plan.itemId}_${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const result = await input.run(input.plan.argv, { cwd: input.plan.cwd, timeoutMs: input.plan.timeoutMs });
  const finishedAt = new Date().toISOString();
  const stdout = result.ok ? result.stdout : "";
  const stderr = result.ok ? result.stderr : result.error;
  await writeFile(join(input.outputDir, `${validationId}.stdout.txt`), stdout, "utf8");
  await writeFile(join(input.outputDir, `${validationId}.stderr.txt`), stderr, "utf8");
  const exitCode = result.ok ? result.code : null;
  return {
    validationId,
    itemId: input.plan.itemId,
    argv: [...input.plan.argv],
    cwd: input.plan.cwd,
    approvedByUser: input.approvedByUser,
    startedAt,
    finishedAt,
    exitCode,
    stdoutSha256: sha256Text(stdout),
    stderrSha256: sha256Text(stderr),
    conclusion: conclusionFor(exitCode, !result.ok && result.timedOut === true),
  };
}
